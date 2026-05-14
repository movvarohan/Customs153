// Deterministic duty calculator. No LLM in this path.
//
// Resolves rate components from the versioned tariff table, applies Section
// 301 (China) and Section 232 (steel/aluminum chapters), MPF, and HMF, and
// returns a fully itemized DutyCalculation suitable for audit.
//
// Money in integer cents throughout. Rounding: per-component cents are
// rounded with banker's-rule equivalent (Math.round on the cent value).
//
// MPF / HMF semantics
// -------------------
// MPF is assessed ONCE per CBP entry on the aggregate entered value, then
// the min/max cap is applied to that single figure (19 USC 58c(b)(8); CBP
// Form 7501 Box 39 ABI code 499). HMF is also entry-level. Calling this
// function per line and summing emits inflated MPF (because each line gets
// the min-cap bumped up to $33.58) and per-line HMF that's just per-line
// proportional.
//
// Convention:
//   - input.include_entry_fees defaults to TRUE (single-line / single-entry
//     callers, e.g. demos and one-shot calls). The function emits MPF + HMF
//     against this one line's value.
//   - Pass include_entry_fees: false when calculating per-line duty as part
//     of a larger entry. The MPF + HMF components are still emitted for
//     traceability but with amount=0 and a citation explaining where they
//     belong. Use calculateEntryFees() to compute them once on the entry total.

import type { AppContext } from "@/core/app-context";
import {
  type DutyCalculationT,
  type DutyComponentT,
  type DutyCalculationInputT,
  type TariffRatesTableT,
} from "@/core/schemas/duty";
import { loadTariffRates, resolveRates } from "@/core/lib/tariff-rates";

export interface EntryFees {
  /** Customs value used to compute fees, in USD cents. */
  customs_value_usd_cents: number;
  mpf_usd_cents: number;
  hmf_usd_cents: number;
  total_usd_cents: number;
  components: DutyComponentT[];
  /** Surfaced when transport mode was assumed (ocean) rather than supplied. */
  warnings: string[];
}

/** Compute the entry-level CBP user fees: MPF (capped) + HMF (ocean only). */
export function calculateEntryFees(
  table: TariffRatesTableT,
  customs_value_usd_cents: number,
  transport_mode: "ocean" | "air" | "ground" | "other" | null | undefined,
  options?: { transport_mode_assumed?: boolean },
): EntryFees {
  const value = customs_value_usd_cents;
  const warnings: string[] = [];
  const mode = transport_mode ?? "ocean";

  // MPF: 0.3464% of entry value, clamped to [mpf_min, mpf_max].
  const rawMpf = Math.round(value * table.fees.mpf_rate);
  const mpf = Math.min(
    table.fees.mpf_max_usd_cents,
    Math.max(table.fees.mpf_min_usd_cents, rawMpf),
  );
  const mpfCitation = `MPF FY2026 (effective 2025-10-01): ${(table.fees.mpf_rate * 100).toFixed(4)}% of total entered value, min $${(table.fees.mpf_min_usd_cents / 100).toFixed(2)}, max $${(table.fees.mpf_max_usd_cents / 100).toFixed(2)} per entry. Source: CBP Dec. 25-10 (90 FR 33793).`;

  // HMF: 0.125% of entry value, ocean transport only.
  const hmf = mode === "ocean" ? Math.round(value * table.fees.hmf_rate) : 0;
  let hmfCitation: string;
  if (mode === "ocean") {
    hmfCitation = `HMF: ${(table.fees.hmf_rate * 100).toFixed(3)}% of total entered value (ocean cargo only). 26 USC 4461.`;
    if (options?.transport_mode_assumed) {
      hmfCitation += " Mode of transport not supplied; assumed ocean.";
      warnings.push("Mode of transport not supplied; assumed ocean freight for HMF.");
    }
  } else {
    hmfCitation = `HMF not applied (transport_mode=${mode}; HMF is ocean-only).`;
  }

  const components: DutyComponentT[] = [
    {
      kind: "merchandise_processing_fee",
      rate: table.fees.mpf_rate,
      amount_usd_cents: mpf,
      source_citation: mpfCitation,
    },
    {
      kind: "harbor_maintenance_fee",
      rate: mode === "ocean" ? table.fees.hmf_rate : null,
      amount_usd_cents: hmf,
      source_citation: hmfCitation,
    },
  ];

  return {
    customs_value_usd_cents: value,
    mpf_usd_cents: mpf,
    hmf_usd_cents: hmf,
    total_usd_cents: mpf + hmf,
    components,
    warnings,
  };
}

export async function calculateDuty(
  ctx: AppContext,
  input: DutyCalculationInputT & {
    /** When false, emit MPF/HMF components as zero with a citation telling the
     * caller to compute entry-level fees once via calculateEntryFees(). */
    include_entry_fees?: boolean;
  },
): Promise<DutyCalculationT> {
  const includeFees = input.include_entry_fees ?? true;
  const table = await loadTariffRates(ctx);
  const resolved = resolveRates(table, input.hts_code, input.country_of_origin);
  const warnings = [...resolved.warnings];

  const value = input.customs_value_usd_cents;
  const components: DutyComponentT[] = [];

  // Base ad valorem
  const baseRate = resolved.base_ad_valorem;
  const baseCents = Math.round(value * baseRate);
  components.push({
    kind: "base_ad_valorem",
    rate: baseRate,
    amount_usd_cents: baseCents,
    source_citation: resolved.base_source,
  });

  // Section 301 (China)
  let s301Rate: number | null = null;
  let s301Cents = 0;
  if (resolved.section_301_rate !== null) {
    s301Rate = resolved.section_301_rate;
    s301Cents = Math.round(value * s301Rate);
    components.push({
      kind: "section_301",
      rate: s301Rate,
      amount_usd_cents: s301Cents,
      source_citation: resolved.section_301_source ?? "Section 301 China",
    });
  }

  // Section 232 (steel/aluminum chapters)
  let s232Rate: number | null = null;
  let s232Cents = 0;
  if (resolved.section_232_rate !== null) {
    s232Rate = resolved.section_232_rate;
    s232Cents = Math.round(value * s232Rate);
    components.push({
      kind: "section_232",
      rate: s232Rate,
      amount_usd_cents: s232Cents,
      source_citation: resolved.section_232_source ?? "Section 232",
    });
  }

  let mpfCents = 0;
  let hmfCents = 0;
  if (includeFees) {
    const fees = calculateEntryFees(table, value, input.transport_mode);
    mpfCents = fees.mpf_usd_cents;
    hmfCents = fees.hmf_usd_cents;
    components.push(...fees.components);
    warnings.push(...fees.warnings);
  } else {
    components.push(
      {
        kind: "merchandise_processing_fee",
        rate: table.fees.mpf_rate,
        amount_usd_cents: 0,
        source_citation:
          "MPF is entry-level, computed once on the aggregate entered value (not per line).",
      },
      {
        kind: "harbor_maintenance_fee",
        rate: null,
        amount_usd_cents: 0,
        source_citation:
          "HMF is entry-level (ocean only), computed once on the aggregate entered value (not per line).",
      },
    );
  }

  const total = baseCents + s301Cents + s232Cents + mpfCents + hmfCents;

  const sourceFragments = [resolved.base_source];
  if (resolved.section_301_source) sourceFragments.push(resolved.section_301_source);
  if (resolved.section_232_source) sourceFragments.push(resolved.section_232_source);

  return {
    hts_code: input.hts_code,
    country_of_origin: input.country_of_origin,
    customs_value_usd_cents: value,
    base_duty_rate: baseRate,
    base_duty_usd_cents: baseCents,
    section_301_rate: s301Rate,
    section_301_duty_usd_cents: s301Cents,
    section_232_rate: s232Rate,
    section_232_duty_usd_cents: s232Cents,
    merchandise_processing_fee_usd_cents: mpfCents,
    harbor_maintenance_fee_usd_cents: hmfCents,
    total_duty_usd_cents: total,
    tariff_rate_source: sourceFragments.join("; "),
    components,
    warnings,
  };
}
