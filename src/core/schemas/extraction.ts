// Zod schemas for the extractor agent's output (per CLAUDE.md §1).
// snake_case fields throughout — the JSON tool-use payload uses these names
// end-to-end. All monetary values stored as integer cents (project rule).

import { z } from "zod";

export const DocumentKind = z.enum([
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "mill_test_certificate",
  "isf_data",
  "unknown",
]);
export type DocumentKindT = z.infer<typeof DocumentKind>;

export const ExtractedLineItem = z.object({
  /** Verbatim seller description — preserved as written, not normalized. */
  description: z.string().min(1),
  quantity: z.number().positive(),
  /** Integer cents in the invoice currency. */
  unit_value: z.number().int().nonnegative(),
  /** Integer cents in the invoice currency. */
  total_value: z.number().int().nonnegative(),
  country_of_origin: z.string().nullable(),
  /** Some sellers pre-classify; capture if present so we can compare. */
  hts_code_from_invoice: z.string().nullable(),
  material_composition: z.string().nullable(),
  model_number: z.string().nullable(),
});
export type ExtractedLineItemT = z.infer<typeof ExtractedLineItem>;

export const ExtractedShipment = z.object({
  document_kind: DocumentKind,
  vendor: z.string().min(1),
  invoice_number: z.string().min(1),
  /** ISO 8601 date (YYYY-MM-DD). */
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consignee: z.string().nullable(),
  country_of_origin: z.string().nullable(),
  /**
   * Mode of transport from the invoice / bill of lading. Drives Harbor
   * Maintenance Fee — HMF is ocean-only. Optional. When absent the duty
   * calculator assumes "ocean" and surfaces the assumption in warnings.
   */
  mode_of_transport: z.enum(["ocean", "air", "ground", "other"]).nullable().optional(),
  /** ISO 4217 currency code as printed on the invoice. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Sum of line items in invoice currency (integer cents). */
  total_value: z.number().int().nonnegative(),
  line_items: z.array(ExtractedLineItem),
  /**
   * Line items whose seller description is too vague to classify — broker
   * UX surfaces these so the importer can be asked for specifics.
   */
  requires_clarification: z.array(
    z.object({
      line_index: z.number().int().nonnegative(),
      reason: z.string().min(1),
    }),
  ),
});
export type ExtractedShipmentT = z.infer<typeof ExtractedShipment>;

/**
 * Result returned to the caller. Wraps the model output and surfaces
 * post-validation checks the agent ran (currency conversion to USD,
 * reconciliation of line-item totals against the invoice total).
 */
export const ExtractionResult = ExtractedShipment.extend({
  /** Sum of line items vs. document total_value, in invoice cents. */
  reconciliation_warning: z.string().nullable(),
  /**
   * USD totals derived from currency × ctx.cache FX rate. null when the
   * invoice currency is USD or no rate is available.
   */
  total_value_usd_cents: z.number().int().nonnegative().nullable(),
  fx_rate_used: z.number().positive().nullable(),
});
export type ExtractionResultT = z.infer<typeof ExtractionResult>;
