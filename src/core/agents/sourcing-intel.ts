// Sourcing & customs-relief intelligence — the second-order-effects agent.
//
// This agent RESEARCHES rather than recalls. It runs an agentic loop with:
//   - web_search (Anthropic server tool): live research for named factories,
//     manufacturing ecosystems, freight/shipping availability, and export
//     capacity, returning real citations.
//   - world_bank_country_profile (our tool): keyless World Bank macro data
//     (GDP/capita as a labor-cost proxy, manufacturing % of GDP, labor-force
//     size) to ground labor-cost and capacity claims in real numbers.
//   - report_sourcing_intel (structured output): the final dossier.
//
// For each candidate relocation hub it then prices the full LANDED-COST
// picture through the REAL deterministic duty calculator (goods cost adjusted
// by the researched unit-cost index, then real duty on that customs value).
//
// The LLM supplies researched judgement; the duty figures and the macro data
// are real, and every run carries its web + World Bank citations.

import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { calculateDuty } from "./duty-calculator";
import { runResearchLoop, type SourceCitation } from "@/core/lib/research/research-loop";

export const SOURCING_INTEL_PROMPT_VERSION = "v3-research-2026-05-29";
const MAX_OUTPUT_TOKENS = 8000;

const Hub = z.object({
  country_iso2: z.string().regex(/^[A-Z]{2}$/),
  country_name: z.string(),
  hub_city: z.string(),
  hub_region: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  feasibility: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(10),
  example_suppliers: z.array(z.string()).min(1).max(12),
  unit_cost_index: z.number().min(40).max(300), // China = 100
  avg_labor_cost_note: z.string().min(4),
  manufacturing_availability: z.enum(["high", "medium", "low"]),
  ramp_time_months: z.number().min(0).max(48),
  lead_time_note: z.string(),
  moq_note: z.string(),
});
type HubT = z.infer<typeof Hub>;

export const SourcingIntelOutput = z.object({
  current_hub: z.object({ city: z.string(), region: z.string(), lat: z.number(), lng: z.number() }),
  relocation_options: z.array(Hub).min(1).max(5),
  relief_mechanisms: z
    .array(z.object({ mechanism: z.string(), applicability: z.enum(["likely", "possible", "unlikely"]), how: z.string().min(10), est_savings_pct: z.number().min(0).max(100).nullable() }))
    .min(1)
    .max(6),
  second_order_effects: z.array(z.object({ factor: z.string(), note: z.string().min(8) })).min(1).max(6),
  summary: z.string().min(20),
});
export type SourcingIntelOutputT = z.infer<typeof SourcingIntelOutput>;

const REPORT_TOOL = "report_sourcing_intel";
const WORLD_BANK_TOOL = "world_bank_country_profile";

const REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    current_hub: {
      type: "object",
      description: "The current manufacturing hub for this product (city + region of the current country of origin) with coordinates.",
      properties: { city: { type: "string" }, region: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } },
      required: ["city", "region", "lat", "lng"],
    },
    relocation_options: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          country_iso2: { type: "string", pattern: "^[A-Z]{2}$" },
          country_name: { type: "string" },
          hub_city: { type: "string", description: "A real manufacturing city/cluster for this product category (from your research)" },
          hub_region: { type: "string", description: "The industrial corridor / what it's known for" },
          lat: { type: "number" },
          lng: { type: "number" },
          feasibility: { type: "string", enum: ["high", "medium", "low"] },
          rationale: { type: "string" },
          example_suppliers: { type: "array", items: { type: "string" }, description: "Named contract manufacturers / OEMs operating there for this product category — prefer names you found via web search" },
          unit_cost_index: { type: "number", description: "Per-unit ex-works cost relative to China=100" },
          avg_labor_cost_note: { type: "string", description: "Labor cost grounded in the World Bank data you pulled, e.g. 'GDP/capita $4,300; manufacturing wages ~$250-350/mo'" },
          manufacturing_availability: { type: "string", enum: ["high", "medium", "low"], description: "Capacity/ecosystem availability for THIS product category, informed by labor-force size, manufacturing share, and what your searches found" },
          ramp_time_months: { type: "number" },
          lead_time_note: { type: "string", description: "Ocean transit / lead-time + freight availability vs China" },
          moq_note: { type: "string" },
        },
        required: ["country_iso2", "country_name", "hub_city", "hub_region", "lat", "lng", "feasibility", "rationale", "example_suppliers", "unit_cost_index", "avg_labor_cost_note", "manufacturing_availability", "ramp_time_months", "lead_time_note", "moq_note"],
      },
    },
    relief_mechanisms: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          mechanism: { type: "string" },
          applicability: { type: "string", enum: ["likely", "possible", "unlikely"] },
          how: { type: "string" },
          est_savings_pct: { type: ["number", "null"], description: "Rough % of the duty bill this could save, or null" },
        },
        required: ["mechanism", "applicability", "how", "est_savings_pct"],
      },
    },
    second_order_effects: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "object", properties: { factor: { type: "string" }, note: { type: "string" } }, required: ["factor", "note"] },
    },
    summary: { type: "string" },
  },
  required: ["current_hub", "relocation_options", "relief_mechanisms", "second_order_effects", "summary"],
};

const SYSTEM_PROMPT = `You are a trade-strategy and supply-chain research analyst for a US importer responding to tariffs. Produce a relocation + customs-relief dossier for the given product, backed by RESEARCH, not memory.

Process:
1. Use web_search to find where this specific product category is actually manufactured outside China — name real cities/clusters and real contract manufacturers/OEMs operating there. Search for current freight/shipping availability and lead times from those hubs to the US.
2. For each serious candidate country, call ${WORLD_BANK_TOOL} to get real labor-cost and manufacturing-capacity data (GDP/capita, manufacturing % of GDP, labor-force size). Use it to set avg_labor_cost_note and manufacturing_availability honestly.
3. When research is done, call ${REPORT_TOOL} exactly once with the full dossier.

Guidance:
- current_hub: where this product is most likely made today in its current country of origin, with approximate lat/lng.
- relocation_options (3–5, ranked by feasibility): real city + region + lat/lng, named example_suppliers, a unit_cost_index vs China=100 (most low-cost countries 90–120), avg_labor_cost_note grounded in the World Bank numbers, manufacturing_availability for THIS category, ramp_time_months, a lead_time_note covering shipping availability, and a moq_note.
- relief_mechanisms: FTA/USMCA preference, first-sale valuation, duty drawback, Foreign-Trade Zones, Section 301 exclusions, Section 321 — each with applicability, a concrete how, and est_savings_pct.
- second_order_effects: lead-time/MOQ, supplier ramp/quality, tariff stacking, substantial-transformation origin rules, working capital.
- summary: 2–3 sentences a CFO can act on.

Be rigorous and specific. Do NOT suggest transshipment/origin-faking or invent FTAs. Prefer facts you found via search; if a search is inconclusive, say so in the rationale rather than inventing specifics.

Writing style — IMPORTANT: Write every text field in plain prose. Do NOT use markdown, asterisks, bold (**), bullets, or headings inside field values. Keep "summary" to 2–3 short sentences; each rationale to 1–2 sentences. Put detail in the structured fields, not crammed into one block.`;

export interface SourcingIntelInput {
  description: string;
  hts_code_8: string;
  current_country_iso2: string;
  annual_value_usd_cents: number;
}

export interface PricedHub extends HubT {
  /** annual goods cost = current value × unit_cost_index/100 */
  annual_goods_usd_cents: number;
  /** real duty on the adjusted customs value */
  annual_duty_usd_cents: number;
  /** goods + duty */
  total_landed_usd_cents: number;
  /** total landed vs current total landed (negative = cheaper) */
  landed_delta_usd_cents: number;
  duty_delta_usd_cents: number;
}

export interface SourcingIntelResult {
  promptVersion: string;
  input: SourcingIntelInput;
  current_hub: SourcingIntelOutputT["current_hub"];
  current_annual_duty_usd_cents: number;
  current_total_landed_usd_cents: number;
  relocation_options: PricedHub[];
  relief_mechanisms: SourcingIntelOutputT["relief_mechanisms"];
  second_order_effects: SourcingIntelOutputT["second_order_effects"];
  summary: string;
  /** Web + World Bank citations gathered during research. */
  sources: SourceCitation[];
  /** How many live web searches and World Bank lookups the agent ran. */
  research: { web_searches: number; world_bank_lookups: number };
}

export async function analyzeSourcing(ctx: AppContext, input: SourcingIntelInput): Promise<SourcingIntelResult> {
  const user = `Product: ${input.description}
HTS (8-digit): ${input.hts_code_8}
Current country of origin: ${input.current_country_iso2}
Annual import value (customs value): $${(input.annual_value_usd_cents / 100).toLocaleString()}

Research relocation hubs (named factories, freight availability), pull World Bank labor/capacity data for the candidate countries, then call ${REPORT_TOOL}.`;

  const { data: parsedReport, sources, research } = await runResearchLoop<SourcingIntelOutputT>(ctx, {
    system: SYSTEM_PROMPT,
    user,
    reportToolName: REPORT_TOOL,
    reportToolDescription: "Report the final sourcing & relief dossier.",
    reportSchema: REPORT_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    parse: (input) => {
      const parsed = SourcingIntelOutput.safeParse(input);
      if (!parsed.success) throw new Error(`sourcing-intel: validation failed: ${parsed.error.message}`);
      return parsed.data;
    },
  });

  // Price each hub through the real deterministic duty calculator.
  const current = await calculateDuty(ctx, {
    hts_code: input.hts_code_8,
    country_of_origin: input.current_country_iso2,
    customs_value_usd_cents: input.annual_value_usd_cents,
    transport_mode: "ocean",
    include_entry_fees: false,
  });
  const currentLanded = input.annual_value_usd_cents + current.total_duty_usd_cents;

  const priced: PricedHub[] = [];
  for (const o of parsedReport.relocation_options) {
    const goods = Math.round(input.annual_value_usd_cents * (o.unit_cost_index / 100));
    let dutyCents = current.total_duty_usd_cents;
    try {
      const d = await calculateDuty(ctx, {
        hts_code: input.hts_code_8,
        country_of_origin: o.country_iso2,
        customs_value_usd_cents: goods,
        transport_mode: "ocean",
        include_entry_fees: false,
      });
      dutyCents = d.total_duty_usd_cents;
    } catch { /* fallback to current duty */ }
    const landed = goods + dutyCents;
    priced.push({
      ...o,
      example_suppliers: o.example_suppliers.slice(0, 6),
      annual_goods_usd_cents: goods,
      annual_duty_usd_cents: dutyCents,
      total_landed_usd_cents: landed,
      landed_delta_usd_cents: landed - currentLanded,
      duty_delta_usd_cents: dutyCents - current.total_duty_usd_cents,
    });
  }
  priced.sort((a, b) => a.total_landed_usd_cents - b.total_landed_usd_cents);

  return {
    promptVersion: SOURCING_INTEL_PROMPT_VERSION,
    input,
    current_hub: parsedReport.current_hub,
    current_annual_duty_usd_cents: current.total_duty_usd_cents,
    current_total_landed_usd_cents: currentLanded,
    relocation_options: priced,
    relief_mechanisms: parsedReport.relief_mechanisms,
    second_order_effects: parsedReport.second_order_effects,
    summary: parsedReport.summary,
    sources,
    research,
  };
}
