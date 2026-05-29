// Tariff policy shock simulator — portfolio-level "what-if" over a whole
// importer catalog. Deterministic (no LLM): for each SKU in the importer's
// SKU memory it computes the duty stack under a baseline (today's tariff
// table) and under a hypothetical policy scenario, decomposed by component,
// and reports the dollar delta per SKU and across the portfolio.
//
// Levers modeled (all hypothetical — the lab is a what-if, not an assertion
// of current rates beyond the baseline table):
//   - section_301_rate:   flat hypothetical Section 301 rate on Chinese goods
//                         (overrides the per-chapter table rate). null = today.
//   - reciprocal_rate:    a universal reciprocal tariff applied to ALL origins
//                         (the 2025 reciprocal framework). 0 = today.
//   - section_232_enabled: keep or remove the Section 232 steel/aluminum
//                         add-on (model a carve-out). default true.
//   - reroute_china_to:   move China-sourced SKUs to another country, which
//                         drops Section 301 entirely (subject to that
//                         country's own rules). Rerouting carries a unit-cost
//                         premium and a one-time switching cost so the lab can
//                         compute the CFO break-even.
//   - unit_cost_premium_pct / switching_cost_usd_cents: reroute economics.
//   - include_entry_fees:  fold annualized MPF + HMF into the totals.
//
// Money in integer cents throughout.

import type { AppContext } from "@/core/app-context";
import { loadTariffRates, resolveRates } from "@/core/lib/tariff-rates";
import type { TariffRatesTableT } from "@/core/schemas/duty";
import { listSkuMemory } from "@/core/lib/sku-memory";

export interface SimScenario {
  /** Flat hypothetical Section 301 rate on Chinese goods (0–1). null = today's table rates. */
  section_301_rate: number | null;
  /** Universal reciprocal tariff add-on applied to every origin (0–1). 0 = today. */
  reciprocal_rate: number;
  /** Keep the Section 232 steel/aluminum add-on. false models a carve-out/removal. */
  section_232_enabled: boolean;
  /** ISO-2 to reroute China-origin SKUs to (drops 301). null = stay China. */
  reroute_china_to: string | null;
  /** Ex-works unit-cost premium when rerouting (0–1, e.g. 0.08 = goods 8% pricier). */
  unit_cost_premium_pct: number;
  /** One-time switching cost (tooling, qualification, dual-running) in cents. */
  switching_cost_usd_cents: number;
  /** Fold annualized CBP user fees (MPF + HMF) into the totals. */
  include_entry_fees: boolean;
}

/** Duty decomposed by stacked component (duties only — entry fees added at portfolio level). */
export interface DutyStack {
  base_usd_cents: number;
  section_301_usd_cents: number;
  section_232_usd_cents: number;
  reciprocal_usd_cents: number;
  total_usd_cents: number;
}

export interface SimSkuRow {
  description: string;
  hts_code_8: string;
  chapter: string;
  origin: string;
  annual_value_usd_cents: number;
  baseline: DutyStack;
  scenario: DutyStack;
  baseline_duty_usd_cents: number;
  scenario_duty_usd_cents: number;
  delta_usd_cents: number;
}

/** Portfolio totals per component, including entry fees. */
export interface PortfolioStack {
  base_usd_cents: number;
  section_301_usd_cents: number;
  section_232_usd_cents: number;
  reciprocal_usd_cents: number;
  mpf_usd_cents: number;
  hmf_usd_cents: number;
  total_usd_cents: number;
}

export interface RerouteEconomics {
  active: boolean;
  to: string | null;
  unit_cost_premium_pct: number;
  /** Extra annual cost of goods from the unit-cost premium. */
  annual_goods_premium_usd_cents: number;
  /** Duty change from the move (negative = duty saved). */
  annual_duty_delta_usd_cents: number;
  /** Duty saved minus the goods premium (positive = net win per year). */
  net_annual_benefit_usd_cents: number;
  switching_cost_usd_cents: number;
  /** Months to recover the one-time switching cost, or null if it never pays back. */
  payback_months: number | null;
}

export interface SimResult {
  importer_country: string;
  scenario: SimScenario;
  baseline_value_usd_cents: number;
  scenario_value_usd_cents: number;
  baseline_stack: PortfolioStack;
  scenario_stack: PortfolioStack;
  /** Scenario total duty − baseline total duty (incl. fees). */
  delta_usd_cents: number;
  reroute: RerouteEconomics;
  rows: SimSkuRow[];
}

/** Deterministic representative annual import value per SKU ($120k–$600k). */
function annualValueCents(description: string): number {
  let h = 0;
  for (let i = 0; i < description.length; i++) h = (h * 31 + description.charCodeAt(i)) | 0;
  const dollars = 120_000 + (Math.abs(h) % 481) * 1000; // 120k..600k in $1k steps
  return dollars * 100;
}

interface StackOpts {
  override301: number | null;
  reciprocalRate: number;
  s232Enabled: boolean;
}

/** Decompose duty (excluding entry-level fees) for one SKU at a given value/origin. */
function dutyStack(
  table: TariffRatesTableT,
  hts8: string,
  origin: string,
  valueCents: number,
  opts: StackOpts,
): DutyStack {
  const r = resolveRates(table, hts8, origin);
  const base = Math.round(valueCents * r.base_ad_valorem);
  const s232 = opts.s232Enabled ? Math.round(valueCents * (r.section_232_rate ?? 0)) : 0;
  // Section 301 only on Chinese origin; a flat override replaces the table rate.
  let s301 = 0;
  if (origin.toUpperCase() === "CN") {
    const rate = opts.override301 !== null ? opts.override301 : r.section_301_rate ?? 0;
    s301 = Math.round(valueCents * rate);
  }
  // Reciprocal tariff applies to every origin.
  const reciprocal = Math.round(valueCents * opts.reciprocalRate);
  return {
    base_usd_cents: base,
    section_301_usd_cents: s301,
    section_232_usd_cents: s232,
    reciprocal_usd_cents: reciprocal,
    total_usd_cents: base + s301 + s232 + reciprocal,
  };
}

/** Annualized CBP user fees on a portfolio's customs value (statutory rates, no per-entry cap). */
function annualFees(table: TariffRatesTableT, valueCents: number): { mpf: number; hmf: number } {
  // Across a year of many entries the per-entry MPF cap effectively never binds
  // in aggregate, so the annualized figure is the uncapped statutory rate.
  const mpf = Math.round(valueCents * table.fees.mpf_rate);
  const hmf = Math.round(valueCents * table.fees.hmf_rate); // ocean-borne FBA freight
  return { mpf, hmf };
}

function emptyStack(): PortfolioStack {
  return {
    base_usd_cents: 0,
    section_301_usd_cents: 0,
    section_232_usd_cents: 0,
    reciprocal_usd_cents: 0,
    mpf_usd_cents: 0,
    hmf_usd_cents: 0,
    total_usd_cents: 0,
  };
}

export async function runTariffSimulation(
  ctx: AppContext,
  customerId: string,
  scenario: SimScenario,
): Promise<SimResult> {
  const table = await loadTariffRates(ctx);
  const skus = await listSkuMemory(ctx, customerId, 100);
  const baselineOrigin = "CN"; // the catalog is China-sourced FBA goods

  const rerouting = scenario.reroute_china_to !== null;
  const scenarioOrigin = scenario.reroute_china_to ?? baselineOrigin;
  // Rerouting drops the 301 override (no 301 off China). Goods cost rises by the premium.
  const scenario301 = rerouting ? null : scenario.section_301_rate;
  const premiumMul = rerouting ? 1 + scenario.unit_cost_premium_pct : 1;

  const rows: SimSkuRow[] = skus.map((s) => {
    const hts8 = s.current_hts_code_8;
    const chapter = hts8.replace(/\D/g, "").slice(0, 2);
    const value = annualValueCents(s.canonical_description);
    const scenValue = Math.round(value * premiumMul);

    const baseline = dutyStack(table, hts8, baselineOrigin, value, {
      override301: null,
      reciprocalRate: 0,
      s232Enabled: true,
    });
    const scen = dutyStack(table, hts8, scenarioOrigin, scenValue, {
      override301: scenario301,
      reciprocalRate: scenario.reciprocal_rate,
      s232Enabled: scenario.section_232_enabled,
    });
    return {
      description: s.canonical_description,
      hts_code_8: hts8,
      chapter,
      origin: scenarioOrigin,
      annual_value_usd_cents: value,
      baseline,
      scenario: scen,
      baseline_duty_usd_cents: baseline.total_usd_cents,
      scenario_duty_usd_cents: scen.total_usd_cents,
      delta_usd_cents: scen.total_usd_cents - baseline.total_usd_cents,
    };
  });

  // Portfolio component totals.
  const baseTotals = emptyStack();
  const scenTotals = emptyStack();
  let baselineValue = 0;
  let scenarioValue = 0;
  for (const r of rows) {
    baselineValue += r.annual_value_usd_cents;
    scenarioValue += Math.round(r.annual_value_usd_cents * premiumMul);
    baseTotals.base_usd_cents += r.baseline.base_usd_cents;
    baseTotals.section_301_usd_cents += r.baseline.section_301_usd_cents;
    baseTotals.section_232_usd_cents += r.baseline.section_232_usd_cents;
    baseTotals.reciprocal_usd_cents += r.baseline.reciprocal_usd_cents;
    scenTotals.base_usd_cents += r.scenario.base_usd_cents;
    scenTotals.section_301_usd_cents += r.scenario.section_301_usd_cents;
    scenTotals.section_232_usd_cents += r.scenario.section_232_usd_cents;
    scenTotals.reciprocal_usd_cents += r.scenario.reciprocal_usd_cents;
  }

  if (scenario.include_entry_fees) {
    const bf = annualFees(table, baselineValue);
    const sf = annualFees(table, scenarioValue);
    baseTotals.mpf_usd_cents = bf.mpf;
    baseTotals.hmf_usd_cents = bf.hmf;
    scenTotals.mpf_usd_cents = sf.mpf;
    scenTotals.hmf_usd_cents = sf.hmf;
  }

  const sumStack = (s: PortfolioStack) =>
    s.base_usd_cents +
    s.section_301_usd_cents +
    s.section_232_usd_cents +
    s.reciprocal_usd_cents +
    s.mpf_usd_cents +
    s.hmf_usd_cents;
  baseTotals.total_usd_cents = sumStack(baseTotals);
  scenTotals.total_usd_cents = sumStack(scenTotals);

  // Reroute economics: weigh duty saved against the goods-cost premium.
  const annualGoodsPremium = scenarioValue - baselineValue;
  const annualDutyDelta = scenTotals.total_usd_cents - baseTotals.total_usd_cents;
  const netAnnualBenefit = -annualDutyDelta - annualGoodsPremium;
  let payback: number | null = null;
  if (rerouting && netAnnualBenefit > 0) {
    payback = Math.round((scenario.switching_cost_usd_cents / netAnnualBenefit) * 12 * 10) / 10;
  }

  rows.sort((a, b) => Math.abs(b.delta_usd_cents) - Math.abs(a.delta_usd_cents));

  return {
    importer_country: baselineOrigin,
    scenario,
    baseline_value_usd_cents: baselineValue,
    scenario_value_usd_cents: scenarioValue,
    baseline_stack: baseTotals,
    scenario_stack: scenTotals,
    delta_usd_cents: annualDutyDelta,
    reroute: {
      active: rerouting,
      to: scenario.reroute_china_to,
      unit_cost_premium_pct: scenario.unit_cost_premium_pct,
      annual_goods_premium_usd_cents: annualGoodsPremium,
      annual_duty_delta_usd_cents: annualDutyDelta,
      net_annual_benefit_usd_cents: netAnnualBenefit,
      switching_cost_usd_cents: scenario.switching_cost_usd_cents,
      payback_months: payback,
    },
    rows,
  };
}
