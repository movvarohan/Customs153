// Deterministic duty calculator. No LLM in this path.
//
// Resolves rate components from the versioned tariff table, applies Section
// 301 (China) and Section 232 (steel/aluminum chapters), MPF, and HMF, and
// returns a fully itemized DutyCalculation suitable for audit.
//
// Money in integer cents throughout. Rounding: per-component cents are
// rounded with banker's-rule equivalent (Math.round on the cent value).

import type { AppContext } from "@/core/app-context";
import {
  type DutyCalculationT,
  type DutyComponentT,
  type DutyCalculationInputT,
} from "@/core/schemas/duty";
import { loadTariffRates, resolveRates } from "@/core/lib/tariff-rates";

export async function calculateDuty(
  ctx: AppContext,
  input: DutyCalculationInputT,
): Promise<DutyCalculationT> {
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

  // MPF: 0.3464% of customs value, clamped to [mpf_min, mpf_max].
  const rawMpf = Math.round(value * table.fees.mpf_rate);
  const mpf = Math.min(table.fees.mpf_max_usd_cents, Math.max(table.fees.mpf_min_usd_cents, rawMpf));
  components.push({
    kind: "merchandise_processing_fee",
    rate: table.fees.mpf_rate,
    amount_usd_cents: mpf,
    source_citation: `MPF 2026: ${(table.fees.mpf_rate * 100).toFixed(4)}% (min $${(table.fees.mpf_min_usd_cents / 100).toFixed(2)}, max $${(table.fees.mpf_max_usd_cents / 100).toFixed(2)})`,
  });

  // HMF: 0.125% of customs value, ocean transport only.
  const transportMode = input.transport_mode ?? "ocean";
  const hmf = transportMode === "ocean" ? Math.round(value * table.fees.hmf_rate) : 0;
  components.push({
    kind: "harbor_maintenance_fee",
    rate: transportMode === "ocean" ? table.fees.hmf_rate : null,
    amount_usd_cents: hmf,
    source_citation:
      transportMode === "ocean"
        ? `HMF: ${(table.fees.hmf_rate * 100).toFixed(3)}% of customs value (ocean only)`
        : `HMF not applied (transport_mode=${transportMode})`,
  });

  const total = baseCents + s301Cents + s232Cents + mpf + hmf;

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
    merchandise_processing_fee_usd_cents: mpf,
    harbor_maintenance_fee_usd_cents: hmf,
    total_duty_usd_cents: total,
    tariff_rate_source: sourceFragments.join("; "),
    components,
    warnings,
  };
}
