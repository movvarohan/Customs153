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
import { calculateDuty } from "@/core/agents/duty-calculator";
import { findRefundOpportunities } from "@/core/agents/psc-finder";
import { renderRefundReportToBuffer } from "@/core/lib/render-refund-pdf";
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
            const { result: classification } = await withRetry(
              () =>
                classify(ctx, {
                  description: t.line.description,
                  quantity: t.line.quantity,
                  unit_value_usd: t.line.unit_value / 100,
                  ...(t.country_of_origin ? { country_of_origin: t.country_of_origin } : {}),
                }),
              { attempts: 3, baseMs: 2000 },
            );
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
                duty = await calculateDuty(ctx, {
                  hts_code: classification.hts_code_8,
                  country_of_origin: toIsoAlpha2(t.country_of_origin),
                  customs_value_usd_cents: lineUsdCents,
                  transport_mode: "ocean",
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
        const totalDutyUsdCents = finalLines.reduce(
          (a, l) => a + (l.duty?.total_duty_usd_cents ?? 0),
          0,
        );

        await emit({
          type: "done",
          extraction,
          source_filenames: filenames,
          lines: finalLines,
          summary: {
            total_documents: filenames.length,
            total_lines: finalLines.length,
            classified_ok: classifiedOk,
            failed: finalLines.length - classifiedOk,
            total_duty_usd_cents: totalDutyUsdCents,
            currency: extraction.currency,
            customs_value_usd_cents: extraction.total_value_usd_cents,
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
// Accepts a HistoricalEntries JSON body. Streams NDJSON events:
// status, line_classified, line_failed, done, error.
const FindRefundsBody = HistoricalEntries;

apiRoute.post("/find-refunds", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const parsed = FindRefundsBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: `invalid HistoricalEntries: ${parsed.error.message}` }, 400);
  }
  const historical = parsed.data;
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

void z; // keep zod import even if no top-level uses inside this file
