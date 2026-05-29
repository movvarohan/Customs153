// Tariff policy shock simulator — portfolio-level "what-if" over a whole
// importer catalog. Deterministic (no LLM): for each SKU in the importer's
// SKU memory it computes annual duty exposure under a baseline (today's
// tariff table) and under a hypothetical policy scenario, and reports the
// dollar delta per SKU and across the portfolio.
//
// Scenarios modeled:
//   - section_301_rate: a flat hypothetical Section 301 rate on Chinese-
//     origin goods (overrides the per-chapter table rates).
//   - reroute_china_to: move China-sourced SKUs to another country, which
//     drops Section 301 entirely (subject to that country's own rules).

import type { AppContext } from "@/core/app-context";
import { loadTariffRates, resolveRates } from "@/core/lib/tariff-rates";
import { listSkuMemory } from "@/core/lib/sku-memory";

export interface SimScenario {
  /** Flat hypothetical Section 301 rate on Chinese goods (0–1). null = today's table rates. */
  section_301_rate: number | null;
  /** ISO-2 to reroute China-origin SKUs to (drops 301). null = stay China. */
  reroute_china_to: string | null;
}

export interface SimSkuRow {
  description: string;
  hts_code_8: string;
  chapter: string;
  origin: string;
  annual_value_usd_cents: number;
  baseline_duty_usd_cents: number;
  scenario_duty_usd_cents: number;
  delta_usd_cents: number;
}

export interface SimResult {
  importer_country: string; // baseline origin assumption
  scenario: SimScenario;
  baseline_total_usd_cents: number;
  scenario_total_usd_cents: number;
  delta_usd_cents: number;
  baseline_value_usd_cents: number;
  rows: SimSkuRow[];
}

/** Deterministic representative annual import value per SKU ($120k–$600k). */
function annualValueCents(description: string): number {
  let h = 0;
  for (let i = 0; i < description.length; i++) h = (h * 31 + description.charCodeAt(i)) | 0;
  const dollars = 120_000 + (Math.abs(h) % 481) * 1000; // 120k..600k in $1k steps
  return dollars * 100;
}

function dutyFor(
  table: import("@/core/schemas/duty").TariffRatesTableT,
  hts8: string,
  origin: string,
  valueCents: number,
  override301: number | null,
): number {
  const r = resolveRates(table, hts8, origin);
  const base = Math.round(valueCents * r.base_ad_valorem);
  const s232 = Math.round(valueCents * (r.section_232_rate ?? 0));
  // Section 301 applies only to Chinese origin. When a hypothetical flat rate
  // is supplied, it replaces the per-chapter table rate for CN goods.
  let s301 = 0;
  if (origin.toUpperCase() === "CN") {
    const rate = override301 !== null ? override301 : (r.section_301_rate ?? 0);
    s301 = Math.round(valueCents * rate);
  }
  return base + s232 + s301;
}

export async function runTariffSimulation(
  ctx: AppContext,
  customerId: string,
  scenario: SimScenario,
): Promise<SimResult> {
  const table = await loadTariffRates(ctx);
  const skus = await listSkuMemory(ctx, customerId, 100);
  const baselineOrigin = "CN"; // the demo catalog is China-sourced FBA goods

  const rows: SimSkuRow[] = skus.map((s) => {
    const hts8 = s.current_hts_code_8;
    const chapter = hts8.replace(/\D/g, "").slice(0, 2);
    const value = annualValueCents(s.canonical_description);
    const baseline = dutyFor(table, hts8, baselineOrigin, value, null);
    const scenarioOrigin = scenario.reroute_china_to ?? baselineOrigin;
    const scenario301 = scenario.reroute_china_to ? null : scenario.section_301_rate;
    const scen = dutyFor(table, hts8, scenarioOrigin, value, scenario301);
    return {
      description: s.canonical_description,
      hts_code_8: hts8,
      chapter,
      origin: scenarioOrigin,
      annual_value_usd_cents: value,
      baseline_duty_usd_cents: baseline,
      scenario_duty_usd_cents: scen,
      delta_usd_cents: scen - baseline,
    };
  });

  const baseline_total = rows.reduce((a, r) => a + r.baseline_duty_usd_cents, 0);
  const scenario_total = rows.reduce((a, r) => a + r.scenario_duty_usd_cents, 0);
  const baseline_value = rows.reduce((a, r) => a + r.annual_value_usd_cents, 0);

  // Sort by absolute impact, largest first.
  rows.sort((a, b) => Math.abs(b.delta_usd_cents) - Math.abs(a.delta_usd_cents));

  return {
    importer_country: baselineOrigin,
    scenario,
    baseline_total_usd_cents: baseline_total,
    scenario_total_usd_cents: scenario_total,
    delta_usd_cents: scenario_total - baseline_total,
    baseline_value_usd_cents: baseline_value,
    rows,
  };
}
