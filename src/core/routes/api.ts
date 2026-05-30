// HTTP API consumed by the frontend. Three endpoints, all under /api:
//
//   POST /api/process-invoice     multipart upload — streams NDJSON events
//   POST /api/find-refunds        JSON body         — streams NDJSON events
//   POST /api/render-refund-pdf   JSON body         — returns binary PDF
//
// NDJSON streaming format: each event is a single JSON object on its own
// line. The frontend reads with fetch + Response.body.getReader() and
// re-assembles. Keeps EventSource (which doesn't support POST) off the
// table while still giving real per-line progress updates.

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { HonoEnv } from "./types";
import { extract } from "@/core/agents/extractor";
import { classify } from "@/core/agents/classifier";
import { calculateDuty, calculateEntryFees } from "@/core/agents/duty-calculator";
import { loadTariffRates } from "@/core/lib/tariff-rates";
import { parseEntrySummary } from "@/core/agents/entry-summary-parser";
import { findRefundOpportunities } from "@/core/agents/psc-finder";
import { renderRefundReportToBuffer } from "@/core/lib/render-refund-pdf";
import { ensureDemoCustomer, listSkuMemory, upsertSkuMemory, seedSkuMemoryIfEmpty } from "@/core/lib/sku-memory";
import { generateCounterfactuals } from "@/core/agents/counterfactual";
import { generateAuditDefense } from "@/core/agents/audit-defense";
import { verifyAgainstCross } from "@/core/agents/cross-verifier";
import { runDebate } from "@/core/agents/debate";
import { runCopilot } from "@/core/agents/copilot";
import { runTariffSimulation } from "@/core/lib/tariff-simulator";
import { analyzeSourcing } from "@/core/agents/sourcing-intel";
import { analyzeReroute } from "@/core/agents/reroute-intel";
import { buildBrokerQueue } from "@/core/lib/broker-queue";
import { computeDeadlines } from "@/core/lib/deadlines";
import { findFactories } from "@/core/agents/factory-finder";
import { deepDiveFactory } from "@/core/agents/factory-deepdive";
import { runTariffWatch } from "@/core/agents/tariff-monitor";
import {
  MOCK_ENTRIES,
  isValidLogin,
  loadEntryPdf,
  renderDashboard,
  renderEntries,
  renderLogin,
} from "@/core/lib/mock-ace-portal";
import { runAceBrowserAgent } from "@/core/agents/ace-browser-agent";
import { mapWithConcurrency } from "@/core/lib/concurrency";
import { withRetry } from "@/core/lib/retry";
import { seedDemoFxRates } from "@/core/lib/fx-rates";
import { HistoricalEntries, PSCFindings } from "@/core/schemas/refund";

const CONCURRENCY = 5;

/**
 * The duty calculator's resolveRates() looks up Section 301 by ISO-2 code
 * ("CN"), but the extractor commonly produces the full country name ("China",
 * "Made in China"). Normalize here so duty calc fires correctly. Coverage is
 * deliberately narrow — major SMB-import sources we know about. Anything
 * unrecognized is passed through unchanged so resolveRates can still apply
 * non-China rules.
 */
function toIsoAlpha2(coo: string | null | undefined): string {
  if (!coo) return "unknown";
  const cleaned = coo.trim().toLowerCase().replace(/^made in\s+/, "");
  const map: Record<string, string> = {
    china: "CN",
    "people's republic of china": "CN",
    cn: "CN",
    "p.r.c.": "CN",
    prc: "CN",
    india: "IN",
    in: "IN",
    vietnam: "VN",
    "viet nam": "VN",
    vn: "VN",
    mexico: "MX",
    mx: "MX",
    canada: "CA",
    ca: "CA",
    "united states": "US",
    usa: "US",
    "u.s.a.": "US",
    us: "US",
    indonesia: "ID",
    id: "ID",
    thailand: "TH",
    th: "TH",
    bangladesh: "BD",
    bd: "BD",
    cambodia: "KH",
    kh: "KH",
    "south korea": "KR",
    "republic of korea": "KR",
    korea: "KR",
    kr: "KR",
    japan: "JP",
    jp: "JP",
    taiwan: "TW",
    tw: "TW",
    germany: "DE",
    de: "DE",
    italy: "IT",
    it: "IT",
    france: "FR",
    fr: "FR",
    spain: "ES",
    es: "ES",
    "united kingdom": "GB",
    "great britain": "GB",
    uk: "GB",
    gb: "GB",
    turkey: "TR",
    tr: "TR",
    pakistan: "PK",
    pk: "PK",
    brazil: "BR",
    br: "BR",
  };
  return map[cleaned] ?? coo;
}

export const apiRoute = new Hono<HonoEnv>();

apiRoute.get("/", (c) =>
  c.json({
    endpoints: [
      "POST /api/process-invoice",
      "POST /api/find-refunds",
      "POST /api/render-refund-pdf",
    ],
  }),
);

// ── GET /api/methodology ─────────────────────────────────────────────────
// Serves the committed eval summary (measured accuracy, prompt evolution,
// model bake-off, retrieval diagnostic). Powers the Methodology page.
apiRoute.get("/methodology", async (c) => {
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), "evals/eval-summary.json"), "utf8");
    c.header("content-type", "application/json");
    return c.body(text);
  } catch {
    return c.json({ error: "eval summary not available" }, 404);
  }
});

// ── GET /api/audit-log ───────────────────────────────────────────────────
// Recent classification audit records — the reasonable-care binder. Each
// row carries the model + prompt version, the predicted code, GRI rule,
// confidence, citations, and timestamp.
apiRoute.get("/audit-log", async (c) => {
  const ctx = c.var.ctx;
  const limit = Math.min(Number(c.req.query("limit") ?? "40") || 40, 100);
  const rows = await ctx.db
    .prepare(
      "SELECT id, occurred_at, actor, entity_kind, action, payload_json FROM audit_log WHERE entity_kind = 'classification' ORDER BY occurred_at DESC LIMIT ?",
    )
    .bind(limit)
    .all<{ id: string; occurred_at: string; actor: string; entity_kind: string; action: string; payload_json: string }>();
  const records = rows.map((r) => {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(r.payload_json) as Record<string, unknown>; } catch { /* keep empty */ }
    const result = (parsed.result ?? {}) as Record<string, unknown>;
    const candidates = (parsed.candidates ?? []) as Array<{ htsCode: string; score: number }>;
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      actor: r.actor,
      model: parsed.model ?? null,
      prompt_version: parsed.promptVersion ?? null,
      hts_code: result.hts_code ?? null,
      hts_code_8: result.hts_code_8 ?? null,
      gri_rule_applied: result.gri_rule_applied ?? null,
      confidence: result.confidence ?? null,
      precision_level: result.precision_level ?? null,
      citations: (result.citations ?? []) as string[],
      validation_warning: result.validation_warning ?? null,
      candidate_count: candidates.length,
      top_candidate: candidates[0]?.htsCode ?? null,
      reasoning: result.reasoning ?? null,
    };
  });
  return c.json({ count: records.length, records });
});

// ── Sample shipment files ────────────────────────────────────────────────
// One-click loading for the two primary surfaces: the frontend fetches
// these, wraps them in a File, and runs the normal pipeline — so a single
// click starts a full run end-to-end.
apiRoute.get("/samples/invoice", async (c) => {
  const p = path.resolve(process.cwd(), "data/sample-invoices/shenzhen-electronics.pdf");
  try {
    const bytes = await fs.readFile(p);
    c.header("content-type", "application/pdf");
    c.header("content-disposition", 'inline; filename="shenzhen-aurora-electronics.pdf"');
    return c.body(bytes as unknown as ArrayBuffer);
  } catch {
    return c.json({ error: "sample invoice not available" }, 404);
  }
});
apiRoute.get("/samples/entries", async (c) => {
  const p = path.resolve(process.cwd(), "data/sample-entries/amazon-fba.json");
  try {
    const text = await fs.readFile(p, "utf8");
    c.header("content-type", "application/json");
    return c.body(text);
  } catch {
    return c.json({ error: "sample entries not available" }, 404);
  }
});

// ── GET /api/deadlines ────────────────────────────────────────────────────
// Liquidation / PSC / protest deadline tracking over the importer's historical
// entries. Deterministic — derived from each entry's date.
apiRoute.get("/deadlines", async (c) => {
  const p = path.resolve(process.cwd(), "data/sample-entries/amazon-fba.json");
  try {
    const text = await fs.readFile(p, "utf8");
    const data = JSON.parse(text) as { importer?: string; entries: Parameters<typeof computeDeadlines>[1] };
    const result = computeDeadlines(data.importer ?? "Importer", data.entries, new Date());
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/process-invoice ─────────────────────────────────────────────
// Accepts multipart/form-data with one or more "file" fields (PDF or image).
// All attached files are merged into ONE shipment by the extractor — they
// describe the same set of goods. Each line item is then classified and
// duty is computed deterministically with full per-component breakdown.
//
// Events:
//   status              progress messages
//   extracted           the merged shipment (one event per request)
//   line_classified     per-line classification result
//   line_duty_calculated per-line duty breakdown (after classification)
//   line_failed         per-line classification failure
//   done                summary + per-line records (with classification + duty)
//   error               request-level error
apiRoute.post("/process-invoice", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);
  const customerId = await ensureDemoCustomer(ctx);

  const tmpPaths: string[] = [];
  try {
    const formData = await c.req.formData();
    type FileLike = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
    const fileEntries: FileLike[] = formData.getAll("file").flatMap((v) => {
      if (typeof v === "object" && v !== null && "name" in v && "arrayBuffer" in v) {
        return [v as unknown as FileLike];
      }
      return [];
    });
    if (fileEntries.length === 0) {
      return c.json({ error: "missing 'file' form field" }, 400);
    }

    const uploads: Array<{ file: FileLike; tmpPath: string }> = [];
    for (const file of fileEntries) {
      const ext = path.extname(file.name).toLowerCase() || ".pdf";
      const tmpPath = path.join(os.tmpdir(), `customs-upload-${randomUUID()}${ext}`);
      const bytes = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tmpPath, bytes);
      tmpPaths.push(tmpPath);
      uploads.push({ file, tmpPath });
    }

    return stream(c, async (s) => {
      c.header("content-type", "application/x-ndjson");
      const emit = async (obj: unknown): Promise<void> => {
        await s.write(JSON.stringify(obj) + "\n");
      };

      try {
        await emit({
          type: "status",
          message:
            uploads.length === 1
              ? "Extracting line items from document…"
              : `Extracting line items from ${uploads.length} documents (merged into one shipment)…`,
        });

        // Single extraction call across all files. The extractor is prompted
        // to merge them into one shipment.
        const t0 = Date.now();
        const { result: extraction } = await extract(
          ctx,
          uploads.map((u) => u.tmpPath),
        );
        const extractMs = Date.now() - t0;
        const filenames = uploads.map((u) => u.file.name);
        await emit({
          type: "extracted",
          extraction,
          source_filenames: filenames,
          latency_ms: extractMs,
        });

        await emit({
          type: "status",
          message: `Classifying ${extraction.line_items.length} line items (concurrency ${CONCURRENCY})…`,
        });

        const lines = extraction.line_items.map((li, line_index) => ({
          line_index,
          line: li,
          country_of_origin: li.country_of_origin ?? extraction.country_of_origin,
        }));

        const settled = await mapWithConcurrency(lines, CONCURRENCY, async (t) => {
          const tStart = Date.now();
          try {
            const { result: classification, trace: classifyTrace } = await withRetry(
              () =>
                classify(
                  ctx,
                  {
                    description: t.line.description,
                    quantity: t.line.quantity,
                    unit_value_usd: t.line.unit_value / 100,
                    customer_id: customerId,
                    ...(t.country_of_origin ? { country_of_origin: t.country_of_origin } : {}),
                  },
                  {
                    onReasoningDelta: async (delta) => {
                      await emit({
                        type: "reasoning_delta",
                        line_index: t.line_index,
                        delta,
                      });
                    },
                  },
                ),
              { attempts: 3, baseMs: 2000 },
            );
            // Live retrieval reveal: the top candidates the classifier saw,
            // and which it cited.
            await emit({
              type: "line_retrieval",
              line_index: t.line_index,
              candidates: classifyTrace.candidates.slice(0, 12).map((cand) => ({
                hts_code: cand.htsCode,
                score: cand.score,
                description: cand.description,
                cited: classification.citations.some((cit) => cand.htsCode.startsWith(cit)),
              })),
              total_candidates: classifyTrace.candidates.length,
            });
            if (classifyTrace.sku_memory_hit) {
              await emit({
                type: "sku_memory_hit",
                line_index: t.line_index,
                memory: classifyTrace.sku_memory_hit,
              });
            }
            const classifyMs = Date.now() - tStart;
            await emit({
              type: "line_classified",
              line_index: t.line_index,
              classification,
              latency_ms: classifyMs,
            });

            // Duty calculation: deterministic, no LLM. Requires COO and a
            // USD customs value. Falls back to "unknown" COO with a warning
            // if missing — the calculator returns base rates and flags it.
            // Customs value: if invoice is in USD use the line total directly;
            // otherwise convert via the FX rate the extractor already used.
            const lineUsdCents =
              extraction.currency === "USD"
                ? t.line.total_value
                : extraction.fx_rate_used !== null
                  ? Math.round(t.line.total_value * extraction.fx_rate_used)
                  : null;
            let duty: Awaited<ReturnType<typeof calculateDuty>> | null = null;
            let dutyError: string | null = null;
            if (lineUsdCents === null) {
              dutyError = `cannot compute duty: no FX rate available for ${extraction.currency}`;
            } else {
              try {
                // Per-line: duty rates only. Entry-level fees (MPF / HMF)
                // are added once at the bottom on the aggregate value so the
                // MPF min cap and HMF aren't applied N times.
                duty = await calculateDuty(ctx, {
                  hts_code: classification.hts_code_8,
                  country_of_origin: toIsoAlpha2(t.country_of_origin),
                  customs_value_usd_cents: lineUsdCents,
                  transport_mode: extraction.mode_of_transport ?? "ocean",
                  include_entry_fees: false,
                });
                await emit({
                  type: "line_duty_calculated",
                  line_index: t.line_index,
                  duty,
                });
              } catch (e) {
                dutyError = e instanceof Error ? e.message : String(e);
              }
            }

            return {
              ok: true as const,
              classification,
              duty,
              duty_error: dutyError,
              latency_ms: classifyMs,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await emit({ type: "line_failed", line_index: t.line_index, error: msg });
            return { ok: false as const, error: msg };
          }
        });

        const finalLines = settled.map((r, i) => {
          const t = lines[i]!;
          return {
            line_index: t.line_index,
            line: t.line,
            country_of_origin_used: t.country_of_origin ?? null,
            classification:
              r.status === "fulfilled" && r.value.ok ? r.value.classification : null,
            duty: r.status === "fulfilled" && r.value.ok ? r.value.duty : null,
            duty_error:
              r.status === "fulfilled" && r.value.ok ? r.value.duty_error : null,
            error:
              r.status === "fulfilled" && !r.value.ok
                ? r.value.error
                : r.status === "rejected"
                  ? String(r.reason)
                  : null,
          };
        });
        const classifiedOk = finalLines.filter((l) => l.classification !== null).length;
        const totalLineDutyUsdCents = finalLines.reduce(
          (a, l) => a + (l.duty?.total_duty_usd_cents ?? 0),
          0,
        );

        // Entry-level fees: MPF + HMF computed once on the aggregate USD
        // customs value (not per-line). This is how CBP actually assesses
        // them — see 19 USC 58c(b)(8) and CBP Form 7501 Box 39 ABI codes.
        const table = await loadTariffRates(ctx);
        const transportModeAssumed = !extraction.mode_of_transport;
        const entryFees =
          extraction.total_value_usd_cents !== null
            ? calculateEntryFees(
                table,
                extraction.total_value_usd_cents,
                extraction.mode_of_transport ?? "ocean",
                { transport_mode_assumed: transportModeAssumed },
              )
            : null;

        const totalDutyUsdCents = totalLineDutyUsdCents + (entryFees?.total_usd_cents ?? 0);

        await emit({
          type: "done",
          extraction,
          source_filenames: filenames,
          lines: finalLines,
          entry_fees: entryFees,
          summary: {
            total_documents: filenames.length,
            total_lines: finalLines.length,
            classified_ok: classifiedOk,
            failed: finalLines.length - classifiedOk,
            total_line_duty_usd_cents: totalLineDutyUsdCents,
            entry_fees_usd_cents: entryFees?.total_usd_cents ?? 0,
            total_duty_usd_cents: totalDutyUsdCents,
            currency: extraction.currency,
            customs_value_usd_cents: extraction.total_value_usd_cents,
            transport_mode: extraction.mode_of_transport ?? "ocean",
            transport_mode_assumed: transportModeAssumed,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await emit({ type: "error", message: msg });
      } finally {
        await Promise.all(tmpPaths.map((p) => fs.rm(p, { force: true })));
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all(tmpPaths.map((p) => fs.rm(p, { force: true })));
    return c.json({ error: msg }, 500);
  }
});

// ── POST /api/find-refunds ────────────────────────────────────────────────
// Two input shapes are accepted:
//
//   (a) Content-Type: application/json
//       Body is a HistoricalEntries object (the format the PSC finder consumes
//       directly). Used by JSON exports from broker systems / ACE.
//
//   (b) Content-Type: multipart/form-data
//       One or more "file" fields, each a CBP Form 7501 entry-summary PDF.
//       Each PDF is parsed by the entry-summary agent into one HistoricalEntry;
//       all entries are wrapped into a single HistoricalEntries body and run
//       through the PSC finder.
//
// Streams NDJSON events: status, entry_parsed (multipart only),
// line_analyzed, done, error.
const FindRefundsJsonBody = HistoricalEntries;

apiRoute.post("/find-refunds", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);

  const contentType = c.req.header("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  let historical: import("@/core/schemas/refund").HistoricalEntriesT;
  const tmpPaths: string[] = [];
  let parsedFromPdfFilenames: string[] = [];

  if (isMultipart) {
    // Parse PDFs into HistoricalEntries.
    try {
      const formData = await c.req.formData();
      type FileLike = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
      const files: FileLike[] = formData.getAll("file").flatMap((v) => {
        if (typeof v === "object" && v !== null && "name" in v && "arrayBuffer" in v) {
          return [v as unknown as FileLike];
        }
        return [];
      });
      if (files.length === 0) {
        return c.json({ error: "missing 'file' form field" }, 400);
      }
      // Save all files to tmp first so we can stream parse events back.
      const uploads: Array<{ file: FileLike; tmpPath: string }> = [];
      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase() || ".pdf";
        if (ext !== ".pdf") {
          return c.json(
            { error: `${file.name}: only PDF files are supported for entry summaries (got ${ext})` },
            400,
          );
        }
        const tmpPath = path.join(os.tmpdir(), `customs-entry-${randomUUID()}${ext}`);
        const bytes = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(tmpPath, bytes);
        tmpPaths.push(tmpPath);
        uploads.push({ file, tmpPath });
      }

      // Parse each PDF in parallel into a HistoricalEntry. Importer name from
      // the first successful parse wins.
      const parsed = await Promise.all(
        uploads.map(async (u) => {
          const { result } = await parseEntrySummary(ctx, u.tmpPath);
          return { filename: u.file.name, entry: result.entry, importer: result.importer };
        }),
      );
      const importer = parsed[0]?.importer ?? "Unknown importer";
      historical = {
        importer,
        generated_at: new Date().toISOString(),
        entries: parsed.map((p) => p.entry),
      };
      parsedFromPdfFilenames = parsed.map((p) => p.filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await Promise.all(tmpPaths.map((p) => fs.rm(p, { force: true })));
      return c.json({ error: `entry-summary parsing failed: ${msg}` }, 400);
    } finally {
      await Promise.all(tmpPaths.map((p) => fs.rm(p, { force: true })));
    }
  } else {
    // JSON body path.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "request body must be valid JSON" }, 400);
    }
    const result = FindRefundsJsonBody.safeParse(body);
    if (!result.success) {
      return c.json({ error: `invalid HistoricalEntries: ${result.error.message}` }, 400);
    }
    historical = result.data;
  }
  // Defense in depth — strip _ground_truth_correct_hts from the agent input.
  const safeHistorical = {
    ...historical,
    entries: historical.entries.map((e) => ({
      ...e,
      line_items: e.line_items.map((li) => {
        const { _ground_truth_correct_hts: _omit, ...rest } = li;
        return rest;
      }),
    })),
  };

  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    const emit = async (obj: unknown): Promise<void> => {
      await s.write(JSON.stringify(obj) + "\n");
    };

    try {
      if (parsedFromPdfFilenames.length > 0) {
        await emit({
          type: "entries_parsed_from_pdf",
          source_filenames: parsedFromPdfFilenames,
          entries: historical.entries.map((e) => ({
            entry_number: e.entry_number,
            entry_date: e.entry_date,
            port_of_entry: e.port_of_entry,
            country_of_origin: e.country_of_origin,
            line_count: e.line_items.length,
          })),
        });
      }
      const totalLines = historical.entries.reduce((a, e) => a + e.line_items.length, 0);
      await emit({
        type: "status",
        importer: historical.importer,
        message: `Analyzing ${historical.entries.length} entries (${totalLines} line items)…`,
        total_lines: totalLines,
      });

      const { findings } = await findRefundOpportunities(ctx, safeHistorical, {
        asOf: new Date(),
        concurrency: CONCURRENCY,
        onLineAnalyzed: async (event) => {
          await emit({ type: "line_analyzed", ...event });
        },
      });
      await emit({ type: "status", message: "Compiling findings…" });
      await emit({ type: "done", findings });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await emit({ type: "error", message: msg });
    }
  });
});

// ── POST /api/render-refund-pdf ───────────────────────────────────────────
// Accepts a PSCFindings JSON body, returns the rendered PDF as binary.
apiRoute.post("/render-refund-pdf", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const parsed = PSCFindings.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: `invalid PSCFindings: ${parsed.error.message}` }, 400);
  }
  const pdf = await renderRefundReportToBuffer(parsed.data);
  c.header("content-type", "application/pdf");
  c.header(
    "content-disposition",
    `attachment; filename="refund-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
  );
  // Hono accepts ArrayBuffer / Uint8Array bodies; cast Buffer view explicitly.
  return c.body(pdf as unknown as ArrayBuffer);
});

// ── Broker copilot: queue + per-customer SKU memory + correction ─────────
// All keyed on the demo customer for now. Production multi-tenant routes
// would scope by importer-of-record on auth.
//
// GET  /api/broker/sku-memory       — list all SKU memory rows
// POST /api/broker/confirm          — broker approves an agent prediction
//                                     ({ description, hts_code })
// POST /api/broker/correct          — broker edits a classification
//                                     ({ description, hts_code }) — same
//                                     handler as confirm but semantically
//                                     a "this was wrong, here's what it
//                                     should be" action.
apiRoute.get("/broker/sku-memory", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  await seedSkuMemoryIfEmpty(ctx, customerId);
  const rows = await listSkuMemory(ctx, customerId);
  return c.json({ customer_id: customerId, rows });
});

// Enriched broker queue: each line with real duty exposure, classifier
// confidence, and concrete review flags. Deterministic — no LLM.
apiRoute.get("/broker/queue", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  await seedSkuMemoryIfEmpty(ctx, customerId);
  const queue = await buildBrokerQueue(ctx, customerId);
  return c.json(queue);
});

const BrokerConfirmBody = z.object({
  description: z.string().min(1),
  hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/, "must be 10-digit XXXX.XX.XX.XX"),
});

async function handleBrokerCorrect(c: import("hono").Context<HonoEnv>) {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = BrokerConfirmBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const customerId = await ensureDemoCustomer(ctx);
  await upsertSkuMemory(ctx, {
    customer_id: customerId,
    description: parsed.data.description,
    hts_code: parsed.data.hts_code,
    classification_id: null,
    source: "broker",
  });
  return c.json({ ok: true });
}
apiRoute.post("/broker/confirm", handleBrokerCorrect);
apiRoute.post("/broker/correct", handleBrokerCorrect);

// ── POST /api/counterfactual ────────────────────────────────────────────
// Given a classified line, propose tariff-engineering alternatives with
// their duty calc'd deterministically. Body:
//   { description, filed_hts_code_8, filed_country_iso2,
//     customs_value_usd_cents, filed_total_duty_usd_cents }
const CounterfactualBody = z.object({
  description: z.string().min(1),
  filed_hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
  filed_country_iso2: z.string().regex(/^[A-Z]{2}$/),
  customs_value_usd_cents: z.number().int().nonnegative(),
  filed_total_duty_usd_cents: z.number().int().nonnegative(),
});
// ── POST /api/audit-defense ──────────────────────────────────────────────
// Generate a simulated CBP focused-assessment Q&A packet for a single
// classification or refund opportunity.
const AuditDefenseBody = z.object({
  description: z.string().min(1),
  hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
  gri_rule_applied: z.string(),
  reasoning: z.string(),
  citations: z.array(z.string()),
  alternative_codes_considered: z.array(
    z.object({ hts_code: z.string(), rejected_because: z.string() }),
  ),
  missing_inputs_for_precision: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  country_of_origin: z.string().optional(),
  filed_hts_code_8: z.string().optional(),
  recoverable_usd_cents: z.number().int().optional(),
});
apiRoute.post("/audit-defense", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = AuditDefenseBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    const result = await generateAuditDefense(ctx, parsed.data);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/cross-verify ───────────────────────────────────────────────
// Queries the actual CBP CROSS rulings database and asks Claude whether
// the predicted code aligns with how CBP has classified materially
// similar articles. Different from /api/audit-defense (which uses only
// the classifier's own trace) — this brings new external information.
const CrossVerifyBody = z.object({
  description: z.string().min(1),
  predicted_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  predicted_hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
});
apiRoute.post("/cross-verify", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = CrossVerifyBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    const result = await verifyAgainstCross(ctx, parsed.data);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/debate ──────────────────────────────────────────────────
// Adversarial broker debate. Advocate / challenger / judge agents in
// sequence; transcript returned.
const DebateBody = z.object({
  description: z.string().min(1),
  predicted_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  predicted_hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
  classifier_reasoning: z.string(),
  classifier_citations: z.array(z.string()),
  alternative_codes_considered: z.array(
    z.object({ hts_code: z.string(), rejected_because: z.string() }),
  ),
});
apiRoute.post("/debate", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = DebateBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    const result = await runDebate(ctx, parsed.data);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── GET /api/regulatory-watch ─────────────────────────────────────────
// Fetches recent Federal Register documents from CBP / USTR / ITA /
// USITC, parses each with Claude for HTS / country / direction impact,
// and cross-references the current customer's SKU memory.
apiRoute.get("/regulatory-watch", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  try {
    const result = await runTariffWatch(ctx, customerId);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── Mock ACE Importer Portal ─────────────────────────────────────────
// Real HTML pages the demo browser agent navigates. In production the
// agent points at the live ACE portal; these endpoints exist so the
// pattern is demonstrable end-to-end on localhost.
apiRoute.get("/portal/login", (c) => {
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(renderLogin());
});
apiRoute.post("/portal/login", async (c) => {
  const form = await c.req.formData();
  const username = form.get("username")?.toString() ?? null;
  const password = form.get("password")?.toString() ?? null;
  if (!isValidLogin(username, password)) {
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(renderLogin("Invalid email or password."));
  }
  return c.redirect("/api/portal/dashboard");
});
apiRoute.get("/portal/dashboard", (c) => {
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(renderDashboard());
});
apiRoute.get("/portal/entries", (c) => {
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(renderEntries());
});
apiRoute.get("/portal/entry/:idx/pdf", async (c) => {
  const idx = Number.parseInt(c.req.param("idx") ?? "", 10);
  const bytes = await loadEntryPdf(idx);
  if (!bytes) return c.json({ error: "no such entry" }, 404);
  const meta = MOCK_ENTRIES[idx]!;
  c.header("content-type", "application/pdf");
  c.header("content-disposition", `attachment; filename="${meta.number}.pdf"`);
  return c.body(bytes as unknown as ArrayBuffer);
});

// ── POST /api/ace-agent ──────────────────────────────────────────────
// Drives the ACE portal end-to-end with a real Playwright browser, then
// runs the refund finder on the importer's pulled entries — one continuous
// flow. Streams browser step events (with screenshots) followed by refund
// analysis events as NDJSON.
apiRoute.post("/ace-agent", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);
  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    const emit = async (obj: unknown) => {
      await s.write(JSON.stringify(obj) + "\n");
    };
    const base = `${new URL(c.req.url).origin}/api/portal`;
    try {
      await runAceBrowserAgent({
        portal_base_url: base,
        username: "imports@atlasretail.com",
        password: "Atl@s2026!",
        onEvent: emit,
      });

      // The browser pulled the importer's entry summaries; now run the
      // refund finder on this importer's entry history. Kept to a handful
      // of entries so the end-to-end flow stays snappy on screen.
      await emit({ type: "refund_status", message: "Running the refund finder on the pulled entries…" });
      const raw = await fs.readFile(
        path.resolve(process.cwd(), "data/sample-entries/amazon-fba.json"),
        "utf8",
      );
      const parsedEntries = HistoricalEntries.safeParse(JSON.parse(raw));
      if (parsedEntries.success) {
        // Analyze exactly the entries the portal listed and the agent pulled.
        const pulled = new Set(MOCK_ENTRIES.map((e) => e.number));
        const matched = parsedEntries.data.entries.filter((e) => pulled.has(e.entry_number));
        const sliced = {
          ...parsedEntries.data,
          entries: matched.length > 0 ? matched : parsedEntries.data.entries.slice(0, 4),
        };
        const safe = {
          ...sliced,
          entries: sliced.entries.map((e) => ({
            ...e,
            line_items: e.line_items.map((li) => {
              const { _ground_truth_correct_hts: _omit, ...rest } = li;
              return rest;
            }),
          })),
        };
        const totalLines = safe.entries.reduce((a, e) => a + e.line_items.length, 0);
        await emit({ type: "refund_status", message: `Re-classifying ${totalLines} line items across ${safe.entries.length} entries…`, total_lines: totalLines });
        const { findings } = await findRefundOpportunities(ctx, safe, {
          asOf: new Date(),
          concurrency: CONCURRENCY,
          onLineAnalyzed: async (event) => {
            await emit({ type: "refund_line", ...event });
          },
        });
        await emit({ type: "refund_done", findings });
      }
    } catch (e) {
      await emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  });
});

apiRoute.post("/counterfactual", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = CounterfactualBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    const result = await generateCounterfactuals(ctx, parsed.data);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/control-room ───────────────────────────────────────────────
// The showpiece: fires the whole agent fleet on ONE product, in sequence,
// streaming each agent's status (queued -> running -> done) and result so
// the UI can render a live agent-orchestration view. Each agent is wrapped
// so one failure degrades that node without killing the run.
const ControlRoomBody = z.object({
  description: z.string().min(1).default("Clear silicone protective case that snaps onto an iPhone, with raised camera bezel"),
  country_of_origin: z.string().default("CN"),
  customs_value_usd_cents: z.number().int().positive().default(400000),
});
apiRoute.post("/control-room", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);
  let body: unknown = {};
  try { body = await c.req.json(); } catch { /* defaults */ }
  const input = ControlRoomBody.parse(body ?? {});
  const isoCountry = toIsoAlpha2(input.country_of_origin);

  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    // Serialize writes — downstream agents run concurrently and emit at the
    // same time, so chain writes to avoid interleaving partial JSON lines.
    let writeChain: Promise<unknown> = Promise.resolve();
    const emit = (o: unknown) => {
      writeChain = writeChain.then(() => s.write(JSON.stringify(o) + "\n"));
      return writeChain;
    };
    const agent = (id: string, status: string, extra: Record<string, unknown> = {}) =>
      emit({ type: "agent", id, status, ...extra });

    await emit({ type: "start", input });

    // 1. CLASSIFIER (includes retrieval; streams reasoning)
    let classification: Awaited<ReturnType<typeof classify>>["result"] | null = null;
    let candidateCount = 0;
    await agent("classifier", "running");
    try {
      const { result, trace } = await classify(
        ctx,
        { description: input.description, country_of_origin: isoCountry, customer_id: await ensureDemoCustomer(ctx) },
        { onReasoningDelta: (delta) => void emit({ type: "reasoning_delta", delta }) },
      );
      classification = result;
      candidateCount = trace.candidates.length;
      await agent("classifier", "done", {
        hts_code: result.hts_code,
        hts_code_8: result.hts_code_8,
        confidence: result.confidence,
        gri_rule_applied: result.gri_rule_applied,
        citations: result.citations,
        candidate_count: candidateCount,
      });
    } catch (e) {
      await agent("classifier", "error", { message: e instanceof Error ? e.message : String(e) });
    }

    if (!classification) {
      await emit({ type: "done", dossier: null });
      return;
    }

    // 2. DUTY (deterministic; full landed for one line)
    let duty: Awaited<ReturnType<typeof calculateDuty>> | null = null;
    await agent("duty", "running");
    try {
      duty = await calculateDuty(ctx, {
        hts_code: classification.hts_code_8,
        country_of_origin: isoCountry,
        customs_value_usd_cents: input.customs_value_usd_cents,
        transport_mode: "ocean",
      });
      await agent("duty", "done", {
        total_duty_usd_cents: duty.total_duty_usd_cents,
        components: duty.components.map((x) => ({ kind: x.kind, rate: x.rate, amount_usd_cents: x.amount_usd_cents })),
      });
    } catch (e) {
      await agent("duty", "error", { message: e instanceof Error ? e.message : String(e) });
    }

    // 3–6. The downstream agents depend only on the classification, not on
    // each other — so fire them concurrently. The UI lights up all four at
    // once and they resolve independently.
    const cls = classification;
    await Promise.all([agent("cross", "running"), agent("debate", "running"), agent("counterfactual", "running"), agent("audit", "running")]);

    const crossTask = (async () => {
      try {
        const r = await verifyAgainstCross(ctx, {
          description: input.description,
          predicted_hts_code: cls.hts_code,
          predicted_hts_code_8: cls.hts_code_8,
        });
        await agent("cross", "done", {
          agrees: r.defense.agrees_with_predicted,
          confidence: r.defense.confidence,
          suggested_hts_code: r.defense.suggested_hts_code,
          evidence_count: r.defense.evidence.length,
          top_ruling: r.defense.evidence[0]?.ruling_number ?? null,
        });
      } catch (e) {
        await agent("cross", "error", { message: e instanceof Error ? e.message : String(e) });
      }
    })();

    const debateTask = (async () => {
      try {
        const d = await runDebate(ctx, {
          description: input.description,
          predicted_hts_code: cls.hts_code,
          predicted_hts_code_8: cls.hts_code_8,
          classifier_reasoning: cls.reasoning,
          classifier_citations: cls.citations,
          alternative_codes_considered: cls.alternative_codes_considered,
        });
        await agent("debate", "done", {
          winner: d.judge.winner,
          final_hts_code: d.judge.final_hts_code,
          advocate_code: d.advocate.defended_hts_code,
          challenger_code: d.challenger.alternative_hts_code,
          revised: d.revised,
        });
      } catch (e) {
        await agent("debate", "error", { message: e instanceof Error ? e.message : String(e) });
      }
    })();

    const cfTask = (async () => {
      try {
        const cf = await generateCounterfactuals(ctx, {
          description: input.description,
          filed_hts_code_8: cls.hts_code_8,
          filed_country_iso2: isoCountry,
          customs_value_usd_cents: input.customs_value_usd_cents,
          filed_total_duty_usd_cents: duty?.total_duty_usd_cents ?? 0,
        });
        const best = cf.scenarios[0] ?? null;
        await agent("counterfactual", "done", {
          scenario_count: cf.scenarios.length,
          best_label: best?.label ?? null,
          best_savings_usd_cents: best?.savings_usd_cents ?? 0,
          best_kind: best?.kind ?? null,
        });
      } catch (e) {
        await agent("counterfactual", "error", { message: e instanceof Error ? e.message : String(e) });
      }
    })();

    const auditTask = (async () => {
      try {
        const ad = await generateAuditDefense(ctx, {
          description: input.description,
          hts_code: cls.hts_code,
          hts_code_8: cls.hts_code_8,
          gri_rule_applied: cls.gri_rule_applied,
          reasoning: cls.reasoning,
          citations: cls.citations,
          alternative_codes_considered: cls.alternative_codes_considered,
          missing_inputs_for_precision: cls.missing_inputs_for_precision,
          confidence: cls.confidence,
          country_of_origin: isoCountry,
        });
        await agent("audit", "done", {
          question_count: ad.defense.questions.length,
          primary_risk: ad.defense.primary_risk,
          readiness: ad.defense.overall_readiness,
        });
      } catch (e) {
        await agent("audit", "error", { message: e instanceof Error ? e.message : String(e) });
      }
    })();

    await Promise.all([crossTask, debateTask, cfTask, auditTask]);

    await emit({
      type: "done",
      dossier: {
        description: input.description,
        country: isoCountry,
        hts_code: classification.hts_code,
        confidence: classification.confidence,
        total_duty_usd_cents: duty?.total_duty_usd_cents ?? null,
      },
    });
  });
});

// ── POST /api/copilot ────────────────────────────────────────────────────
// Conversational tool-using agent. Body { messages: [{role, content}] }.
// Streams text_delta / tool_call / tool_result / done as NDJSON.
const CopilotBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1)
    .max(40),
});
apiRoute.post("/copilot", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = CopilotBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    let chain: Promise<unknown> = Promise.resolve();
    const emit = async (o: unknown): Promise<void> => {
      chain = chain.then(() => s.write(JSON.stringify(o) + "\n"));
      await chain;
    };
    await runCopilot(ctx, parsed.data.messages, emit);
  });
});

// ── POST /api/simulate ───────────────────────────────────────────────────
// Portfolio-level tariff-policy shock simulation over the importer's whole
// SKU catalog. Deterministic, instant.
const SimulateBody = z.object({
  section_301_rate: z.number().min(0).max(1).nullable().default(null),
  reciprocal_rate: z.number().min(0).max(1).default(0),
  section_232_enabled: z.boolean().default(true),
  reroute_china_to: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  unit_cost_premium_pct: z.number().min(0).max(2).default(0),
  switching_cost_usd_cents: z.number().int().min(0).default(0),
  include_entry_fees: z.boolean().default(true),
});
// The "today" baseline scenario: table rates, no reciprocal, 232 on, no reroute.
const BASELINE_SCENARIO = {
  section_301_rate: null,
  reciprocal_rate: 0,
  section_232_enabled: true,
  reroute_china_to: null,
  unit_cost_premium_pct: 0,
  switching_cost_usd_cents: 0,
  include_entry_fees: true,
} as const;
apiRoute.post("/simulate", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  await seedSkuMemoryIfEmpty(ctx, customerId);
  let body: unknown = {};
  try { body = await c.req.json(); } catch { /* defaults */ }
  const parsed = SimulateBody.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const result = await runTariffSimulation(ctx, customerId, parsed.data);
  return c.json(result);
});

// ── GET /api/catalog ─────────────────────────────────────────────────────
// Portfolio overview of the importer's catalog: every SKU with its code,
// representative annual value, annual duty, and effective rate. Reuses the
// simulator's baseline pass (no scenario), sorted by duty exposure.
apiRoute.get("/catalog", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  await seedSkuMemoryIfEmpty(ctx, customerId);
  // Catalog shows per-SKU duty exposure; exclude entry-level fees so the
  // column sum reconciles with the reported total.
  const sim = await runTariffSimulation(ctx, customerId, { ...BASELINE_SCENARIO, include_entry_fees: false });
  const rows = sim.rows
    .map((r) => ({
      description: r.description,
      hts_code_8: r.hts_code_8,
      chapter: r.chapter,
      origin: r.origin,
      annual_value_usd_cents: r.annual_value_usd_cents,
      annual_duty_usd_cents: r.baseline_duty_usd_cents,
      effective_rate: r.annual_value_usd_cents > 0 ? r.baseline_duty_usd_cents / r.annual_value_usd_cents : 0,
    }))
    .sort((a, b) => b.annual_duty_usd_cents - a.annual_duty_usd_cents);
  return c.json({
    total_value_usd_cents: sim.baseline_value_usd_cents,
    total_duty_usd_cents: sim.baseline_stack.total_usd_cents,
    sku_count: rows.length,
    rows,
  });
});

// ── POST /api/sourcing-intel ─────────────────────────────────────────────
// Second-order strategy for one SKU: relocation options (duty-priced),
// customs-relief mechanisms, and second-order effects.
const SourcingIntelBody = z.object({
  description: z.string().min(1),
  hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
  current_country_iso2: z.string().regex(/^[A-Z]{2}$/).default("CN"),
  annual_value_usd_cents: z.number().int().positive(),
});
apiRoute.post("/sourcing-intel", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = SourcingIntelBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    const result = await analyzeSourcing(ctx, parsed.data);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/reroute-intel ──────────────────────────────────────────────
// Policy Lab destination brief: researches one destination country for the
// importer's whole catalog (named clusters, blended cost index, labor,
// freight, risks) and returns the unit-cost premium the lab feeds into
// break-even economics.
const COUNTRY_NAMES: Record<string, string> = { VN: "Vietnam", MX: "Mexico", IN: "India", TH: "Thailand", MY: "Malaysia", ID: "Indonesia", BD: "Bangladesh", KH: "Cambodia" };
const RerouteIntelBody = z.object({
  destination_iso2: z.string().regex(/^[A-Z]{2}$/),
});
apiRoute.post("/reroute-intel", async (c) => {
  const ctx = c.var.ctx;
  const customerId = await ensureDemoCustomer(ctx);
  await seedSkuMemoryIfEmpty(ctx, customerId);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = RerouteIntelBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const iso = parsed.data.destination_iso2.toUpperCase();

  // Build a category summary from the importer's catalog so the research is
  // about THIS catalog's product mix, not a generic country profile.
  const skus = await listSkuMemory(ctx, customerId, 100);
  const category_summary = skus.length > 0
    ? skus.slice(0, 10).map((s) => s.canonical_description).join("; ")
    : "Consumer electronics and accessories imported from China (Amazon FBA catalog)";

  try {
    const result = await analyzeReroute(ctx, {
      destination_iso2: iso,
      destination_name: COUNTRY_NAMES[iso] ?? iso,
      category_summary,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/quote ──────────────────────────────────────────────────────
// Instant landed-cost quote: classify a product, price the full duty stack,
// estimate freight, and return a shareable total landed cost.
const QUOTE_ISO2: Record<string, string> = {
  china: "CN", vietnam: "VN", india: "IN", mexico: "MX", thailand: "TH",
  malaysia: "MY", indonesia: "ID", taiwan: "TW", "south korea": "KR", korea: "KR",
  japan: "JP", germany: "DE", italy: "IT", "united states": "US", usa: "US", cambodia: "KH", bangladesh: "BD",
};
function toIso2(s: string): string {
  const k = s.trim().toLowerCase();
  return QUOTE_ISO2[k] ?? (s.length === 2 ? s.toUpperCase() : s.toUpperCase().slice(0, 2));
}
const QuoteBody = z.object({
  description: z.string().min(3),
  customs_value_usd_cents: z.number().int().positive(),
  country_of_origin: z.string().min(2),
  transport_mode: z.enum(["ocean", "air"]).default("ocean"),
});
apiRoute.post("/quote", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = QuoteBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { description, customs_value_usd_cents: value, transport_mode } = parsed.data;
  const iso2 = toIso2(parsed.data.country_of_origin);

  try {
    const { result } = await classify(ctx, { description, country_of_origin: iso2 });
    const duty = await calculateDuty(ctx, {
      hts_code: result.hts_code,
      country_of_origin: iso2,
      customs_value_usd_cents: value,
      transport_mode,
    });
    // Rough freight estimate (clearly an estimate; real quote depends on lane,
    // volume, and Incoterms). Ocean ~2.5% of value (min $200); air ~9% (min $350).
    const freight = transport_mode === "air"
      ? Math.max(35000, Math.round(value * 0.09))
      : Math.max(20000, Math.round(value * 0.025));
    const landed = value + duty.total_duty_usd_cents + freight;
    return c.json({
      classification: {
        hts_code: result.hts_code,
        hts_code_8: result.hts_code_8,
        confidence: result.confidence,
        precision_level: result.precision_level,
        gri_rule_applied: result.gri_rule_applied,
        citations: result.citations,
        reasoning: result.reasoning,
        alternative_codes_considered: result.alternative_codes_considered,
      },
      country_of_origin: iso2,
      transport_mode,
      customs_value_usd_cents: value,
      duty,
      freight_estimate_usd_cents: freight,
      landed_cost_usd_cents: landed,
      effective_duty_rate: value > 0 ? duty.total_duty_usd_cents / value : 0,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST /api/factory-finder ─────────────────────────────────────────────
// Deep agentic factory research: named factories with capabilities, openings,
// and a temporary-vs-long-term horizon assessment.
const FactoryFinderBody = z.object({
  product_description: z.string().min(3),
  country_iso2: z.string().regex(/^[A-Z]{2}$/),
  country_name: z.string().optional(),
});
apiRoute.post("/factory-finder", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = FactoryFinderBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const iso = parsed.data.country_iso2.toUpperCase();

  // Stream NDJSON: the research takes 60–90s, longer than a buffering proxy
  // will hold an idle connection. An immediate status + periodic heartbeats
  // keep the connection alive; the result arrives in a final "done" event.
  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (o: unknown): Promise<unknown> => {
      chain = chain.then(() => s.write(JSON.stringify(o) + "\n"));
      return chain;
    };
    await emit({ type: "status", message: `Searching for factories in ${parsed.data.country_name ?? iso}…` });
    let finished = false;
    const heartbeat = (async () => {
      while (!finished) {
        await new Promise((r) => setTimeout(r, 8000));
        if (finished) break;
        await emit({ type: "status", message: "Researching capabilities, capacity, and customers…" });
      }
    })();
    try {
      const result = await findFactories(ctx, {
        product_description: parsed.data.product_description,
        country_iso2: iso,
        country_name: parsed.data.country_name ?? (COUNTRY_NAMES[iso] ?? iso),
      });
      finished = true;
      await emit({ type: "done", result });
    } catch (e) {
      finished = true;
      await emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
    await heartbeat;
  });
});

// ── POST /api/factory-deepdive ───────────────────────────────────────────
// Focused second-pass research on ONE named factory, plus a draft RFQ email.
// Streams NDJSON (status heartbeats + final result).
const FactoryDeepDiveBody = z.object({
  factory_name: z.string().min(2),
  city: z.string().min(1),
  country_name: z.string().min(2),
  product_description: z.string().min(3),
});
apiRoute.post("/factory-deepdive", async (c) => {
  const ctx = c.var.ctx;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "request body must be valid JSON" }, 400); }
  const parsed = FactoryDeepDiveBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return stream(c, async (s) => {
    c.header("content-type", "application/x-ndjson");
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (o: unknown): Promise<unknown> => { chain = chain.then(() => s.write(JSON.stringify(o) + "\n")); return chain; };
    await emit({ type: "status", message: `Researching ${parsed.data.factory_name}…` });
    let finished = false;
    const heartbeat = (async () => {
      while (!finished) {
        await new Promise((r) => setTimeout(r, 8000));
        if (finished) break;
        await emit({ type: "status", message: "Pulling ownership, facilities, customers, and risk signals…" });
      }
    })();
    try {
      const result = await deepDiveFactory(ctx, parsed.data);
      finished = true;
      await emit({ type: "done", result });
    } catch (e) {
      finished = true;
      await emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
    await heartbeat;
  });
});

void z; // keep zod import even if no top-level uses inside this file
