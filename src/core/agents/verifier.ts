// Verifier agent — second-pass check on the classifier's chosen HTS code.
//
// Mechanism:
//   1. Caller (the classifier wrapper) hands the verifier:
//        - the importer's product description
//        - the classifier's predicted 10-digit HTS code
//        - the relevant HTS text from the candidate set (the chosen code's
//          chunk + every other candidate sharing the same 4-digit heading,
//          which covers the heading text, the 6-digit subheading, the
//          8/10-digit specific line, and any chapter/section note chunks
//          that the retriever surfaced for this family).
//   2. The verifier calls Claude Sonnet with a focused prompt: "Does the
//      description contain specific, affirmative evidence for every named
//      material/technology/attribute criterion in the predicted line? If
//      not, what is the more defensible code given the evidence that IS
//      present, and why?"
//   3. The verifier returns:
//        agree: bool
//        criteria_check: array of { criterion, evidence_in_description, satisfied }
//        revised_hts_code: 10-digit code if disagree, else null
//        revised_hts_code_8: 8-digit code if disagree, else null
//        revised_reasoning: text if disagree, else null
//        verifier_reasoning: full explanation (always populated)
//
// The wrapper in classifier.ts applies the result:
//   - agree=true   → no change.
//   - agree=false  → revise hts_code / hts_code_8, cap confidence at "medium",
//                    log original + revised in the trace.
//
// Wired in behind ENABLE_VERIFIER=1 so eval can compare with/without
// cleanly. Off by default.

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";

const TOOL_NAME = "report_verification";
const MAX_OUTPUT_TOKENS = 4096;
export const VERIFIER_PROMPT_VERSION = "v1-2026-05-14";

export const VerifierOutput = z.object({
  agree: z.boolean(),
  criteria_check: z.array(
    z.object({
      criterion: z.string(),
      evidence_in_description: z.string(),
      satisfied: z.boolean(),
    }),
  ),
  revised_hts_code: z.string().nullable(),
  revised_hts_code_8: z.string().nullable(),
  revised_reasoning: z.string().nullable(),
  verifier_reasoning: z.string(),
});
export type VerifierOutputT = z.infer<typeof VerifierOutput>;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    criteria_check: {
      type: "array",
      description:
        "For each named material/technology/attribute criterion in the predicted line's text, list one entry: the criterion (verbatim from the HTS line), the specific evidence in the importer description (verbatim quote, or empty string if none), and whether the criterion is satisfied.",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          evidence_in_description: { type: "string" },
          satisfied: { type: "boolean" },
        },
        required: ["criterion", "evidence_in_description", "satisfied"],
      },
    },
    verifier_reasoning: {
      type: "string",
      description:
        "Two-sentence explanation: whether every named criterion has affirmative evidence in the description, and if not, what's missing. Be specific.",
    },
    agree: {
      type: "boolean",
      description:
        "True if every named criterion has affirmative evidence in the description AND no other 8-digit line in the same 6-digit subheading is more defensible given the evidence present.",
    },
    revised_hts_code: {
      type: ["string", "null"],
      pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$",
      description:
        "If agree=false, the more defensible 10-digit code (XXXX.XX.XX.XX). Must come from the same chapter as the predicted code unless the verifier finds a chapter-note exclusion. Null if agree=true.",
    },
    revised_hts_code_8: {
      type: ["string", "null"],
      pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}$",
      description:
        "If agree=false, the 8-digit prefix of revised_hts_code (XXXX.XX.XX). Null if agree=true.",
    },
    revised_reasoning: {
      type: ["string", "null"],
      description:
        "If agree=false, 2-3 sentences explaining why the revised code is more defensible given the evidence in the description. Null if agree=true.",
    },
  },
  required: [
    "criteria_check",
    "verifier_reasoning",
    "agree",
    "revised_hts_code",
    "revised_hts_code_8",
    "revised_reasoning",
  ],
};

const VERIFIER_SYSTEM_PROMPT = `You are a second-pass verifier for US customs HTS classifications. A first-pass classifier has chosen a 10-digit HTS code for a product. Your job is to check whether the importer's description contains specific affirmative evidence for every named criterion in that code's text — and if not, to identify the more defensible code given the evidence that IS present.

You will receive:
  1. The product description from the importer (verbatim).
  2. The predicted 10-digit HTS code.
  3. The full HTS text for that code and its parents (heading at 4-digit, subheading at 6-digit, specific line at 8/10-digit), plus any relevant chapter or section note chunks the retriever surfaced.

# What to check

For each material, technology, attribute, or commercial designation **named in the predicted 8-digit line's own text**, decide:

  • Is there **affirmative evidence in the importer's description** for that criterion? "Affirmative evidence" means an explicit statement in the description that matches the criterion — not absence of contrary evidence, not inference from the product category, not the article's commercial name happening to fit.

  Example of affirmative evidence: predicted line says "Of bamboo" and the description says "Bamboo cutting board". Satisfied.
  Example of MISSING affirmative evidence: predicted line says "Of bamboo" and the description says "Wooden cutting board" (no species named). NOT satisfied — the description does not affirmatively establish bamboo.
  Example of MISSING affirmative evidence: predicted line says "Valued not over $20 each" and the description doesn't state a unit value. NOT satisfied.
  Example of MISSING affirmative evidence: predicted line says "Designed for use solely with light-emitting diode (LED) light sources" and the description says "Desk lamp with adjustable arm" (no light-source technology named). NOT satisfied.

For each criterion, populate one entry in \`criteria_check\` with the criterion (verbatim from the HTS text), the specific evidence (verbatim quote from the description, or empty string if none), and whether it is satisfied.

# When to agree vs disagree

**Agree** if every named criterion in the predicted line is satisfied by affirmative evidence in the description, AND no other 8-digit line in the same 6-digit subheading is more defensible given the evidence present.

**Disagree** if any named criterion in the predicted line is unsatisfied. In that case, propose the more defensible code:

  • Prefer another 8-digit line in the same 6-digit subheading whose criteria the description DOES satisfy (typically the residual / "Other" line if the description is generic).
  • If even the 6-digit subheading is wrong because a chapter or section note excludes the article, propose the correct heading and explain.
  • If a closely related but different 8-digit line (still in the same chapter) is materially more specific to the description, propose that.

The revised code is the one a broker would defend under a CBP focused assessment given ONLY the evidence in the importer's description.

# What NOT to do

  • Do NOT invent evidence. If the description doesn't state a criterion, don't assume it. "Cotton t-shirt" is cotton; "men's t-shirt" is not affirmatively cotton.
  • Do NOT propose a revised code with the same defect — if the predicted line had an unsupported "of bamboo" criterion, the revised code should NOT also require an unsupported criterion of its own.
  • Do NOT consider commercial reasonableness or what the importer "probably meant". The description is the legal record.
  • Do NOT change chapters unless a chapter or section note specifically excludes the article from the predicted chapter.

# Output

Call the \`report_verification\` tool. If agree=true, set revised_hts_code, revised_hts_code_8, and revised_reasoning to null. If agree=false, all three must be populated and revised_hts_code must end in 4 digits (XXXX.XX.XX.XX) with the 8-digit prefix matching revised_hts_code_8.`;

export interface VerifierContext {
  /** The full description as classified. */
  description: string;
  /** The classifier's predicted 10-digit code. */
  predicted_hts_code: string;
  /** Predicted 8-digit prefix. */
  predicted_hts_code_8: string;
  /**
   * HTS text rows for the verifier to see. Each row: {code, level, text}.
   * The wrapper passes through every candidate chunk whose code shares the
   * predicted 4-digit heading (so the verifier sees siblings in the same
   * heading, plus any section/chapter note chunks the retriever surfaced).
   */
  hts_context: Array<{ code: string; level: number; text: string }>;
}

export interface VerifierTrace {
  verifierId: string;
  promptVersion: string;
  model: string;
  context: VerifierContext;
  rawToolInput: unknown;
  result: VerifierOutputT;
  latency_ms: number;
}

export async function verifyClassification(
  ctx: AppContext,
  vctx: VerifierContext,
): Promise<{ result: VerifierOutputT; trace: VerifierTrace }> {
  const verifierId = randomUUID();
  const model = ctx.config.defaultModel;
  const t0 = Date.now();

  const userMessage = buildUserMessage(vctx);

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: VERIFIER_SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report the verification outcome",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("verifier: model produced no tool_use block");
  }

  const parsed = VerifierOutput.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`verifier: tool output failed Zod validation: ${parsed.error.message}`);
  }
  const result = parsed.data;

  // Cross-check: if agree=false, both revised codes must be present and
  // the 8-digit must be a prefix of the 10-digit.
  if (!result.agree) {
    if (!result.revised_hts_code || !result.revised_hts_code_8 || !result.revised_reasoning) {
      throw new Error("verifier: agree=false but revised_hts_code / revised_hts_code_8 / revised_reasoning missing");
    }
    const c10 = result.revised_hts_code.replace(/\./g, "");
    const c8 = result.revised_hts_code_8.replace(/\./g, "");
    if (!c10.startsWith(c8)) {
      throw new Error(
        `verifier: revised_hts_code_8 ${result.revised_hts_code_8} is not a prefix of revised_hts_code ${result.revised_hts_code}`,
      );
    }
  }

  const trace: VerifierTrace = {
    verifierId,
    promptVersion: VERIFIER_PROMPT_VERSION,
    model,
    context: vctx,
    rawToolInput: toolUse.input,
    result,
    latency_ms: Date.now() - t0,
  };

  return { result, trace };
}

function buildUserMessage(v: VerifierContext): string {
  const ctxLines = v.hts_context
    .map((r) => `  [${String(r.level).padStart(2)} dig] ${r.code}  —  ${r.text}`)
    .join("\n");
  return `Product description from the importer:
"${v.description}"

The first-pass classifier predicted: **${v.predicted_hts_code}** (8-digit prefix: ${v.predicted_hts_code_8}).

HTS text for this code and the same heading family (from the candidate set the classifier saw):

${ctxLines || "  (no HTS context available for this family)"}

Apply the verification procedure in the system prompt:
  1. List every named criterion in the predicted 8-digit line's text.
  2. For each, decide whether the description contains affirmative evidence.
  3. If every criterion is satisfied — agree=true.
  4. If any is unsatisfied — propose the more defensible code in the same heading family (or, if a chapter/section note excludes the article, propose the right chapter).

Call the report_verification tool.`;
}
