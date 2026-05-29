// Simulated CBP focused-assessment defense packet.
//
// When a classification (or refund opportunity) needs to be defended to a
// CBP auditor, this agent simulates the exchange:
//   - It generates 6-8 specific questions a CBP focused-assessment officer
//     would ask about the classification.
//   - For each question, it composes a documented answer using ONLY the
//     evidence in the classification trace (description, citations,
//     alternative codes considered, reasoning, missing inputs).
//
// Output is an "audit-readiness packet" — the document a licensed broker
// can hand directly to a CBP officer if the classification is challenged.
// One Claude call, structured output. No external rulings fetched in this
// pass (that's the CROSS-grounded verifier's job); the answers cite only
// what the classifier already cited.

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";

const TOOL_NAME = "report_audit_defense";
const MAX_OUTPUT_TOKENS = 4096;
export const AUDIT_DEFENSE_PROMPT_VERSION = "v1-2026-05-29";

export const AuditQuestion = z.object({
  /** Short identifier — "Q1", "Q2", etc. */
  id: z.string(),
  /** The auditor's question, verbatim. */
  question: z.string().min(10),
  /** Defense answer — broker-quality, with specific HTS / GRI citations from the trace. */
  answer: z.string().min(20),
  /** HTS / GRI / chapter-note citations referenced in the answer (for audit pickup). */
  citations: z.array(z.string()),
  /** Strength of the defense for this question. */
  strength: z.enum(["strong", "adequate", "thin"]),
});
export type AuditQuestionT = z.infer<typeof AuditQuestion>;

export const AuditDefenseOutput = z.object({
  /** One-paragraph readiness summary for the broker. */
  overall_readiness: z.string().min(30),
  /** Top risk if CBP picks at this classification (single sentence). */
  primary_risk: z.string().min(10),
  questions: z.array(AuditQuestion).min(4).max(10),
});
export type AuditDefenseOutputT = z.infer<typeof AuditDefenseOutput>;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    overall_readiness: { type: "string" },
    primary_risk: { type: "string" },
    questions: {
      type: "array",
      minItems: 4,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          answer: { type: "string" },
          citations: { type: "array", items: { type: "string" } },
          strength: { type: "string", enum: ["strong", "adequate", "thin"] },
        },
        required: ["id", "question", "answer", "citations", "strength"],
      },
    },
  },
  required: ["overall_readiness", "primary_risk", "questions"],
};

const SYSTEM_PROMPT = `You are simulating a US Customs and Border Protection focused-assessment exchange. Half your job is the auditor — generate the questions a CBP officer trained on the "reasonable care" standard (19 USC 1484 / 19 CFR Part 152) would actually ask about the classification. The other half is the broker — produce defense answers grounded ONLY in the classification trace you're given.

A focused assessment hits these axes; cover them in your 4-8 questions:
  1. **GRI walkthrough.** "Walk me through the General Rules of Interpretation as you applied them." The answer must restate the GRI rule the classifier used and tie it to the description.
  2. **Specific named line vs residual.** If the classified line is named for a criterion (e.g. "votive-candle holders", "of bamboo"), the auditor will ask "what evidence in the description establishes that named criterion?"
  3. **Competing headings.** "What other 4-digit heading did you consider, and why did you reject it?" Use the alternative_codes_considered.
  4. **Section / chapter notes.** "Which chapter or section note did you apply, and verbatim what does it say?" If the classifier didn't quote a note, the answer should say "no controlling note in the candidate set — heading is uncontroversial under GRI 1".
  5. **CROSS rulings.** "Cite a CBP ruling on a materially similar article." Use the citations array; if none of the citations are CROSS rulings, acknowledge this is an HTS-text-only defense.
  6. **Missing data.** "What data did you NOT have that would let you tighten the 8/10-digit pick?" Use missing_inputs_for_precision.
  7. **Confidence.** "What's your confidence in this classification, and what would change your mind?" Use the classifier's confidence field.
  8. **Reasonable care.** "How is this classification defensible under reasonable care?" Restate the strongest pillar of the defense.

For each question, write the answer at broker-quality — short, specific, with the actual HTS code or section/chapter note number that supports it. If the trace evidence is thin for a given question, mark that question's strength as "thin" and say so in the answer: a broker who acknowledges a thin point is more credible than one who pretends.

Be honest in \`primary_risk\` and \`overall_readiness\`. If the classification's reasoning is shaky or relies on a residual line with no named-criterion evidence, say so. The point of this packet is to give the broker a *real* picture of how the classification holds up, not to manufacture confidence.

Do NOT invent CROSS rulings or HTS codes. If a citation would help but isn't in the trace, leave it out and mark strength accordingly.

Call the \`report_audit_defense\` tool.`;

export interface AuditDefenseInput {
  description: string;
  hts_code: string;
  hts_code_8: string;
  gri_rule_applied: string;
  reasoning: string;
  citations: string[];
  alternative_codes_considered: Array<{ hts_code: string; rejected_because: string }>;
  missing_inputs_for_precision: string[];
  confidence: "low" | "medium" | "high";
  country_of_origin?: string | undefined;
  /** If we're defending a refund opportunity, the filed code we're proposing to replace. */
  filed_hts_code_8?: string | undefined;
  /** Recoverable amount if this is a refund (USD cents). */
  recoverable_usd_cents?: number | undefined;
}

export interface AuditDefenseResult {
  auditDefenseId: string;
  promptVersion: string;
  model: string;
  input: AuditDefenseInput;
  defense: AuditDefenseOutputT;
}

export async function generateAuditDefense(
  ctx: AppContext,
  input: AuditDefenseInput,
): Promise<AuditDefenseResult> {
  const auditDefenseId = randomUUID();
  const model = ctx.config.defaultModel;

  const tracePayload = `Classification trace:
  Description: """${input.description}"""
  Predicted HTS: ${input.hts_code} (8-digit ${input.hts_code_8})
  GRI rule applied: ${input.gri_rule_applied}
  Confidence: ${input.confidence}
  Country of origin: ${input.country_of_origin ?? "(not specified)"}
${input.filed_hts_code_8 ? `  Filed HTS we're proposing to replace: ${input.filed_hts_code_8}\n` : ""}${
  input.recoverable_usd_cents !== undefined
    ? `  Recoverable amount: $${(input.recoverable_usd_cents / 100).toFixed(2)} USD\n`
    : ""
}
  Classifier reasoning:
${input.reasoning
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}

  Citations the classifier relied on:
${input.citations.length === 0 ? "    (none)" : input.citations.map((c) => `    - ${c}`).join("\n")}

  Alternative codes considered and rejected:
${
  input.alternative_codes_considered.length === 0
    ? "    (none)"
    : input.alternative_codes_considered.map((a) => `    - ${a.hts_code}: ${a.rejected_because}`).join("\n")
}

  Missing inputs the classifier flagged:
${
  input.missing_inputs_for_precision.length === 0
    ? "    (none)"
    : input.missing_inputs_for_precision.map((m) => `    - ${m}`).join("\n")
}`;

  const userMessage = `${tracePayload}

Generate the focused-assessment defense packet now. Be honest about what's strong and what's thin. Use only evidence in this trace — don't invent CROSS rulings.`;

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report the simulated CBP focused-assessment Q&A and overall readiness",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("audit-defense: model produced no tool_use block");
  const parsed = AuditDefenseOutput.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`audit-defense: tool output failed Zod validation: ${parsed.error.message}`);
  }
  return {
    auditDefenseId,
    promptVersion: AUDIT_DEFENSE_PROMPT_VERSION,
    model,
    input,
    defense: parsed.data,
  };
}
