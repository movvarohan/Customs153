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

// New gold schema (post-rebuild): every case carries a verification_status
// and an explicit `source`. Cases marked `unverifiable` are kept in the file
// but excluded from accuracy metrics (they live alongside `needs_human_review.jsonl`).
const GoldCase = z.object({
  id: z.string().optional(),
  description: z.string(),
  expected_hts_8: z.string(),
  expected_hts_10: z.string().nullable(),
  notes: z.string(),
  source: z.string(),
  gri_rule: z.string().optional(),
  verification_status: z.enum(["verified", "corrected", "disputed", "unverifiable"]).default("verified"),
  /** Multiple acceptable codes — populated for disputed cases. */
  accept_set: z.array(z.string()).default([]),
  prior_expected_hts_8: z.string().optional(),
  // Backwards-compat with the old schema (still readable):
  ambiguous: z.boolean().optional(),
  disputed: z.boolean().optional(),
  acceptable_hts_8: z.array(z.string()).optional(),
});
type GoldCaseT = z.infer<typeof GoldCase>;

interface CaseResult {
  case: GoldCaseT;
  prediction: ClassificationResultT | null;
  error: string | null;
  /** Stripped-digit normalized form for matching. */
  predicted_10_digits: string | null;
  predicted_8_digits: string | null;
  /** First 6 digits of the prediction. */
  predicted_6_digits: string | null;
  expected_10_digits: string | null;
  expected_8_digits: string;
  /** First 6 digits of the expected 8-digit code. */
  expected_6_digits: string;
  /** Top-3 8-digit predictions: predicted + alternative_codes_considered (8-digit). */
  top3_8_digits: string[];
  /**
   * Precision level the classifier claimed: "10" / "8" / "6" (v3.2+).
   * Older v3.1 predictions don't carry this field; treat as "10" by default.
   */
  predicted_precision_level: "10" | "8" | "6";
  /** True when precision_level=="6" and the 6-digit prefix matches expected. */
  honest_six_digit_fallback: boolean;
  matches: {
    /** Correct at 10-digit. */
    top1_10: boolean;
    /** Correct at 8-digit (existing metric, unchanged). */
    top1_8: boolean;
    /** Any of top1 + alternatives matched at 8-digit. */
    top3_8: boolean;
    /**
     * Correct at 6-digit. A prediction counts as 6-digit-correct when:
     *   (a) the 8-digit also matched (8-correct implies 6-correct), OR
     *   (b) precision_level == "6" AND the 6-digit prefix matches expected
     *       AND missing_inputs_for_precision is non-empty
     *       (the honest fallback case).
     */
    top1_6: boolean;
    /** First two digits match. */
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
  const allCases = lines.map((l) => GoldCase.parse(JSON.parse(l)));
  const skipped = allCases.filter((c) => c.verification_status === "unverifiable");
  const cases = allCases.filter((c) => c.verification_status !== "unverifiable");
  const disputedCount = cases.filter((c) => c.verification_status === "disputed" || c.disputed).length;
  console.log(`loaded ${allCases.length} cases; scoring ${cases.length} (skipped ${skipped.length} unverifiable, ${disputedCount} disputed)`);
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
        predicted_6_digits: null,
        expected_6_digits: stripDigits(c.expected_hts_8).slice(0, 6),
        top3_8_digits: [],
        predicted_precision_level: "10",
        honest_six_digit_fallback: false,
        matches: {
          top1_10: false,
          top1_8: false,
          top3_8: false,
          top1_6: false,
          chapter: false,
        },
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
  const top1_6 = scored.filter((r) => r.matches.top1_6).length;
  const chapter = scored.filter((r) => r.matches.chapter).length;
  const grounded = scored.filter((r) => r.citations_grounded).length;
  const honestFallbacks = scored.filter((r) => r.honest_six_digit_fallback).length;

  const griDist: Record<string, number> = {};
  for (const r of scored) {
    const k = r.prediction!.gri_rule_applied;
    griDist[k] = (griDist[k] ?? 0) + 1;
  }

  const precisionDist: Record<"10" | "8" | "6", number> = { "10": 0, "8": 0, "6": 0 };
  for (const r of scored) precisionDist[r.predicted_precision_level]++;

  // Confidence calibration tracks BOTH 8-digit and the new 6-digit metric, so
  // we can see whether v3.2's high-confidence 6-digit fallbacks actually
  // resolve to the correct 6-digit (calibration check).
  const confByBucket: Record<
    "low" | "medium" | "high",
    { n: number; correct8: number; correct6: number; correctTop3_8: number }
  > = {
    low: { n: 0, correct8: 0, correct6: 0, correctTop3_8: 0 },
    medium: { n: 0, correct8: 0, correct6: 0, correctTop3_8: 0 },
    high: { n: 0, correct8: 0, correct6: 0, correctTop3_8: 0 },
  };
  for (const r of scored) {
    const c = r.prediction!.confidence;
    confByBucket[c].n++;
    if (r.matches.top1_8) confByBucket[c].correct8++;
    if (r.matches.top1_6) confByBucket[c].correct6++;
    if (r.matches.top3_8) confByBucket[c].correctTop3_8++;
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
  console.log(`top-1 @ 6-digit     : ${top1_6}/${scored.length} (${pct(top1_6, scored.length)}%)`);
  console.log(`  of which honest 6-digit fallbacks: ${honestFallbacks}`);
  console.log(`chapter-correct top-1: ${chapter}/${scored.length} (${pct(chapter, scored.length)}%)`);
  console.log(`citation grounding   : ${grounded}/${scored.length} (${pct(grounded, scored.length)}%)`);

  console.log("\nPrecision-level distribution:");
  for (const k of ["10", "8", "6"] as const) {
    console.log(`  ${k.padEnd(3)}  ${precisionDist[k]}`);
  }

  console.log("\nGRI rule distribution:");
  for (const [k, v] of Object.entries(griDist).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k.padEnd(6)}  ${v}`);
  }

  console.log("\nConfidence calibration by bucket (n, top1@8, top3@8, top1@6):");
  for (const k of ["high", "medium", "low"] as const) {
    const { n, correct8, correct6, correctTop3_8 } = confByBucket[k];
    console.log(
      `  ${k.padEnd(6)}  n=${n}` +
        `, top1@8=${n > 0 ? pct(correct8, n) : "—"}%` +
        `, top3@8=${n > 0 ? pct(correctTop3_8, n) : "—"}%` +
        `, top1@6=${n > 0 ? pct(correct6, n) : "—"}%`,
    );
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
    if (r.case.verification_status === "disputed" || r.case.disputed) {
      const accept = r.case.accept_set.length > 0 ? r.case.accept_set : (r.case.acceptable_hts_8 ?? []);
      console.log(`  disputed    : accept_set=[${accept.join(", ")}]`);
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
      top1_6: scored.length === 0 ? 0 : top1_6 / scored.length,
      honest_six_digit_fallbacks: honestFallbacks,
      chapter_top1: scored.length === 0 ? 0 : chapter / scored.length,
      citation_grounding: scored.length === 0 ? 0 : grounded / scored.length,
    },
    gri_distribution: griDist,
    precision_level_distribution: precisionDist,
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
  const pred6 = pred8.slice(0, 6);
  const exp10 = c.expected_hts_10 ? stripDigits(c.expected_hts_10) : null;
  const exp8 = stripDigits(c.expected_hts_8);
  const exp6 = exp8.slice(0, 6);

  // For disputed cases, any code in accept_set (new schema) or
  // acceptable_hts_8 (legacy) matches at 8-digit; 10-digit matching
  // falls back to the primary expected_hts_10 only.
  const acceptList = c.accept_set.length > 0 ? c.accept_set : (c.acceptable_hts_8 ?? []);
  const isDisputed = c.verification_status === "disputed" || c.disputed === true;
  const acceptable8 = isDisputed
    ? new Set([exp8, ...acceptList.map((a) => stripDigits(a))])
    : new Set([exp8]);
  const acceptable6 = new Set<string>([exp6, ...Array.from(acceptable8).map((s) => s.slice(0, 6))]);

  const top3 = [pred8, ...pred.alternative_codes_considered.map((a) => stripDigits(a.hts_code).slice(0, 8))];

  const candidateCodes = new Set(trace.candidates.map((c) => c.htsCode));
  const citationsGrounded = pred.citations.every((c) => candidateCodes.has(c));

  // v3.2 introduced precision_level. Older predictions don't have it; default
  // to "10" (existing 8-digit-matching behaviour).
  const precisionLevel: "10" | "8" | "6" =
    (pred as unknown as { precision_level?: "10" | "8" | "6" }).precision_level ?? "10";

  // Honest 6-digit fallback: precision_level "6", code ends ".00.00", missing
  // inputs declared, AND the 6-digit prefix matches expected. This is the
  // exact case the v3.2 prompt change is designed to credit.
  const honestSixDigitFallback =
    precisionLevel === "6" &&
    pred8.endsWith("00") &&
    pred10.endsWith("000000".slice(0, 4)) &&
    pred.missing_inputs_for_precision.length > 0 &&
    acceptable6.has(pred6);

  const top1_8 = acceptable8.has(pred8);
  // 6-digit credit: 8-correct implies 6-correct, OR the honest fallback.
  const top1_6 = top1_8 || honestSixDigitFallback;

  return {
    case: c,
    prediction: pred,
    error: null,
    predicted_10_digits: pred10,
    predicted_8_digits: pred8,
    predicted_6_digits: pred6,
    expected_10_digits: exp10,
    expected_8_digits: exp8,
    expected_6_digits: exp6,
    top3_8_digits: top3,
    predicted_precision_level: precisionLevel,
    honest_six_digit_fallback: honestSixDigitFallback,
    matches: {
      top1_10: exp10 !== null && pred10 === exp10,
      top1_8,
      top3_8: top3.some((p) => acceptable8.has(p)),
      top1_6,
      chapter: pred8.slice(0, 2) === exp8.slice(0, 2),
    },
    citations_grounded: citationsGrounded,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
