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
import { findRefundOpportunities } from "@/core/agents/psc-finder";
import { renderRefundReportToBuffer } from "@/core/lib/render-refund-pdf";
import { mapWithConcurrency } from "@/core/lib/concurrency";
import { withRetry } from "@/core/lib/retry";
import { seedDemoFxRates } from "@/core/lib/fx-rates";
import { HistoricalEntries, PSCFindings } from "@/core/schemas/refund";

const CONCURRENCY = 5;

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
// Each file is extracted independently; line items from all files are
// classified together. Events carry file_index so the UI can render
// per-document tables.
//
// Events: status, extracted (per file), line_classified, line_failed, done, error.
apiRoute.post("/process-invoice", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);

  const tmpPaths: string[] = [];
  try {
    const formData = await c.req.formData();
    const fileEntries = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (fileEntries.length === 0) {
      return c.json({ error: "missing 'file' form field" }, 400);
    }

    const uploads: Array<{ file: File; tmpPath: string }> = [];
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
              : `Extracting line items from ${uploads.length} documents…`,
        });

        // Extract each file. Run sequentially to avoid hammering Anthropic
        // with multi-page PDFs in parallel.
        const documents: Array<{
          file_index: number;
          filename: string;
          extraction: Awaited<ReturnType<typeof extract>>["result"];
          extract_latency_ms: number;
        }> = [];
        for (let i = 0; i < uploads.length; i++) {
          const u = uploads[i]!;
          const t0 = Date.now();
          const { result: extraction } = await extract(ctx, u.tmpPath);
          const extractMs = Date.now() - t0;
          documents.push({
            file_index: i,
            filename: u.file.name,
            extraction,
            extract_latency_ms: extractMs,
          });
          await emit({
            type: "extracted",
            file_index: i,
            filename: u.file.name,
            extraction,
            latency_ms: extractMs,
          });
        }

        // Build a flat work list of (file_index, line_index, line) tuples.
        const tasks = documents.flatMap((doc) =>
          doc.extraction.line_items.map((li, line_index) => ({
            file_index: doc.file_index,
            line_index,
            line: li,
            country_of_origin: li.country_of_origin ?? doc.extraction.country_of_origin,
          })),
        );

        await emit({
          type: "status",
          message: `Classifying ${tasks.length} line items (concurrency ${CONCURRENCY})…`,
        });

        const settled = await mapWithConcurrency(tasks, CONCURRENCY, async (t) => {
          const tStart = Date.now();
          try {
            const { result } = await withRetry(
              () =>
                classify(ctx, {
                  description: t.line.description,
                  quantity: t.line.quantity,
                  unit_value_usd: t.line.unit_value / 100,
                  ...(t.country_of_origin ? { country_of_origin: t.country_of_origin } : {}),
                }),
              { attempts: 3, baseMs: 2000 },
            );
            const dur = Date.now() - tStart;
            await emit({
              type: "line_classified",
              file_index: t.file_index,
              line_index: t.line_index,
              classification: result,
              latency_ms: dur,
            });
            return { ok: true as const, result, latency_ms: dur };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await emit({
              type: "line_failed",
              file_index: t.file_index,
              line_index: t.line_index,
              error: msg,
            });
            return { ok: false as const, error: msg };
          }
        });

        const lines = settled.map((r, i) => {
          const t = tasks[i]!;
          return {
            file_index: t.file_index,
            line_index: t.line_index,
            line: t.line,
            classification:
              r.status === "fulfilled" && r.value.ok ? r.value.result : null,
            error:
              r.status === "fulfilled" && !r.value.ok
                ? r.value.error
                : r.status === "rejected"
                  ? String(r.reason)
                  : null,
          };
        });
        const classifiedOk = lines.filter((l) => l.classification !== null).length;

        await emit({
          type: "done",
          documents,
          lines,
          summary: {
            total_documents: documents.length,
            total_lines: lines.length,
            classified_ok: classifiedOk,
            failed: lines.length - classifiedOk,
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
