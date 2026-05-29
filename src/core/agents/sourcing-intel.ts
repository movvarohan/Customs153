// Sourcing & customs-relief intelligence — the second-order-effects agent.
//
// Tariffs move factories and trigger customs-relief strategy. For a product
// this agent researches:
//   1. Named manufacturing HUBS the product could relocate to (city + region
//      + example supplier ecosystem), with coordinates so they plot on a map.
//   2. The full LANDED-COST picture per hub: a unit-cost index vs China, the
//      resulting annual goods cost, the REAL duty (re-run through the
//      deterministic calculator on the adjusted customs value), and total
//      landed cost + delta — plus lead time, ramp, MOQ.
//   3. Customs-relief mechanisms (FTA, first-sale, drawback, FTZ, 301
//      exclusions) and second-order effects.
// The LLM supplies the research and the cost indices; the duty figures are
// real math.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { calculateDuty } from "./duty-calculator";

export const SOURCING_INTEL_PROMPT_VERSION = "v2-2026-05-29";
const MAX_OUTPUT_TOKENS = 4096;

const Hub = z.object({
  country_iso2: z.string().regex(/^[A-Z]{2}$/),
  country_name: z.string(),
  hub_city: z.string(),
  hub_region: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  feasibility: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(10),
  example_suppliers: z.array(z.string()).min(1).max(6),
  unit_cost_index: z.number().min(40).max(300), // China = 100
  ramp_time_months: z.number().min(0).max(48),
  lead_time_note: z.string(),
  moq_note: z.string(),
});

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

const TOOL_NAME = "report_sourcing_intel";
const TOOL_SCHEMA = {
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
          hub_city: { type: "string", description: "A real manufacturing city/cluster for this product category, e.g. Bắc Ninh, Chennai, Monterrey" },
          hub_region: { type: "string", description: "The industrial corridor / what it's known for" },
          lat: { type: "number" },
          lng: { type: "number" },
          feasibility: { type: "string", enum: ["high", "medium", "low"] },
          rationale: { type: "string" },
          example_suppliers: { type: "array", items: { type: "string" }, description: "Named contract manufacturers / OEM types operating there for this product category (research)" },
          unit_cost_index: { type: "number", description: "Per-unit ex-works cost relative to China=100 (e.g. 108 = 8% more expensive, 92 = 8% cheaper)" },
          ramp_time_months: { type: "number", description: "Realistic months to qualify a supplier and reach volume" },
          lead_time_note: { type: "string", description: "Ocean transit / lead-time change vs China" },
          moq_note: { type: "string", description: "Minimum-order-quantity implications during ramp" },
        },
        required: ["country_iso2", "country_name", "hub_city", "hub_region", "lat", "lng", "feasibility", "rationale", "example_suppliers", "unit_cost_index", "ramp_time_months", "lead_time_note", "moq_note"],
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

const SYSTEM_PROMPT = `You are a trade-strategy and supply-chain advisor for a US importer responding to tariffs. For the given product, do the research a sourcing consultant would and produce a relocation + customs-relief dossier.

current_hub: name the city/region where this product is most likely made today in its current country of origin, with approximate lat/lng.

relocation_options (3–5, ranked by feasibility): for each, name a REAL manufacturing city/cluster that actually makes this product category — be specific (e.g. electronics: Bắc Ninh / Bac Giang Vietnam, Chennai / Sri City India, Monterrey Mexico, Penang Malaysia; apparel: Dhaka Bangladesh, Hanoi Vietnam, Tiruppur India; furniture: Binh Duong Vietnam). Give approximate lat/lng for the city. List example_suppliers — named contract manufacturers or the OEM ecosystem operating there for this category (e.g. "Luxshare, GoerTek (audio EMS)", "Foxconn Chennai", "regional cut-and-sew clusters"). Give a unit_cost_index relative to China=100 reflecting realistic ex-works cost (most low-cost countries are within 90–120; Mexico/Eastern Europe higher; some cheaper), ramp_time_months, a lead_time_note, and a moq_note. feasibility reflects ecosystem maturity and ramp risk, not the duty.

relief_mechanisms: FTA/USMCA preference, first-sale valuation, duty drawback, Foreign-Trade Zones, Section 301 exclusions, Section 321 — each with applicability (likely/possible/unlikely), a concrete how, and est_savings_pct (rough % of the duty bill, or null).

second_order_effects: lead-time/MOQ, supplier ramp/quality, tariff stacking, substantial-transformation origin rules, reshoring incentives, working capital.

summary: 2–3 sentences a CFO can act on.

Be rigorous and specific — name real places and real supplier ecosystems. Do NOT suggest transshipment/origin-faking or invent FTAs. Call report_sourcing_intel.`;

export interface SourcingIntelInput {
  description: string;
  hts_code_8: string;
  current_country_iso2: string;
  annual_value_usd_cents: number;
}

export interface PricedHub {
  country_iso2: string;
  country_name: string;
  hub_city: string;
  hub_region: string;
  lat: number;
  lng: number;
  feasibility: "high" | "medium" | "low";
  rationale: string;
  example_suppliers: string[];
  unit_cost_index: number;
  ramp_time_months: number;
  lead_time_note: string;
  moq_note: string;
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
}

export async function analyzeSourcing(ctx: AppContext, input: SourcingIntelInput): Promise<SourcingIntelResult> {
  const model = ctx.config.defaultModel;
  const user = `Product: ${input.description}
HTS (8-digit): ${input.hts_code_8}
Current country of origin: ${input.current_country_iso2}
Annual import value (customs value): $${(input.annual_value_usd_cents / 100).toLocaleString()}

Research relocation hubs (with coordinates, supplier ecosystems, and cost indices), customs-relief mechanisms, and second-order effects. Call the tool.`;

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "Report the sourcing & relief dossier", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: user }],
  });
  const toolUse = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("sourcing-intel: no tool_use block");
  const parsed = SourcingIntelOutput.safeParse(toolUse.input);
  if (!parsed.success) throw new Error(`sourcing-intel: validation failed: ${parsed.error.message}`);

  const current = await calculateDuty(ctx, {
    hts_code: input.hts_code_8,
    country_of_origin: input.current_country_iso2,
    customs_value_usd_cents: input.annual_value_usd_cents,
    transport_mode: "ocean",
    include_entry_fees: false,
  });
  const currentLanded = input.annual_value_usd_cents + current.total_duty_usd_cents;

  const priced: PricedHub[] = [];
  for (const o of parsed.data.relocation_options) {
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
    } catch { /* fallback */ }
    const landed = goods + dutyCents;
    priced.push({
      ...o,
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
    current_hub: parsed.data.current_hub,
    current_annual_duty_usd_cents: current.total_duty_usd_cents,
    current_total_landed_usd_cents: currentLanded,
    relocation_options: priced,
    relief_mechanisms: parsed.data.relief_mechanisms,
    second_order_effects: parsed.data.second_order_effects,
    summary: parsed.data.summary,
  };
}
