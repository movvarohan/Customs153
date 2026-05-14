// Zod schemas for the duty calculator. Deterministic math — no LLM
// involvement. Money values always in integer cents.

import { z } from "zod";

export const TariffRatesTable = z.object({
  version: z.string(),
  effective_date: z.string(),
  fees: z.object({
    mpf_rate: z.number(),
    mpf_min_usd_cents: z.number().int(),
    mpf_max_usd_cents: z.number().int(),
    hmf_rate: z.number(),
  }),
  section_301_china: z.object({
    by_chapter: z.record(z.string(), z.number()),
  }),
  section_232: z.object({
    by_chapter: z.record(z.string(), z.number()),
  }),
  ad_valorem: z.record(z.string(), z.number()),
  default_ad_valorem: z.number(),
});
export type TariffRatesTableT = z.infer<typeof TariffRatesTable>;

export const DutyComponent = z.object({
  kind: z.enum([
    "base_ad_valorem",
    "section_301",
    "section_232",
    "merchandise_processing_fee",
    "harbor_maintenance_fee",
  ]),
  /** Decimal rate (0.025 = 2.5%); null for fixed-fee components. */
  rate: z.number().nullable(),
  amount_usd_cents: z.number().int().nonnegative(),
  source_citation: z.string(),
});
export type DutyComponentT = z.infer<typeof DutyComponent>;

export const DutyCalculationInput = z.object({
  hts_code: z.string(),
  country_of_origin: z.string(),
  customs_value_usd_cents: z.number().int().nonnegative(),
  quantity: z.number().positive().optional(),
  unit_of_measure: z.string().optional(),
  /** "ocean" by default; "air" / "ground" / "other" skip the HMF (ocean-only fee). */
  transport_mode: z.enum(["ocean", "air", "ground", "other"]).default("ocean"),
});
export type DutyCalculationInputT = z.infer<typeof DutyCalculationInput>;

export const DutyCalculation = z.object({
  /** Inputs echoed for traceability. */
  hts_code: z.string(),
  country_of_origin: z.string(),
  customs_value_usd_cents: z.number().int().nonnegative(),

  base_duty_rate: z.number(),
  base_duty_usd_cents: z.number().int().nonnegative(),

  section_301_rate: z.number().nullable(),
  section_301_duty_usd_cents: z.number().int().nonnegative(),

  section_232_rate: z.number().nullable(),
  section_232_duty_usd_cents: z.number().int().nonnegative(),

  merchandise_processing_fee_usd_cents: z.number().int().nonnegative(),
  harbor_maintenance_fee_usd_cents: z.number().int().nonnegative(),

  total_duty_usd_cents: z.number().int().nonnegative(),
  tariff_rate_source: z.string(),

  components: z.array(DutyComponent),
  warnings: z.array(z.string()),
});
export type DutyCalculationT = z.infer<typeof DutyCalculation>;
