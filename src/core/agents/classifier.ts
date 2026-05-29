// HTS classification agent.
//
// Flow:
//   1. Embed the product description (Voyage, input_type=query)
//   2. Retrieve top-50 candidates from ctx.htsIndex
//   3. Call Claude with the GRI system prompt and a structured tool definition
//   4. Validate: the returned hts_code and every citation must be in the
//      candidate set. If not, retry once with an explicit reminder. Still
//      invalid? Return the classification with a validation_warning.
//   5. Persist the full trace (candidates, prompt, response, validation) to
//      audit_log for later inspection.

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import type { VectorMatch } from "@/interfaces/vector-store";
import {
  ClassificationOutput,
  ClassificationResult,
  type ClassificationResultT,
} from "@/core/schemas/classification";
import {
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_SYSTEM_PROMPT,
} from "./prompts/classifier-system";
import { verifyClassification } from "./verifier";

const TOP_K = 50;
const MAX_OUTPUT_TOKENS = 2048;
const TOOL_NAME = "report_classification";

// JSON Schema for Anthropic tool use. Kept in lockstep with ClassificationOutput.
//
// Field order matters: Claude fills tool inputs in the order they appear in
// `properties`, so the most-reasoning-first ordering gives the model time to
// think before committing to a code. We had a failure in v2 ([39] wool scarf)
// where the reasoning string identified 6117 but the prediction was 6214 —
// hts_code came first in the schema, so the model wrote it before working
// through the analysis. New order: reasoning → citations → alternatives →
// missing inputs → confidence → gri_rule → hts_code_8 → hts_code (last).
const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    reasoning: {
      type: "string",
      description: "Step-by-step legal reasoning following the decision procedure in the system prompt. Quote section/chapter notes verbatim when applying them. Write this BEFORE committing to a code.",
    },
    citations: {
      type: "array",
      minItems: 1,
      items: { type: "string", description: "An HTS code from the candidate list" },
      description: "Non-empty list of HTS codes from the candidate set that informed this decision",
    },
    alternative_codes_considered: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          hts_code: { type: "string" },
          rejected_because: { type: "string" },
        },
        required: ["hts_code", "rejected_because"],
      },
    },
    missing_inputs_for_precision: {
      type: "array",
      items: { type: "string" },
      description:
        "Data not in the description that would tighten the 8-/10-digit pick (e.g. 'unit value in USD', 'exact material composition'). Empty array if nothing was missing.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    precision_level: {
      type: "string",
      enum: ["10", "8", "6"],
      description:
        "The level you are fully committed to: '10' = full 10-digit pick (default), '8' = committed at 8-digit and 10-digit suffix is best-effort, '6' = honest 6-digit fallback (hts_code MUST end '.00.00', hts_code_8 MUST end '.00', missing_inputs_for_precision MUST list the deciding attribute). See the 'Honest 6-digit fallback' section in the system prompt for when to use '6'.",
    },
    gri_rule_applied: {
      type: "string",
      enum: ["1", "2(a)", "2(b)", "3(a)", "3(b)", "3(c)", "4", "5(a)", "5(b)", "6"],
      description: "The GRI rule that decided this classification",
    },
    hts_code_8: {
      type: "string",
      description: "Same code truncated to 8 digits, dotted XXXX.XX.XX. When precision_level is '6', this ends in '.00'.",
      pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}$",
    },
    hts_code: {
      type: "string",
      description: "10-digit HTS code in dotted XXXX.XX.XX.XX form. Write this LAST, after the reasoning. It must be consistent with the code(s) you cited in `reasoning`. When precision_level is '6', this ends in '.00.00'.",
      pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$",
    },
  },
  required: [
    "reasoning",
    "citations",
    "alternative_codes_considered",
    "missing_inputs_for_precision",
    "confidence",
    "precision_level",
    "gri_rule_applied",
    "hts_code_8",
    "hts_code",
  ],
};

export interface LineItemDescription {
  description: string;
  quantity?: number;
  unit_value_usd?: number;
  country_of_origin?: string;
}

export interface CandidateMeta {
  htsCode: string;
  digitLevel: number;
  description: string;
  parentHeading: string | null;
  fullPath: string;
}

export interface ClassifyTrace {
  classificationId: string;
  promptVersion: string;
  model: string;
  candidates: Array<{ htsCode: string; score: number; description: string; fullPath: string }>;
  userMessage: string;
  attempts: Array<{
    attempt: number;
    rawToolInput: unknown;
    zodError: string | null;
    invalidCitations: string[];
    invalidHtsCode: boolean;
  }>;
  /** Non-null when the predicted hts_code's heading isn't referenced in reasoning text. */
  reasoning_consistency_warning: string | null;
  /** Set when the verifier ran (ENABLE_VERIFIER=1) regardless of outcome. */
  verifier?: {
    ran: boolean;
    agreed: boolean;
    original_hts_code: string;
    original_hts_code_8: string;
    original_confidence: "low" | "medium" | "high";
    revised_hts_code: string | null;
    revised_hts_code_8: string | null;
    revised_reasoning: string | null;
    verifier_reasoning: string;
    criteria_check: Array<{
      criterion: string;
      evidence_in_description: string;
      satisfied: boolean;
    }>;
    latency_ms: number;
  };
  result: ClassificationResultT;
}

/**
 * Heuristic check that the predicted hts_code is consistent with the reasoning
 * text. Extracts every HTS-code-shaped token from the reasoning (XXXX,
 * XXXX.XX, XXXX.XX.XX, XXXX.XX.XX.XX) and asserts the predicted 4-digit
 * heading appears among them. Returns null if consistent, else a warning
 * string. Heuristic only — never blocks the classification.
 */
/**
 * Best-effort extraction of the in-flight "reasoning" field value from a
 * partial JSON buffer streamed by Anthropic's tool_use input_json_delta
 * events. Returns the JSON-decoded prefix of reasoning's string value (no
 * trailing close-quote yet) or null if the field hasn't started.
 *
 * The TOOL_INPUT_SCHEMA orders properties with `reasoning` first, so the
 * model emits its reasoning before everything else and the field value
 * streams cleanly without other fields interleaved.
 */
function extractReasoningSoFar(partialJson: string): string | null {
  const key = '"reasoning"';
  const keyIdx = partialJson.indexOf(key);
  if (keyIdx < 0) return null;
  // Find the opening quote of the value after the colon.
  let i = keyIdx + key.length;
  while (i < partialJson.length && partialJson[i] !== '"') {
    if (partialJson[i] !== ' ' && partialJson[i] !== ':' && partialJson[i] !== '\t' && partialJson[i] !== '\n') {
      // Non-string value (unexpected for reasoning). Bail.
      return null;
    }
    i++;
  }
  if (i >= partialJson.length) return null;
  i++; // skip opening quote
  // Walk through escapes; collect decoded chars until end-of-buffer or unescaped close-quote.
  let out = "";
  while (i < partialJson.length) {
    const ch = partialJson[i];
    if (ch === "\\") {
      if (i + 1 >= partialJson.length) break; // incomplete escape — wait
      const esc = partialJson[i + 1];
      switch (esc) {
        case '"': out += '"'; break;
        case "\\": out += "\\"; break;
        case "/": out += "/"; break;
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "u":
          if (i + 6 > partialJson.length) return out; // incomplete \uXXXX
          out += String.fromCharCode(parseInt(partialJson.slice(i + 2, i + 6), 16));
          i += 4;
          break;
        default: out += esc;
      }
      i += 2;
    } else if (ch === '"') {
      // End of reasoning string.
      return out;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function checkReasoningConsistency(reasoning: string, predictedHtsCode: string): string | null {
  const codeRe = /\b\d{4}(?:\.\d{2}){0,3}\b/g;
  const mentioned = new Set<string>();
  for (const m of reasoning.matchAll(codeRe)) {
    mentioned.add(m[0]);
  }
  if (mentioned.size === 0) {
    return "reasoning text mentions no HTS codes — cannot verify consistency";
  }
  const predictedHeading = predictedHtsCode.slice(0, 4);
  for (const code of mentioned) {
    if (code.startsWith(predictedHeading)) return null;
  }
  return `predicted hts_code ${predictedHtsCode} (heading ${predictedHeading}) does not appear in reasoning; reasoning mentions: ${[...mentioned].slice(0, 8).join(", ")}`;
}

export interface ClassifyOptions {
  /**
   * Fired as the model streams the reasoning text. Each delta is the
   * NEW characters appended to the reasoning field since the previous
   * call. When set, the classifier uses Anthropic's streaming API and
   * parses the tool_use input JSON incrementally — `reasoning` is the
   * first field in the tool schema so its value streams first.
   * Errors thrown from the callback are caught and logged; they never
   * abort the classification.
   */
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export async function classify(
  ctx: AppContext,
  input: LineItemDescription,
  options: ClassifyOptions = {},
): Promise<{ result: ClassificationResultT; trace: ClassifyTrace }> {
  const classificationId = randomUUID();
  const model = ctx.config.defaultModel;

  // ── 1. Retrieve top-K candidates from the HTS vector store ─────────────
  const queryVec = await ctx.embeddings.embed(input.description);
  const matches = await ctx.htsIndex.query(queryVec, { topK: TOP_K });

  const candidates = matches.map<CandidateMeta & { score: number }>((m) => {
    const md = m.metadata as Partial<CandidateMeta>;
    return {
      score: m.score,
      htsCode: (md.htsCode ?? m.id) as string,
      digitLevel: Number(md.digitLevel ?? 0),
      description: (md.description ?? "") as string,
      parentHeading: (md.parentHeading ?? null) as string | null,
      fullPath: (md.fullPath ?? "") as string,
    };
  });

  const candidateCodes = new Set(candidates.map((c) => c.htsCode));

  // ── 2. Build the user message with the candidate list ──────────────────
  const userMessage = buildUserMessage(input, candidates);

  // ── 3. Call Claude with structured tool use; retry once on validation fail ─
  const trace: ClassifyTrace = {
    classificationId,
    promptVersion: CLASSIFIER_PROMPT_VERSION,
    model,
    candidates: candidates.map((c) => ({
      htsCode: c.htsCode,
      score: c.score,
      description: c.description,
      fullPath: c.fullPath,
    })),
    userMessage,
    attempts: [],
    reasoning_consistency_warning: null,
    result: null as unknown as ClassificationResultT, // filled below
  };

  let validatedResult: ClassificationResultT | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const reminderMessage =
      attempt === 1
        ? userMessage
        : userMessage +
          "\n\nIMPORTANT: your previous response failed validation. Cite ONLY HTS codes that appear verbatim in the candidate list above; the hts_code field must also be one of those candidates.";

    const createParams = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: CLASSIFIER_SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description: "Report the HTS classification with full GRI reasoning",
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool" as const, name: TOOL_NAME },
      messages: [{ role: "user" as const, content: reminderMessage }],
    };

    let response: Anthropic.Messages.Message;
    if (options.onReasoningDelta) {
      // Stream so we can fire reasoning_delta callbacks token-by-token.
      // tool_use's JSON streams in field order; reasoning is property #1
      // in TOOL_INPUT_SCHEMA so its value streams first.
      const stream = ctx.anthropic.messages.stream(createParams);
      let partialJson = "";
      let lastEmittedLen = 0;
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
        ) {
          partialJson += event.delta.partial_json;
          const next = extractReasoningSoFar(partialJson);
          if (next !== null && next.length > lastEmittedLen) {
            const delta = next.slice(lastEmittedLen);
            lastEmittedLen = next.length;
            try {
              await options.onReasoningDelta(delta);
            } catch (e) {
              // Caller's callback errored — log and continue. Don't abort the classify.
              console.warn(`[classifier] onReasoningDelta threw: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }
      response = await stream.finalMessage();
    } else {
      response = await ctx.anthropic.messages.create(createParams);
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      trace.attempts.push({
        attempt,
        rawToolInput: null,
        zodError: "no tool_use block in response",
        invalidCitations: [],
        invalidHtsCode: false,
      });
      continue;
    }

    const parsed = ClassificationOutput.safeParse(toolUse.input);
    if (!parsed.success) {
      trace.attempts.push({
        attempt,
        rawToolInput: toolUse.input,
        zodError: parsed.error.message,
        invalidCitations: [],
        invalidHtsCode: false,
      });
      continue;
    }

    const out = parsed.data;
    const invalidCitations = out.citations.filter((c) => !candidateCodes.has(c));
    const invalidHtsCode = !candidateCodes.has(out.hts_code);

    trace.attempts.push({
      attempt,
      rawToolInput: toolUse.input,
      zodError: null,
      invalidCitations,
      invalidHtsCode,
    });

    if (invalidCitations.length === 0 && !invalidHtsCode) {
      validatedResult = { ...out, validation_warning: null };
      break;
    }

    // If this was the last attempt, fall through with a warning attached.
    if (attempt === 2) {
      const warnings: string[] = [];
      if (invalidHtsCode) {
        warnings.push(`hts_code ${out.hts_code} not in retrieved candidates`);
      }
      if (invalidCitations.length > 0) {
        warnings.push(`citations not in retrieved candidates: ${invalidCitations.join(", ")}`);
      }
      validatedResult = { ...out, validation_warning: warnings.join("; ") };
    }
  }

  if (!validatedResult) {
    throw new Error(
      `classifier produced no valid response after 2 attempts (see audit_log id=${classificationId})`,
    );
  }

  // Result will be finalized after the optional verifier post-step below.
  trace.result = validatedResult;

  // ── 4. Heuristic reasoning-vs-prediction consistency check ─────────────
  // Catches cases like the v2 [39] wool scarf failure where the model's
  // reasoning identified 6117 but its hts_code field was 6214. Doesn't
  // block — just surfaces a warning we can act on later.
  const warning = checkReasoningConsistency(validatedResult.reasoning, validatedResult.hts_code);
  trace.reasoning_consistency_warning = warning;

  // ── 4b. Optional second-pass verifier (behind ENABLE_VERIFIER=1) ───────
  // Independent Claude call that re-reads the predicted code's HTS text
  // and checks whether every named criterion is supported by affirmative
  // evidence in the description. Disagreement triggers a revision +
  // confidence cap at "medium".
  if (process.env.ENABLE_VERIFIER === "1") {
    const original_hts_code = validatedResult.hts_code;
    const original_hts_code_8 = validatedResult.hts_code_8;
    const original_confidence = validatedResult.confidence;

    // Pass through every candidate chunk in the same 4-digit heading
    // family — that's the verifier's HTS context window. The retriever
    // already surfaced these; we don't add a new retrieval call.
    const predicted4 = original_hts_code.slice(0, 4); // "1234"
    const familyChunks = candidates
      .filter((c) => c.htsCode.startsWith(predicted4) || c.digitLevel === 0 || c.digitLevel === 2)
      .map((c) => ({ code: c.htsCode, level: c.digitLevel, text: c.description }));

    try {
      const { result: ver, trace: vtrace } = await verifyClassification(ctx, {
        description: input.description,
        predicted_hts_code: original_hts_code,
        predicted_hts_code_8: original_hts_code_8,
        hts_context: familyChunks,
      });

      if (!ver.agree && ver.revised_hts_code && ver.revised_hts_code_8) {
        // Revise. Cap confidence at medium (per the design — verifier
        // disagreement is signal that the original was overreaching).
        const cappedConfidence: "low" | "medium" | "high" =
          original_confidence === "high" ? "medium" : original_confidence;
        validatedResult = {
          ...validatedResult,
          hts_code: ver.revised_hts_code,
          hts_code_8: ver.revised_hts_code_8,
          confidence: cappedConfidence,
          reasoning: `${validatedResult.reasoning}\n\n[verifier revised ${original_hts_code} → ${ver.revised_hts_code}: ${ver.revised_reasoning}]`,
        };
      }

      trace.verifier = {
        ran: true,
        agreed: ver.agree,
        original_hts_code,
        original_hts_code_8,
        original_confidence,
        revised_hts_code: ver.revised_hts_code,
        revised_hts_code_8: ver.revised_hts_code_8,
        revised_reasoning: ver.revised_reasoning,
        verifier_reasoning: ver.verifier_reasoning,
        criteria_check: ver.criteria_check,
        latency_ms: vtrace.latency_ms,
      };
    } catch (err) {
      // Verifier failure is non-fatal — record and continue with the
      // classifier's original output.
      trace.verifier = {
        ran: true,
        agreed: false,
        original_hts_code,
        original_hts_code_8,
        original_confidence,
        revised_hts_code: null,
        revised_hts_code_8: null,
        revised_reasoning: null,
        verifier_reasoning: `verifier errored: ${err instanceof Error ? err.message : String(err)}`,
        criteria_check: [],
        latency_ms: 0,
      };
    }
  }

  // ── 5. Persist trace to audit_log ──────────────────────────────────────
  trace.result = validatedResult;
  await persistAuditLog(ctx, classificationId, model, trace);

  return { result: validatedResult, trace };
}

function buildUserMessage(input: LineItemDescription, candidates: Array<CandidateMeta & { score: number }>): string {
  const optBits: string[] = [];
  if (input.quantity !== undefined) optBits.push(`quantity: ${input.quantity}`);
  if (input.unit_value_usd !== undefined) optBits.push(`unit value: $${input.unit_value_usd.toFixed(2)}`);
  if (input.country_of_origin) optBits.push(`country of origin: ${input.country_of_origin}`);
  const optLine = optBits.length > 0 ? `\n(${optBits.join(", ")})` : "";

  const candidateLines = candidates
    .map((c, i) => `  ${String(i + 1).padStart(2)}. [${c.score.toFixed(3)}] ${c.htsCode}  —  ${c.description}`)
    .join("\n");

  return `Product description from the importer:
"""
${input.description.trim()}${optLine}
"""

Candidate HTS codes retrieved from the schedule (ranked by semantic similarity, most similar first). Cite only codes from this list:
${candidateLines}

Apply the GRI sequence and call the report_classification tool.`;
}

const TraceJsonShape = z.unknown(); // accept any payload; the column is opaque JSON

async function persistAuditLog(
  ctx: AppContext,
  classificationId: string,
  model: string,
  trace: ClassifyTrace,
): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const actor = `system:classifier@${model}#${CLASSIFIER_PROMPT_VERSION}`;
  const payload = JSON.stringify(TraceJsonShape.parse(trace));
  await ctx.db
    .prepare(
      "INSERT INTO audit_log (id, occurred_at, actor, entity_kind, entity_id, action, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, occurredAt, actor, "classification", classificationId, "classify", payload)
    .run();
}
