// Counterfactual classification — "tariff engineering" for one line item.
//
// Given a classified line (description + chosen HTS code + country of origin
// + customs value), this agent asks Claude to propose 3-5 plausible product
// or sourcing changes the importer could make to reduce duty, and for each
// change predicts the resulting HTS code. We then run the deterministic
// duty calculator on each scenario so the savings figure isn't an LLM
// hallucination — it's the actual rate table applied.
//
// Categories of scenarios we ask for:
//   • Country-of-origin change (e.g. CN -> VN to drop Section 301)
//   • Material change (e.g. steel -> aluminum to change chapter)
//   • Structural change (e.g. import components separately, change valuation
//     method, ship without retail packaging to change the unit of account)
//   • FTA preference (e.g. USMCA eligibility if produced in Mexico/Canada)
//
// The output is information-only — the broker / importer decides whether
// any change is operationally feasible. We never tell them to lie about
// origin or restructure transactions to evade — we surface options that
// are legally available under known tariff engineering doctrine.

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { calculateDuty } from "./duty-calculator";

const TOOL_NAME = "report_counterfactuals";
const MAX_OUTPUT_TOKENS = 4096;
export const COUNTERFACTUAL_PROMPT_VERSION = "v1-2026-05-29";

export const CounterfactualScenario = z.object({
  /** Short broker-facing label. */
  label: z.string().min(2),
  /** Category of change. */
  kind: z.enum(["country_of_origin", "material", "structural", "fta_preference", "other"]),
  /** Plain-English description of the change. */
  what_changes: z.string().min(8),
  /** Predicted 8-digit HTS code after the change. Null if same as filed. */
  alternative_hts_8: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/).nullable(),
  /** ISO-2 country code for the new origin. Null if no origin change. */
  alternative_country_iso2: z.string().regex(/^[A-Z]{2}$/).nullable(),
  /** Concise legal/commercial rationale (1-3 sentences). */
  reasoning: z.string().min(20),
  /** Operational notes the broker should consider (e.g. "requires supplier in VN"). */
  operational_notes: z.string(),
});
export type CounterfactualScenarioT = z.infer<typeof CounterfactualScenario>;

export const CounterfactualOutput = z.object({
  scenarios: z.array(CounterfactualScenario).min(1).max(6),
});

export interface CounterfactualInput {
  description: string;
  filed_hts_code_8: string;
  filed_country_iso2: string;
  customs_value_usd_cents: number;
  /** Filed duty for comparison. */
  filed_total_duty_usd_cents: number;
}

export interface ComputedScenario extends CounterfactualScenarioT {
  /** Duty if this scenario were filed. */
  scenario_total_duty_usd_cents: number;
  /** filed - scenario; positive means savings. */
  savings_usd_cents: number;
  /** Savings as percentage of filed duty. */
  savings_pct: number;
  /** Echoed from the duty calc for traceability. */
  duty_components: { kind: string; rate: number | null; amount_usd_cents: number; source_citation: string }[];
  /** Anything the duty calc warned about (e.g. fallback rate). */
  warnings: string[];
}

export interface CounterfactualResult {
  counterfactualId: string;
  promptVersion: string;
  model: string;
  input: CounterfactualInput;
  scenarios: ComputedScenario[];
}

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    scenarios: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short broker-facing label" },
          kind: {
            type: "string",
            enum: ["country_of_origin", "material", "structural", "fta_preference", "other"],
          },
          what_changes: { type: "string", description: "Plain-English description of the change" },
          alternative_hts_8: {
            type: ["string", "null"],
            pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}$",
            description: "Predicted 8-digit HTS code after the change. Null if same as filed.",
          },
          alternative_country_iso2: {
            type: ["string", "null"],
            pattern: "^[A-Z]{2}$",
            description: "ISO-2 country code for the new origin. Null if no origin change.",
          },
          reasoning: { type: "string", description: "Concise legal/commercial rationale (1-3 sentences)" },
          operational_notes: {
            type: "string",
            description: "What the broker / importer should consider operationally to make this real",
          },
        },
        required: [
          "label",
          "kind",
          "what_changes",
          "alternative_hts_8",
          "alternative_country_iso2",
          "reasoning",
          "operational_notes",
        ],
      },
    },
  },
  required: ["scenarios"],
};

const SYSTEM_PROMPT = `You are a customs broker advising a US importer on legal tariff engineering options for one product line.

You will be given:
  - The seller's product description.
  - The HTS code currently filed (8-digit).
  - The country of origin currently filed.
  - The line's customs value in USD cents.
  - The total duty currently paid on that line (USD cents).

Your task: propose **3 to 5 distinct, materially plausible** changes the importer could make to reduce duty *legally*. Categories:

  1. **country_of_origin** — sourcing the same product from a different country to drop Section 301 (China) or qualify for an FTA. Be specific about the new country. The country must actually be a plausible source for that product type.
  2. **material** — changing a non-essential material so the article moves to a different HTS line with a lower base rate (e.g. steel -> aluminum lid, ferrous -> non-ferrous casing). Only propose this when the material change is commercially feasible without changing the article's function.
  3. **structural** — change the unit of import (e.g. import components separately so each falls into its own heading rather than the higher-rate composite). Cite the legal theory.
  4. **fta_preference** — if the article qualifies for USMCA (or another FTA) under origin rules, surface that. Be specific about the rule of origin.
  5. **other** — anything else clearly legal (e.g. de minimis if applicable, drawback, classification re-examination).

For each scenario:
  - Set \`alternative_hts_8\` to the **8-digit** code the article would fall into AFTER the change. Null if the code doesn't change (e.g. pure origin swap doesn't change the HTS).
  - Set \`alternative_country_iso2\` to the **ISO-2** code of the new origin. Null if origin doesn't change.
  - Write 1-3 sentences of \`reasoning\` citing the legal theory (chapter notes, Section 301 list, USMCA rule, etc.).
  - Write 1-2 sentences of \`operational_notes\` for the broker: what the importer would actually need to do (find a supplier in country X; reformulate the alloy; certify the BOM under USMCA RVC).

**Do NOT**:
  - Suggest origin laundering (claiming a non-origin country for goods actually produced elsewhere).
  - Suggest under-valuation.
  - Suggest mis-classification (e.g. "classify it as Y even though it's clearly X").
  - Propose changes that wouldn't actually reduce duty — be honest if the savings would be marginal.

We will run the duty calculator on each scenario you propose; if your \`alternative_hts_8\` or \`alternative_country_iso2\` is wrong the math will be wrong, so be specific and accurate.

Call the \`report_counterfactuals\` tool with the scenarios.`;

export async function generateCounterfactuals(
  ctx: AppContext,
  input: CounterfactualInput,
): Promise<CounterfactualResult> {
  const counterfactualId = randomUUID();
  const model = ctx.config.defaultModel;

  const userMessage = `Filed line:
Description: """${input.description}"""
Filed HTS (8-digit): ${input.filed_hts_code_8}
Filed country of origin (ISO-2): ${input.filed_country_iso2}
Customs value: $${(input.customs_value_usd_cents / 100).toFixed(2)} USD
Filed total duty: $${(input.filed_total_duty_usd_cents / 100).toFixed(2)} USD

Propose 3-5 distinct, legally available tariff-engineering changes. Be specific. Call the tool.`;

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report 3-5 counterfactual tariff-engineering scenarios with predicted HTS and origin",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("counterfactual: model produced no tool_use block");
  const parsed = CounterfactualOutput.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`counterfactual: tool output failed Zod validation: ${parsed.error.message}`);
  }

  // Score each scenario deterministically with calculateDuty.
  const computed: ComputedScenario[] = [];
  for (const s of parsed.data.scenarios) {
    const hts8 = s.alternative_hts_8 ?? input.filed_hts_code_8;
    const country = s.alternative_country_iso2 ?? input.filed_country_iso2;
    let dutyCents = 0;
    let components: ComputedScenario["duty_components"] = [];
    let warnings: string[] = [];
    try {
      const d = await calculateDuty(ctx, {
        hts_code: hts8,
        country_of_origin: country,
        customs_value_usd_cents: input.customs_value_usd_cents,
        transport_mode: "ocean",
        include_entry_fees: false, // fees are entry-level and would cancel — same as PSC convention
      });
      dutyCents = d.total_duty_usd_cents;
      components = d.components.map((c) => ({
        kind: c.kind,
        rate: c.rate,
        amount_usd_cents: c.amount_usd_cents,
        source_citation: c.source_citation,
      }));
      warnings = d.warnings;
    } catch (e) {
      warnings = [
        `duty calc failed for ${hts8} / ${country}: ${e instanceof Error ? e.message : String(e)}`,
      ];
    }
    const savings = input.filed_total_duty_usd_cents - dutyCents;
    const savings_pct =
      input.filed_total_duty_usd_cents > 0
        ? (savings / input.filed_total_duty_usd_cents) * 100
        : 0;
    computed.push({
      ...s,
      scenario_total_duty_usd_cents: dutyCents,
      savings_usd_cents: savings,
      savings_pct,
      duty_components: components,
      warnings,
    });
  }

  // Sort scenarios by savings descending for the UI.
  computed.sort((a, b) => b.savings_usd_cents - a.savings_usd_cents);

  return {
    counterfactualId,
    promptVersion: COUNTERFACTUAL_PROMPT_VERSION,
    model,
    input,
    scenarios: computed,
  };
}
