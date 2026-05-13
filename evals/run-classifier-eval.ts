// Classifier eval harness.
//
// Loads evals/hts-classification/gold.jsonl, runs the classifier on each
// description, computes accuracy metrics and writes a timestamped JSON
// report. Calls real Claude Sonnet on real Voyage retrievals — not a mock.

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildLocalContext } from "@/adapters/local";
import { classify, type ClassifyTrace } from "@/core/agents/classifier";
import { CLASSIFIER_PROMPT_VERSION } from "@/core/agents/prompts/classifier-system";
import type { ClassificationResultT } from "@/core/schemas/classification";

const GoldCase = z.object({
  description: z.string(),
  expected_hts_8: z.string(),
  expected_hts_10: z.string().nullable(),
  notes: z.string(),
  source: z.string(),
  ambiguous: z.boolean(),
  /** When true, any 8-digit code in acceptable_hts_8 counts as a match. */
  disputed: z.boolean().default(false),
  acceptable_hts_8: z.array(z.string()).default([]),
});
type GoldCaseT = z.infer<typeof GoldCase>;

interface CaseResult {
  case: GoldCaseT;
  prediction: ClassificationResultT | null;
  error: string | null;
  /** Stripped-digit normalized form for matching. */
  predicted_10_digits: string | null;
  predicted_8_digits: string | null;
  expected_10_digits: string | null;
  expected_8_digits: string;
  /** Top-3 8-digit predictions: predicted + alternative_codes_considered (8-digit). */
  top3_8_digits: string[];
  matches: {
    top1_10: boolean;
    top1_8: boolean;
    top3_8: boolean;
    chapter: boolean;
  };
  /** Did every citation appear in the retrieved candidate set? */
  citations_grounded: boolean;
}

function stripDigits(code: string): string {
  return code.replace(/\D/g, "");
}

function digitsToChapter(digits: string): string | null {
  return digits.length >= 2 ? digits.slice(0, 2) : null;
}

async function main(): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!anthropicKey || !voyageKey) {
    console.error("ANTHROPIC_API_KEY and VOYAGE_API_KEY are required.");
    process.exit(1);
  }

  const ctx = await buildLocalContext({
    dataDir: process.env.DATA_DIR ?? ".data",
    anthropicApiKey: anthropicKey,
    voyageApiKey: voyageKey,
    config: {
      environment: "development",
      defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
      cheapModel: process.env.CHEAP_MODEL ?? "claude-haiku-4-5-20251001",
      hardModel: process.env.HARD_MODEL ?? "claude-opus-4-7",
    },
  });

  const lines = (await fs.readFile("evals/hts-classification/gold.jsonl", "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const cases = lines.map((l) => GoldCase.parse(JSON.parse(l)));
  console.log(`loaded ${cases.length} gold cases (${cases.filter((c) => c.disputed).length} disputed)`);
  console.log(`model: ${ctx.config.defaultModel}`);
  console.log(`prompt version: ${CLASSIFIER_PROMPT_VERSION}\n`);

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${cases.length}] ${c.description.slice(0, 60).padEnd(60)} `);
    try {
      const { result, trace } = await classify(ctx, { description: c.description });
      const res = scoreCase(c, result, trace);
      results.push(res);
      const marker = res.matches.top1_8 ? "✓" : res.matches.chapter ? "·" : "✗";
      process.stdout.write(`${marker}  ${result.hts_code_8}  (gri ${result.gri_rule_applied}, ${result.confidence})\n`);
    } catch (err) {
      const msg = (err as Error).message;
      results.push({
        case: c,
        prediction: null,
        error: msg,
        predicted_10_digits: null,
        predicted_8_digits: null,
        expected_10_digits: c.expected_hts_10 ? stripDigits(c.expected_hts_10) : null,
        expected_8_digits: stripDigits(c.expected_hts_8),
        top3_8_digits: [],
        matches: { top1_10: false, top1_8: false, top3_8: false, chapter: false },
        citations_grounded: false,
      });
      process.stdout.write(`ERROR  ${msg.slice(0, 80)}\n`);
    }
  }

  await ctx.db.close();

  // ── Compute metrics ────────────────────────────────────────────────────
  const total = results.length;
  const scored = results.filter((r) => r.prediction !== null);
  const top1_10 = scored.filter((r) => r.matches.top1_10).length;
  const top1_8 = scored.filter((r) => r.matches.top1_8).length;
  const top3_8 = scored.filter((r) => r.matches.top3_8).length;
  const chapter = scored.filter((r) => r.matches.chapter).length;
  const grounded = scored.filter((r) => r.citations_grounded).length;

  const griDist: Record<string, number> = {};
  for (const r of scored) {
    const k = r.prediction!.gri_rule_applied;
    griDist[k] = (griDist[k] ?? 0) + 1;
  }

  const confByBucket: Record<"low" | "medium" | "high", { n: number; correct8: number }> = {
    low: { n: 0, correct8: 0 },
    medium: { n: 0, correct8: 0 },
    high: { n: 0, correct8: 0 },
  };
  for (const r of scored) {
    const c = r.prediction!.confidence;
    confByBucket[c].n++;
    if (r.matches.top1_8) confByBucket[c].correct8++;
  }

  const perChap: Record<string, { n: number; correct8: number }> = {};
  for (const r of scored) {
    const ch = digitsToChapter(r.expected_8_digits) ?? "??";
    perChap[ch] ??= { n: 0, correct8: 0 };
    perChap[ch].n++;
    if (r.matches.top1_8) perChap[ch].correct8++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`n=${total}, scored=${scored.length}, errored=${total - scored.length}`);
  console.log(`top-1 @ 10-digit    : ${top1_10}/${scored.length} (${pct(top1_10, scored.length)}%)`);
  console.log(`top-1 @ 8-digit     : ${top1_8}/${scored.length} (${pct(top1_8, scored.length)}%)`);
  console.log(`top-3 @ 8-digit     : ${top3_8}/${scored.length} (${pct(top3_8, scored.length)}%)`);
  console.log(`chapter-correct top-1: ${chapter}/${scored.length} (${pct(chapter, scored.length)}%)`);
  console.log(`citation grounding   : ${grounded}/${scored.length} (${pct(grounded, scored.length)}%)`);

  console.log("\nGRI rule distribution:");
  for (const [k, v] of Object.entries(griDist).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k.padEnd(6)}  ${v}`);
  }

  console.log("\nConfidence calibration (top-1 @ 8-digit accuracy by confidence bucket):");
  for (const k of ["high", "medium", "low"] as const) {
    const { n, correct8 } = confByBucket[k];
    console.log(`  ${k.padEnd(6)}  n=${n}, accuracy=${n > 0 ? pct(correct8, n) : "—"}%`);
  }

  console.log("\nPer-chapter accuracy (top-1 @ 8-digit):");
  for (const [ch, v] of Object.entries(perChap).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ch ${ch}  ${v.correct8}/${v.n}`);
  }

  // ── Failures dump ──────────────────────────────────────────────────────
  const failures = scored.filter((r) => !r.matches.top1_8);
  console.log(`\n${failures.length} failures @ 8-digit:`);
  for (const r of failures) {
    console.log("\n---");
    console.log(`  description : ${r.case.description}`);
    console.log(`  expected    : ${r.case.expected_hts_8}${r.case.ambiguous ? "  (ambiguous case)" : ""}`);
    console.log(`  predicted   : ${r.prediction!.hts_code_8} (10: ${r.prediction!.hts_code})`);
    console.log(`  GRI applied : ${r.prediction!.gri_rule_applied}`);
    console.log(`  confidence  : ${r.prediction!.confidence}`);
    console.log(`  reasoning   : ${r.prediction!.reasoning}`);
    if (r.prediction!.alternative_codes_considered.length > 0) {
      console.log("  alts:");
      for (const a of r.prediction!.alternative_codes_considered) {
        console.log(`    - ${a.hts_code}: ${a.rejected_because}`);
      }
    }
    if (r.prediction!.missing_inputs_for_precision.length > 0) {
      console.log("  missing inputs:");
      for (const m of r.prediction!.missing_inputs_for_precision) {
        console.log(`    - ${m}`);
      }
    }
    if (r.case.disputed) {
      console.log(`  disputed    : acceptable=[${r.case.acceptable_hts_8.join(", ")}]`);
    }
    if (r.prediction!.validation_warning) {
      console.log(`  warning     : ${r.prediction!.validation_warning}`);
    }
  }

  const errs = results.filter((r) => r.error !== null);
  if (errs.length > 0) {
    console.log(`\n${errs.length} errors:`);
    for (const r of errs) console.log(`  - ${r.case.description}\n      ${r.error}`);
  }

  // ── Persist report ─────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.resolve("evals/reports", `classifier-${timestamp}.json`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const report = {
    timestamp,
    model: ctx.config.defaultModel,
    prompt_version: CLASSIFIER_PROMPT_VERSION,
    n_cases: total,
    n_scored: scored.length,
    metrics: {
      top1_10: scored.length === 0 ? 0 : top1_10 / scored.length,
      top1_8: scored.length === 0 ? 0 : top1_8 / scored.length,
      top3_8: scored.length === 0 ? 0 : top3_8 / scored.length,
      chapter_top1: scored.length === 0 ? 0 : chapter / scored.length,
      citation_grounding: scored.length === 0 ? 0 : grounded / scored.length,
    },
    gri_distribution: griDist,
    confidence_calibration: confByBucket,
    per_chapter: perChap,
    results,
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nfull report written to ${reportPath}`);
}

function pct(n: number, d: number): string {
  return d === 0 ? "0.0" : ((n / d) * 100).toFixed(1);
}

function scoreCase(
  c: GoldCaseT,
  pred: ClassificationResultT,
  trace: ClassifyTrace,
): CaseResult {
  const pred10 = stripDigits(pred.hts_code);
  const pred8 = stripDigits(pred.hts_code_8);
  const exp10 = c.expected_hts_10 ? stripDigits(c.expected_hts_10) : null;
  const exp8 = stripDigits(c.expected_hts_8);

  // For disputed cases, any code in acceptable_hts_8 matches at 8-digit;
  // 10-digit matching falls back to the primary expected_hts_10 only.
  const acceptable8 = c.disputed
    ? new Set([exp8, ...c.acceptable_hts_8.map((a) => stripDigits(a))])
    : new Set([exp8]);

  const top3 = [pred8, ...pred.alternative_codes_considered.map((a) => stripDigits(a.hts_code).slice(0, 8))];

  const candidateCodes = new Set(trace.candidates.map((c) => c.htsCode));
  const citationsGrounded = pred.citations.every((c) => candidateCodes.has(c));

  return {
    case: c,
    prediction: pred,
    error: null,
    predicted_10_digits: pred10,
    predicted_8_digits: pred8,
    expected_10_digits: exp10,
    expected_8_digits: exp8,
    top3_8_digits: top3,
    matches: {
      top1_10: exp10 !== null && pred10 === exp10,
      top1_8: acceptable8.has(pred8),
      top3_8: top3.some((p) => acceptable8.has(p)),
      chapter: pred8.slice(0, 2) === exp8.slice(0, 2),
    },
    citations_grounded: citationsGrounded,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
