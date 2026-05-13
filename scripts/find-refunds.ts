// PSC / refund-finder CLI.
//
//   npm run find-refunds -- path/to/entries.json
//
// Reads a HistoricalEntries JSON, re-classifies every line via the
// classifier, computes duty under both filed and predicted codes, surfaces
// refund opportunities sorted by recoverable amount, and writes a full
// JSON report to .data/refund-reports/.
//
// Prints a clean broker-facing summary to stdout.

import { promises as fs } from "node:fs";
import path from "node:path";
import { buildLocalContext } from "@/adapters/local";
import { findRefundOpportunities } from "@/core/agents/psc-finder";
import { HistoricalEntries } from "@/core/schemas/refund";
import { seedDemoFxRates } from "@/core/lib/fx-rates";

function fmtCents(c: number): string {
  return (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("usage: npm run find-refunds -- <path/to/entries.json>");
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
  await seedDemoFxRates(ctx);

  const raw = await fs.readFile(path.resolve(inputPath), "utf8");
  const historical = HistoricalEntries.parse(JSON.parse(raw));
  console.log(`\n→ analyzing ${historical.entries.length} entries (${historical.importer})`);
  console.log(`  source: ${inputPath}`);

  // Strip the eval-only ground-truth field from what we pass to the finder.
  // Defense in depth — the finder code never reads it, but we make sure of it.
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

  const wall0 = Date.now();
  const { findings } = await findRefundOpportunities(ctx, safeHistorical, { asOf: new Date("2026-05-13T00:00:00Z") });
  const wallMs = Date.now() - wall0;

  // ── Summary block ────────────────────────────────────────────────────
  const recov = findings.total_recoverable_usd_cents;
  const high = findings.confidence_breakdown.high_usd_cents;
  const med = findings.confidence_breakdown.medium_usd_cents;

  console.log("\n" + "=".repeat(78));
  console.log(`  Analyzed ${findings.total_entries_analyzed} entries (${findings.total_line_items_analyzed} line items)`);
  console.log(`  We agreed with the filed classification on ${findings.agreements} / ${findings.total_line_items_analyzed} lines`);
  console.log(`  We disagreed on ${findings.disagreements} lines`);
  console.log(`  ${findings.refund_opportunities.length} refund opportunities surfaced (high+medium confidence)`);
  console.log(`  ${findings.uncertain_cases.length} uncertain cases (low confidence — broker review recommended)`);
  console.log(`  ${findings.outside_psc_window} entries outside the PSC filing window (require protest instead)`);
  console.log("");
  console.log(`  Total recoverable: $${fmtCents(recov)}`);
  console.log(`    high confidence:   $${fmtCents(high)}`);
  console.log(`    medium confidence: $${fmtCents(med)}`);
  const totalBar = recov === 0 ? 0 : 40;
  const highBar = recov === 0 ? 0 : Math.round((high / recov) * totalBar);
  const medBar = recov === 0 ? 0 : Math.round((med / recov) * totalBar);
  console.log(`    [${"█".repeat(highBar)}${"▒".repeat(medBar)}${" ".repeat(totalBar - highBar - medBar)}]`);
  console.log("=".repeat(78));

  // ── Top 10 opportunities table ────────────────────────────────────────
  console.log("\nTop 10 refund opportunities (by recoverable amount):");
  console.log("─".repeat(120));
  console.log(
    `${"entry".padEnd(18)}  ${"description".padEnd(38)}  ${"filed".padEnd(11)}  ${"→ ours".padEnd(11)}  ${"paid$".padStart(9)}  ${"ours$".padStart(9)}  ${"recov$".padStart(8)}  conf  eligible`,
  );
  console.log("─".repeat(120));
  for (const opp of findings.refund_opportunities.slice(0, 10)) {
    const desc = opp.line_description.length > 38 ? opp.line_description.slice(0, 35) + "…" : opp.line_description;
    console.log(
      `${opp.entry_number.padEnd(18)}  ${desc.padEnd(38)}  ${opp.hts_filed_8.padEnd(11)}  ${opp.hts_predicted_8.padEnd(11)}  ${fmtCents(opp.duty_paid_usd_cents).padStart(9)}  ${fmtCents(opp.duty_predicted_usd_cents).padStart(9)}  ${fmtCents(opp.recoverable_amount_usd_cents).padStart(8)}  ${opp.our_confidence.padEnd(4)}  ${opp.psc_eligible ? "yes" : "no "}`,
    );
  }
  if (findings.refund_opportunities.length === 0) console.log("  (none)");
  console.log("─".repeat(120));

  // ── Notes ─────────────────────────────────────────────────────────────
  if (findings.notes.length > 0) {
    console.log("\nNotes:");
    for (const n of findings.notes) console.log(`  • ${n}`);
  }

  // ── Uncertain cases (compact) ─────────────────────────────────────────
  if (findings.uncertain_cases.length > 0) {
    console.log(`\nUncertain (low confidence) — ${findings.uncertain_cases.length} cases:`);
    for (const u of findings.uncertain_cases.slice(0, 5)) {
      const desc = u.line_description.length > 60 ? u.line_description.slice(0, 57) + "…" : u.line_description;
      console.log(`  ${u.entry_number} line ${u.line_index}: ${desc}`);
      console.log(`    filed ${u.hts_filed} → predicted ${u.hts_predicted}`);
    }
  }

  console.log(`\nWall time: ${(wallMs / 1000).toFixed(1)} s    (avg ${Math.round(wallMs / findings.total_line_items_analyzed)} ms/line)`);

  // ── Persist full JSON ────────────────────────────────────────────────
  const outDir = path.join(dataDir, "refund-reports");
  await fs.mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}-${ts}.json`);
  await fs.writeFile(outPath, JSON.stringify(findings, null, 2));
  console.log(`\nfull report written to ${outPath}`);

  await ctx.db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
