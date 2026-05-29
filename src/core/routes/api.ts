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

void z; // keep zod import even if no top-level uses inside this file
