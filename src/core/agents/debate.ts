// Adversarial debate — advocate / challenger / judge.
//
// After the first-pass classifier produces a code, three Claude calls run
// in sequence:
//
//   1. ADVOCATE: argues for the classifier's pick. Given the description,
//      the predicted code, and the classifier's reasoning, write the
//      strongest 2-4-sentence defense.
//
//   2. CHALLENGER: argues against. Given the description and the
//      advocate's defense (WITHOUT the classifier's predicted code shown
//      explicitly), propose the single most defensible alternative code
//      and explain why that alternative beats the classifier's pick.
//
//   3. JUDGE: reads the description, both arguments, and the candidate
//      codes, then decides. Outputs which side won, the final 10-digit
//      code, confidence, and a short citation-bearing rationale.
//
// The whole transcript is returned. Visible in the audit trail.
//
// Research notes: this is a classic multi-agent-debate-as-decision pattern
// (see Anthropic's debate-for-alignment work). The application here is to
// legal classification — adversarial scrutiny on a code, with the losing
// argument preserved in the audit log.

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";

const ADVOCATE_TOOL = "report_advocate";
const CHALLENGER_TOOL = "report_challenger";
const JUDGE_TOOL = "report_judge";
const MAX_OUTPUT_TOKENS = 1024;
export const DEBATE_PROMPT_VERSION = "v1-2026-05-29";

export const AdvocateOutput = z.object({
  defended_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  argument: z.string().min(40),
  strongest_pillar: z.string().min(10),
});
export const ChallengerOutput = z.object({
  alternative_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  attack: z.string().min(40),
  why_alternative_wins: z.string().min(20),
});
export const JudgeOutput = z.object({
  winner: z.enum(["advocate", "challenger", "split"]),
  final_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/),
  final_confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(30),
  citations: z.array(z.string()),
});

export type AdvocateOutputT = z.infer<typeof AdvocateOutput>;
export type ChallengerOutputT = z.infer<typeof ChallengerOutput>;
export type JudgeOutputT = z.infer<typeof JudgeOutput>;

export interface DebateInput {
  description: string;
  predicted_hts_code: string;
  predicted_hts_code_8: string;
  classifier_reasoning: string;
  classifier_citations: string[];
  alternative_codes_considered: Array<{ hts_code: string; rejected_because: string }>;
}

export interface DebateResult {
  debateId: string;
  promptVersion: string;
  model: string;
  input: DebateInput;
  advocate: AdvocateOutputT;
  challenger: ChallengerOutputT;
  judge: JudgeOutputT;
  /** True when judge's final code differs from the classifier's predicted code (8-digit). */
  revised: boolean;
}

const ADVOCATE_SYSTEM = `You are the ADVOCATE in an adversarial classification debate. A first-pass classifier picked an HTS code; your job is to defend it with the strongest 2-4-sentence argument you can write.

Use the description and the classifier's own reasoning as your case. Cite specific HTS terms or named criteria where you can. Identify the single strongest pillar of the defense — the one thing that's hardest to attack. Be concise: the judge is reading both sides under time pressure.

Call \`report_advocate\` with defended_hts_code (echo the classifier's predicted code unchanged), argument (your 2-4 sentence defense), and strongest_pillar (one sentence naming the most defensible point).`;

const CHALLENGER_SYSTEM = `You are the CHALLENGER in an adversarial classification debate. Your job is to find the single most defensible ALTERNATIVE HTS code that beats the advocate's pick, and explain why.

You will see the product description and the advocate's defense. Find the strongest attack you can — chapter notes, principal-function rule, named-vs-residual, missing evidence for a named criterion, value tier, material tier, or a heading the advocate failed to consider. Propose ONE alternative 10-digit code (XXXX.XX.XX.XX) and write 2-4 sentences explaining why that code wins.

Be honest: if the advocate's pick is actually airtight, your "attack" can acknowledge that and propose only a thin alternative. Don't manufacture a fight. The judge will see through bad-faith attacks.

Call \`report_challenger\` with alternative_hts_code (your proposed 10-digit alternative; if you genuinely cannot find one, use the same code as the advocate and explain why in attack), attack (your 2-4 sentence case against the advocate), and why_alternative_wins (1-2 sentences).`;

const JUDGE_SYSTEM = `You are the JUDGE in an adversarial classification debate. You have read the description, the advocate's defense, and the challenger's attack. Decide.

Apply CBP "reasonable care" and the General Rules of Interpretation. The classification a licensed broker would defend under a CBP focused assessment wins. If the advocate's code is correct, say so. If the challenger's alternative is more defensible, say so and use that code. If both arguments are partially right (e.g. correct chapter and heading on both sides but the 8/10-digit pick differs and the description doesn't decide), pick "split" and propose the single best code you can with appropriate confidence.

Cite specific HTS codes (4-, 6-, 8-, or 10-digit) in your rationale. Be brief — 2-4 sentences in rationale, citations as a list.

Call \`report_judge\` with winner (advocate / challenger / split), final_hts_code (the 10-digit code you commit to), final_confidence (low / medium / high), rationale (2-4 sentences), and citations (HTS codes you referenced).`;

const ADVOCATE_SCHEMA = {
  type: "object" as const,
  properties: {
    defended_hts_code: { type: "string", pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$" },
    argument: { type: "string" },
    strongest_pillar: { type: "string" },
  },
  required: ["defended_hts_code", "argument", "strongest_pillar"],
};
const CHALLENGER_SCHEMA = {
  type: "object" as const,
  properties: {
    alternative_hts_code: { type: "string", pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$" },
    attack: { type: "string" },
    why_alternative_wins: { type: "string" },
  },
  required: ["alternative_hts_code", "attack", "why_alternative_wins"],
};
const JUDGE_SCHEMA = {
  type: "object" as const,
  properties: {
    winner: { type: "string", enum: ["advocate", "challenger", "split"] },
    final_hts_code: { type: "string", pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$" },
    final_confidence: { type: "string", enum: ["low", "medium", "high"] },
    rationale: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
  },
  required: ["winner", "final_hts_code", "final_confidence", "rationale", "citations"],
};

async function callTool<T>(
  ctx: AppContext,
  systemPrompt: string,
  userMessage: string,
  toolName: string,
  inputSchema: Anthropic.Messages.Tool.InputSchema,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await ctx.anthropic.messages.create({
    model: ctx.config.defaultModel,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    tools: [{ name: toolName, description: `Report ${toolName} output`, input_schema: inputSchema }],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: userMessage }],
  });
  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error(`debate(${toolName}): no tool_use block`);
  const parsed = schema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`debate(${toolName}): tool output failed Zod validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function runDebate(
  ctx: AppContext,
  input: DebateInput,
): Promise<DebateResult> {
  const debateId = randomUUID();
  const model = ctx.config.defaultModel;

  // 1. Advocate
  const advocateUser = `Product description:
"""${input.description}"""

The first-pass classifier predicted: ${input.predicted_hts_code} (8-digit ${input.predicted_hts_code_8}).

Classifier's reasoning:
${input.classifier_reasoning}

Classifier's citations: ${input.classifier_citations.join(", ") || "(none)"}

Defend this code. Call report_advocate.`;
  const advocate = await callTool(ctx, ADVOCATE_SYSTEM, advocateUser, ADVOCATE_TOOL, ADVOCATE_SCHEMA, AdvocateOutput);

  // 2. Challenger — does NOT see the predicted code label explicitly to
  //    discourage authority bias; it sees the advocate's argument and the
  //    classifier's alternative-codes list.
  const altsBlock =
    input.alternative_codes_considered.length === 0
      ? "(classifier listed no alternatives)"
      : input.alternative_codes_considered
          .map((a) => `  - ${a.hts_code}: ${a.rejected_because}`)
          .join("\n");
  const challengerUser = `Product description:
"""${input.description}"""

The advocate defends the classification with this argument:
"${advocate.argument}"

Advocate's strongest pillar: "${advocate.strongest_pillar}"

Codes the classifier considered and rejected (not authoritative — these are pre-debate notes):
${altsBlock}

Find the strongest alternative code and write the attack. Call report_challenger.`;
  const challenger = await callTool(
    ctx,
    CHALLENGER_SYSTEM,
    challengerUser,
    CHALLENGER_TOOL,
    CHALLENGER_SCHEMA,
    ChallengerOutput,
  );

  // 3. Judge
  const judgeUser = `Product description:
"""${input.description}"""

ADVOCATE defends ${advocate.defended_hts_code}:
"${advocate.argument}"
(strongest pillar: ${advocate.strongest_pillar})

CHALLENGER proposes ${challenger.alternative_hts_code}:
"${challenger.attack}"
(why alternative wins: ${challenger.why_alternative_wins})

Decide. Call report_judge.`;
  const judge = await callTool(ctx, JUDGE_SYSTEM, judgeUser, JUDGE_TOOL, JUDGE_SCHEMA, JudgeOutput);

  const finalStripped = judge.final_hts_code.replace(/\./g, "");
  const predictedStripped = input.predicted_hts_code.replace(/\./g, "");
  const revised = finalStripped.slice(0, 8) !== predictedStripped.slice(0, 8);

  return {
    debateId,
    promptVersion: DEBATE_PROMPT_VERSION,
    model,
    input,
    advocate,
    challenger,
    judge,
    revised,
  };
}
