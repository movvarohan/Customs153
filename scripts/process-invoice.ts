// End-to-end invoice processing CLI.
//
//   npm run process-invoice -- path/to/invoice.pdf
//
// 1. Reads the document.
// 2. extract() → structured ExtractedShipment.
// 3. classify() each line item → HTS classification with confidence.
// 4. Prints a console table.
// 5. Writes the full result to .data/processed/<timestamp>.json.

import { promises as fs } from "node:fs";
import path from "node:path";
import { buildLocalContext } from "@/adapters/local";
import { extract } from "@/core/agents/extractor";
import { classify } from "@/core/agents/classifier";
import { seedDemoFxRates } from "@/core/lib/fx-rates";
import { mapWithConcurrency } from "@/core/lib/concurrency";

/** Default Anthropic-call concurrency for the per-line classifier fan-out. */
const CLASSIFY_CONCURRENCY = Number(process.env.CLASSIFY_CONCURRENCY ?? 5);
import type { ExtractionResultT, ExtractedLineItemT } from "@/core/schemas/extraction";
import type { ClassificationResultT } from "@/core/schemas/classification";

interface ProcessedLine {
  line_index: number;
  line: ExtractedLineItemT;
  classification: ClassificationResultT;
  classification_latency_ms: number;
}

interface ProcessedDocument {
  source_path: string;
  extraction: ExtractionResultT;
  extraction_latency_ms: number;
  lines: ProcessedLine[];
  totals: {
    extraction_latency_ms: number;
    classification_latency_ms_sum: number;
    wall_time_ms: number;
  };
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("usage: npm run process-invoice -- <path/to/invoice.pdf>");
    process.exit(2);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!anthropicKey || !voyageKey) {
    console.error("ANTHROPIC_API_KEY and VOYAGE_API_KEY are required.");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? ".data";

  const ctx = await buildLocalContext({
    dataDir,
    anthropicApiKey: anthropicKey,
    voyageApiKey: voyageKey,
    config: {
      environment: "development",
      defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
      cheapModel: process.env.CHEAP_MODEL ?? "claude-haiku-4-5-20251001",
      hardModel: process.env.HARD_MODEL ?? "claude-opus-4-7",
    },
  });

  // Demo FX rates so the extractor can normalize non-USD invoice totals.
  await seedDemoFxRates(ctx);

  const wall0 = Date.now();

  // ── Step 1: extract ────────────────────────────────────────────────────
  console.log(`\n→ extracting ${inputPath}…`);
  const t0 = Date.now();
  const { result: extraction } = await extract(ctx, inputPath);
  const extractMs = Date.now() - t0;
  console.log(
    `  ${extraction.document_kind} · ${extraction.vendor} · invoice ${extraction.invoice_number} ${extraction.invoice_date} · ${extraction.line_items.length} lines · ${extractMs}ms`,
  );
  if (extraction.reconciliation_warning) {
    console.log(`  ⚠ reconciliation: ${extraction.reconciliation_warning}`);
  }
  if (extraction.requires_clarification.length > 0) {
    console.log(`  ⚠ vague descriptions on lines: ${extraction.requires_clarification.map((c) => c.line_index).join(", ")}`);
  }

  // ── Step 2: classify each line item (parallel, concurrency capped) ─────
  console.log(`\n→ classifying ${extraction.line_items.length} line items (concurrency=${CLASSIFY_CONCURRENCY})…`);
  const classifyT0 = Date.now();
  const settled = await mapWithConcurrency(
    extraction.line_items,
    CLASSIFY_CONCURRENCY,
    async (li) => {
      const coo = li.country_of_origin ?? extraction.country_of_origin;
      const t0 = Date.now();
      const { result } = await classify(ctx, {
        description: li.description,
        quantity: li.quantity,
        unit_value_usd: li.unit_value / 100,
        ...(coo ? { country_of_origin: coo } : {}),
      });
      return { result, latency_ms: Date.now() - t0 };
    },
  );
  const classifyMsSum = Date.now() - classifyT0;
  const lines: ProcessedLine[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    const li = extraction.line_items[i]!;
    if (s.status === "rejected") {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      process.stdout.write(`  [${String(i + 1).padStart(2)}/${extraction.line_items.length}] FAILED ${msg.slice(0, 70)}\n`);
      continue;
    }
    const result = s.value.result;
    const dur = s.value.latency_ms;
    lines.push({ line_index: i, line: li, classification: result, classification_latency_ms: dur });
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${extraction.line_items.length}] ${result.hts_code_8} (${result.confidence}) ${dur}ms\n`);
  }

  const wallMs = Date.now() - wall0;

  // ── Step 3: console table ──────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────────────────────────────────────────");
  console.log(` ${extraction.vendor}    invoice ${extraction.invoice_number}    ${extraction.invoice_date}`);
  console.log("────────────────────────────────────────────────────────────────────────────────");
  console.log(
    `${" #".padEnd(3)}  ${"description".padEnd(38)}  ${"qty".padStart(5)}  ${"unit$".padStart(8)}  ${"total$".padStart(9)}  ${"HTS 8-digit".padEnd(11)}  ${"conf".padEnd(6)}  missing`,
  );
  console.log("─".repeat(120));
  for (const pl of lines) {
    const desc = pl.line.description.length > 38 ? pl.line.description.slice(0, 35) + "…" : pl.line.description;
    const unit = (pl.line.unit_value / 100).toFixed(2);
    const total = (pl.line.total_value / 100).toFixed(2);
    const missing = pl.classification.missing_inputs_for_precision.length > 0 ? `(${pl.classification.missing_inputs_for_precision.length})` : "";
    console.log(
      `${String(pl.line_index + 1).padStart(2)}.  ${desc.padEnd(38)}  ${String(pl.line.quantity).padStart(5)}  ${unit.padStart(8)}  ${total.padStart(9)}  ${pl.classification.hts_code_8.padEnd(11)}  ${pl.classification.confidence.padEnd(6)}  ${missing}`,
    );
  }
  console.log("─".repeat(120));
  const usdTotal = extraction.total_value_usd_cents !== null
    ? `${(extraction.total_value_usd_cents / 100).toFixed(2)} USD`
    : `${(extraction.total_value / 100).toFixed(2)} ${extraction.currency} (no FX rate cached)`;
  console.log(`Invoice total: ${(extraction.total_value / 100).toFixed(2)} ${extraction.currency}    →    ${usdTotal}`);
  console.log("─".repeat(120));
  console.log(`Wall time:      ${wallMs} ms`);
  console.log(`  extraction:    ${extractMs} ms`);
  console.log(`  classification: ${classifyMsSum} ms wall (${lines.length} lines @ concurrency=${CLASSIFY_CONCURRENCY})`);

  // ── Step 4: persist ────────────────────────────────────────────────────
  const processed: ProcessedDocument = {
    source_path: path.resolve(inputPath),
    extraction,
    extraction_latency_ms: extractMs,
    lines,
    totals: {
      extraction_latency_ms: extractMs,
      classification_latency_ms_sum: classifyMsSum,
      wall_time_ms: wallMs,
    },
  };
  const outDir = path.join(dataDir, "processed");
  await fs.mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}-${timestamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(processed, null, 2));
  console.log(`\nfull result written to ${outPath}`);

  await ctx.db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
