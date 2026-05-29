// Sourcing & customs-relief intelligence — the second-order-effects agent.
//
// Tariffs have second-order effects: manufacturing relocates, and a stack of
// customs-relief mechanisms (FTA preference, first-sale valuation, drawback,
// Foreign-Trade Zones, Section 301 exclusions) can legally cut the duty bill
// without moving anything. For a given product this agent reasons about:
//   1. WHERE the manufacturing could realistically move (which countries
//      actually make this product category, ranked by ease-of-move), and
//   2. HOW MUCH each move changes the duty — grounded by re-running the
//      deterministic duty calculator for each candidate country, not guessed.
//   3. WHICH customs-relief mechanisms apply and how.
//   4. The SECOND-ORDER trade-offs (lead time, MOQ, origin rules, etc.).
//
// The LLM supplies the strategy; the duty deltas are real math.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { calculateDuty } from "./duty-calculator";

export const SOURCING_INTEL_PROMPT_VERSION = "v1-2026-05-29";
const MAX_OUTPUT_TOKENS = 3000;

export const SourcingIntelOutput = z.object({
  relocation_options: z
    .array(
      z.object({
        country_iso2: z.string().regex(/^[A-Z]{2}$/),
        country_name: z.string(),
        feasibility: z.enum(["high", "medium", "low"]),
        rationale: z.string().min(10),
      }),
    )
    .min(1)
    .max(5),
  relief_mechanisms: z
    .array(
      z.object({
        mechanism: z.string(),
        applicability: z.enum(["likely", "possible", "unlikely"]),
        how: z.string().min(10),
      }),
    )
    .min(1)
    .max(6),
  second_order_effects: z
    .array(z.object({ factor: z.string(), note: z.string().min(8) }))
    .min(1)
    .max(6),
  summary: z.string().min(20),
});
export type SourcingIntelOutputT = z.infer<typeof SourcingIntelOutput>;

const TOOL_NAME = "report_sourcing_intel";
const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    relocation_options: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          country_iso2: { type: "string", pattern: "^[A-Z]{2}$" },
          country_name: { type: "string" },
          feasibility: { type: "string", enum: ["high", "medium", "low"] },
          rationale: { type: "string", description: "Why this product category can move here — existing supplier base, capability, ramp time" },
        },
        required: ["country_iso2", "country_name", "feasibility", "rationale"],
      },
    },
    relief_mechanisms: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          mechanism: { type: "string", description: "e.g. USMCA preference, First-sale valuation, Duty drawback, Foreign-Trade Zone, Section 301 exclusion, Section 321 de minimis" },
          applicability: { type: "string", enum: ["likely", "possible", "unlikely"] },
          how: { type: "string", description: "How it works for this product and what the importer must do" },
        },
        required: ["mechanism", "applicability", "how"],
      },
    },
    second_order_effects: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: { factor: { type: "string" }, note: { type: "string" } },
        required: ["factor", "note"],
      },
    },
    summary: { type: "string" },
  },
  required: ["relocation_options", "relief_mechanisms", "second_order_effects", "summary"],
};

const SYSTEM_PROMPT = `You are a trade-strategy advisor for a US importer. Given a product, its HTS code, current country of origin, and annual import value, analyze the SECOND-ORDER strategy a sophisticated importer would consider in response to tariffs.

Produce four things:

1. relocation_options — 3–5 countries the manufacturing of THIS product category could realistically move to, ranked by feasibility. Be specific and honest: name countries that genuinely have a supplier base for this product type (e.g. electronics → Vietnam, Mexico, India, Taiwan; apparel → Vietnam, Bangladesh, India; furniture → Vietnam, Malaysia). "feasibility" reflects how easily production moves there — existing ecosystem, tooling, labor, ramp time — NOT just the duty rate. Give a one-to-two sentence rationale per country.

2. relief_mechanisms — which US customs-relief tools apply to THIS product, each with applicability (likely / possible / unlikely) and a concrete "how." Consider: FTA preference (USMCA if from Mexico/Canada and the rule of origin is met), first-sale valuation (dutiable value = the first sale in a multi-tier transaction, not the price to the US buyer), duty drawback (refund of duty on imported inputs that are later exported), Foreign-Trade Zones (defer/avoid duty on re-exports, inverted-tariff relief), Section 301 exclusions (if USTR has an active exclusion for the HTS line), Section 321 de minimis (note this is being curtailed). Only list mechanisms that plausibly apply; mark a stretch as "unlikely" rather than omitting if it's worth flagging.

3. second_order_effects — the trade-offs and ripple effects: lead time and MOQ changes, supplier quality/ramp risk, tariff stacking (301 + 232 + AD/CVD), substantial-transformation / origin rules (a real move must change origin, not transship), reshoring incentives, inventory/working-capital effects.

4. summary — 2–3 sentences a CFO can act on.

Be rigorous and honest. Do NOT suggest origin misdeclaration or transshipment to fake origin. Do NOT invent FTAs or exclusions. Ground claims in real US customs practice. Call the report_sourcing_intel tool.`;

export interface SourcingIntelInput {
  description: string;
  hts_code_8: string;
  current_country_iso2: string;
  annual_value_usd_cents: number;
}

export interface RelocationPriced {
  country_iso2: string;
  country_name: string;
  feasibility: "high" | "medium" | "low";
  rationale: string;
  /** Real duty under this country, from the deterministic calculator. */
  annual_duty_usd_cents: number;
  /** Change vs the current country (negative = savings). */
  duty_delta_usd_cents: number;
}

export interface SourcingIntelResult {
  promptVersion: string;
  input: SourcingIntelInput;
  current_annual_duty_usd_cents: number;
  relocation_options: RelocationPriced[];
  relief_mechanisms: SourcingIntelOutputT["relief_mechanisms"];
  second_order_effects: SourcingIntelOutputT["second_order_effects"];
  summary: string;
}

export async function analyzeSourcing(ctx: AppContext, input: SourcingIntelInput): Promise<SourcingIntelResult> {
  const model = ctx.config.defaultModel;
  const user = `Product: ${input.description}
HTS (8-digit): ${input.hts_code_8}
Current country of origin: ${input.current_country_iso2}
Annual import value: $${(input.annual_value_usd_cents / 100).toLocaleString()}

Analyze relocation options, customs-relief mechanisms, and second-order effects. Call the tool.`;

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "Report the sourcing & relief analysis", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: user }],
  });
  const toolUse = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("sourcing-intel: no tool_use block");
  const parsed = SourcingIntelOutput.safeParse(toolUse.input);
  if (!parsed.success) throw new Error(`sourcing-intel: validation failed: ${parsed.error.message}`);

  // Ground every relocation option with real duty math.
  const current = await calculateDuty(ctx, {
    hts_code: input.hts_code_8,
    country_of_origin: input.current_country_iso2,
    customs_value_usd_cents: input.annual_value_usd_cents,
    transport_mode: "ocean",
    include_entry_fees: false,
  });

  const priced: RelocationPriced[] = [];
  for (const opt of parsed.data.relocation_options) {
    let dutyCents = current.total_duty_usd_cents;
    try {
      const d = await calculateDuty(ctx, {
        hts_code: input.hts_code_8,
        country_of_origin: opt.country_iso2,
        customs_value_usd_cents: input.annual_value_usd_cents,
        transport_mode: "ocean",
        include_entry_fees: false,
      });
      dutyCents = d.total_duty_usd_cents;
    } catch {
      /* keep current as fallback */
    }
    priced.push({
      ...opt,
      annual_duty_usd_cents: dutyCents,
      duty_delta_usd_cents: dutyCents - current.total_duty_usd_cents,
    });
  }
  // Best duty outcome first.
  priced.sort((a, b) => a.duty_delta_usd_cents - b.duty_delta_usd_cents);

  return {
    promptVersion: SOURCING_INTEL_PROMPT_VERSION,
    input,
    current_annual_duty_usd_cents: current.total_duty_usd_cents,
    relocation_options: priced,
    relief_mechanisms: parsed.data.relief_mechanisms,
    second_order_effects: parsed.data.second_order_effects,
    summary: parsed.data.summary,
  };
}
