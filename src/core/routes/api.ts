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
// Accepts multipart/form-data with a "file" field (PDF or image).
// Streams NDJSON events: status, extracted, line_classified, line_failed, done, error.
apiRoute.post("/process-invoice", async (c) => {
  const ctx = c.var.ctx;
  await seedDemoFxRates(ctx);

  let tmpPath: string | null = null;
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing 'file' form field" }, 400);
    }
    const ext = path.extname(file.name).toLowerCase() || ".pdf";
    tmpPath = path.join(os.tmpdir(), `customs-upload-${randomUUID()}${ext}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tmpPath, bytes);
    const savedTmpPath = tmpPath;

    return stream(c, async (s) => {
      c.header("content-type", "application/x-ndjson");
      const emit = async (obj: unknown): Promise<void> => {
        await s.write(JSON.stringify(obj) + "\n");
      };

      try {
        await emit({ type: "status", message: "Extracting line items from document…" });
        const t0 = Date.now();
        const { result: extraction } = await extract(ctx, savedTmpPath);
        const extractMs = Date.now() - t0;
        await emit({ type: "extracted", extraction, latency_ms: extractMs });

        await emit({
          type: "status",
          message: `Classifying ${extraction.line_items.length} line items (concurrency ${CONCURRENCY})…`,
        });

        const settled = await mapWithConcurrency(
          extraction.line_items,
          CONCURRENCY,
          async (li, idx) => {
            const coo = li.country_of_origin ?? extraction.country_of_origin;
            const tStart = Date.now();
            try {
              const { result } = await withRetry(
                () =>
                  classify(ctx, {
                    description: li.description,
                    quantity: li.quantity,
                    unit_value_usd: li.unit_value / 100,
                    ...(coo ? { country_of_origin: coo } : {}),
                  }),
                { attempts: 3, baseMs: 2000 },
              );
              const dur = Date.now() - tStart;
              await emit({ type: "line_classified", index: idx, classification: result, latency_ms: dur });
              return { ok: true as const, result, latency_ms: dur };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await emit({ type: "line_failed", index: idx, error: msg });
              return { ok: false as const, error: msg };
            }
          },
        );

        const lines = settled.map((r, i) => ({
          line_index: i,
          line: extraction.line_items[i]!,
          classification:
            r.status === "fulfilled" && r.value.ok ? r.value.result : null,
          error:
            r.status === "fulfilled" && !r.value.ok
              ? r.value.error
              : r.status === "rejected"
                ? String(r.reason)
                : null,
        }));
        const classifiedOk = lines.filter((l) => l.classification !== null).length;
        const failed = lines.length - classifiedOk;

        await emit({
          type: "done",
          extraction,
          lines,
          summary: {
            total_lines: lines.length,
            classified_ok: classifiedOk,
            failed,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await emit({ type: "error", message: msg });
      } finally {
        if (savedTmpPath) {
          await fs.rm(savedTmpPath, { force: true });
        }
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (tmpPath) await fs.rm(tmpPath, { force: true });
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
        message: `Analyzing ${historical.entries.length} entries (${totalLines} line items)…`,
        total_lines: totalLines,
      });

      // psc-finder doesn't expose per-line callbacks, so emit a single status
      // message and then the full result. For the demo a single in-flight
      // status is fine; the client shows an animated progress hint.
      const { findings } = await findRefundOpportunities(ctx, safeHistorical, {
        asOf: new Date(),
        concurrency: CONCURRENCY,
      });
      await emit({
        type: "status",
        message: "Compiling findings…",
      });
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
