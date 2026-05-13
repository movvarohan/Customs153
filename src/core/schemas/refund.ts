// Schemas for the PSC / refund-finder agent.
//
// HistoricalEntry / HistoricalLineItem describe the input shape (the
// importer's broker records). PSCFindings is the output shape we surface
// in the broker UI and write to refund-reports/.
//
// _ground_truth_correct_hts is intentionally optional and ONLY read by the
// eval script when scoring synthetic test data — the agent itself never
// looks at it.

import { z } from "zod";

export const HistoricalLineItem = z.object({
  /** Verbatim seller description as the broker filed it. */
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_value_usd_cents: z.number().int().nonnegative(),
  total_value_usd_cents: z.number().int().nonnegative(),
  /** 10-digit code dotted XXXX.XX.XX.XX as the broker filed it. */
  hts_code_as_filed: z.string(),
  /** What the importer actually paid in duty on this line. */
  duty_paid_usd_cents: z.number().int().nonnegative(),
  /**
   * Eval-only field. Generators populate it; the PSC finder must not read it.
   * Optional in the schema so production entries (where we don't know the
   * truth) still validate.
   */
  _ground_truth_correct_hts: z.string().optional(),
});
export type HistoricalLineItemT = z.infer<typeof HistoricalLineItem>;

export const HistoricalEntry = z.object({
  entry_number: z.string().min(1),
  /** ISO 8601 date. */
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  port_of_entry: z.string().min(1),
  /** ISO 3166-1 alpha-2. */
  country_of_origin: z.string().regex(/^[A-Z]{2}$/),
  line_items: z.array(HistoricalLineItem).min(1),
});
export type HistoricalEntryT = z.infer<typeof HistoricalEntry>;

export const HistoricalEntries = z.object({
  importer: z.string().min(1),
  generated_at: z.string(),
  entries: z.array(HistoricalEntry),
});
export type HistoricalEntriesT = z.infer<typeof HistoricalEntries>;

export const RefundOpportunity = z.object({
  entry_number: z.string(),
  entry_date: z.string(),
  line_index: z.number().int().nonnegative(),
  line_description: z.string(),
  hts_filed: z.string(),
  hts_predicted: z.string(),
  hts_predicted_8: z.string(),
  hts_filed_8: z.string(),
  duty_paid_usd_cents: z.number().int().nonnegative(),
  duty_predicted_usd_cents: z.number().int().nonnegative(),
  recoverable_amount_usd_cents: z.number().int(),
  our_confidence: z.enum(["low", "medium", "high"]),
  reasoning_summary: z.string(),
  psc_eligible: z.boolean(),
});
export type RefundOpportunityT = z.infer<typeof RefundOpportunity>;

export const UncertainCase = z.object({
  entry_number: z.string(),
  entry_date: z.string(),
  line_index: z.number().int().nonnegative(),
  line_description: z.string(),
  hts_filed: z.string(),
  hts_predicted: z.string(),
  reason: z.string(),
});
export type UncertainCaseT = z.infer<typeof UncertainCase>;

export const PSCFindings = z.object({
  importer: z.string(),
  analyzed_at: z.string(),
  total_entries_analyzed: z.number().int().nonnegative(),
  total_line_items_analyzed: z.number().int().nonnegative(),
  agreements: z.number().int().nonnegative(),
  disagreements: z.number().int().nonnegative(),
  outside_psc_window: z.number().int().nonnegative(),
  refund_opportunities: z.array(RefundOpportunity),
  uncertain_cases: z.array(UncertainCase),
  total_recoverable_usd_cents: z.number().int(),
  confidence_breakdown: z.object({
    high_usd_cents: z.number().int(),
    medium_usd_cents: z.number().int(),
    low_usd_cents: z.number().int(),
  }),
  notes: z.array(z.string()),
});
export type PSCFindingsT = z.infer<typeof PSCFindings>;
