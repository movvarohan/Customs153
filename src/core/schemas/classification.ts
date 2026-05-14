// Zod schema for the classifier agent's output. The tool-use input_schema
// (in src/core/agents/classifier.ts) mirrors this 1:1 so Anthropic's tool
// use forces the same shape we validate here.
//
// Field naming is snake_case because that's what the JSON tool-use payload
// uses end-to-end. The Anthropic SDK serializes our tool input as-is.

import { z } from "zod";

export const GriRule = z.enum([
  "1",
  "2(a)",
  "2(b)",
  "3(a)",
  "3(b)",
  "3(c)",
  "4",
  "5(a)",
  "5(b)",
  "6",
]);
export type GriRuleT = z.infer<typeof GriRule>;

export const ConfidenceLevel = z.enum(["low", "medium", "high"]);
export type ConfidenceLevelT = z.infer<typeof ConfidenceLevel>;

export const AlternativeConsidered = z.object({
  hts_code: z.string().min(4),
  rejected_because: z.string().min(1),
});

export const ClassificationOutput = z.object({
  /** 10-digit code in dotted XXXX.XX.XX.XX form. */
  hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/, "must be 10-digit XXXX.XX.XX.XX"),
  /** 8-digit code in dotted XXXX.XX.XX form — used for eval matching. */
  hts_code_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/, "must be 8-digit XXXX.XX.XX"),
  /** Which GRI rule was decisive ("1", "3(a)", "3(b)", …). */
  gri_rule_applied: GriRule,
  /** 3–5 sentence explanation of the legal reasoning. */
  reasoning: z.string().min(50),
  /** HTS codes from the retrieved candidate set that informed the decision. */
  citations: z.array(z.string().min(4)).min(1),
  /** Up to 3 alternatives the model weighed, with the reason each was rejected. */
  alternative_codes_considered: z.array(AlternativeConsidered).max(3),
  /**
   * Data the description lacked that would tighten the 8-/10-digit pick.
   * Examples: "unit value in USD (4202.21 splits at $20)",
   * "exact material composition by weight", "intended end-use (athletic vs household)".
   * Empty array if nothing was missing.
   */
  missing_inputs_for_precision: z.array(z.string()),
  /**
   * The level the classifier is fully committed to. Introduced in prompt
   * v3.2 to let the model honestly decline a guess when the deciding
   * attribute between candidate 8-digit lines is genuinely absent from
   * the input.
   *
   *   "10" — committed at 10-digit (statistical suffix included). Default.
   *   "8"  — committed at 8-digit; 10-digit suffix is best-effort.
   *   "6"  — committed at 6-digit. Returned when the 8-digit pick depends
   *          on a value tier, fiber-content %, material split, dimensional
   *          threshold, etc. that the description does not specify. In
   *          this case hts_code MUST end ".00.00" (e.g. 4202.21.00.00)
   *          and missing_inputs_for_precision MUST list the specific
   *          deciding attribute.
   */
  precision_level: z.enum(["6", "8", "10"]).default("10"),
  confidence: ConfidenceLevel,
});

export type ClassificationOutputT = z.infer<typeof ClassificationOutput>;

/**
 * Result the classifier agent returns to its caller. Includes the model
 * output plus any post-validation warning attached after both tool-use
 * attempts. `validation_warning` is non-null only when something couldn't
 * be enforced (e.g. citation didn't match the retrieved candidates).
 */
export const ClassificationResult = ClassificationOutput.extend({
  validation_warning: z.string().nullable(),
});

export type ClassificationResultT = z.infer<typeof ClassificationResult>;
