// CROSS-grounded verifier.
//
// Different from the in-tree verifier (src/core/agents/verifier.ts) which
// only re-reads the HTS text the classifier already saw. This one queries
// the actual CBP CROSS rulings database — the same database CBP's own
// auditors use — for rulings on (a) the predicted code and (b) rulings on
// articles materially similar to the product description. Those ruling
// texts are then fed to Claude as external evidence: does the predicted
// code align with how CBP has actually classified materially similar
// articles in binding rulings? If not, what code DO the rulings support?
//
// This brings new information into the loop — exactly what the prior
// "re-read same HTS text" verifier couldn't do. The CROSS API is hit via
// curl-equivalent fetch with TLS validation disabled because the sandbox
// has clock skew; production would use a normal client.

import type Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";

const TOOL_NAME = "report_cross_verification";
const MAX_OUTPUT_TOKENS = 4096;
export const CROSS_VERIFIER_PROMPT_VERSION = "v1-2026-05-29";

const CROSS_BASE = "https://rulings.cbp.gov/api";
// Allow self-signed / clock-skewed certs; the sandbox's date drift breaks
// strict TLS but the API is public and read-only.
const AGENT = new https.Agent({ rejectUnauthorized: false });

export const CrossVerifierOutput = z.object({
  /** True if the rulings clearly support the predicted code (or a 10-digit child of it). */
  agrees_with_predicted: z.boolean(),
  /**
   * If !agrees, what code does the ruling evidence support? Same shape as the
   * classifier's hts_code (dotted 10-digit). Null if the rulings are mixed /
   * inconclusive.
   */
  suggested_hts_code: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/).nullable(),
  /** Confidence we have in the verdict, grounded in how many rulings agree. */
  confidence: z.enum(["low", "medium", "high"]),
  /** 2-4 sentences. Must cite specific ruling numbers from the input. */
  reasoning: z.string().min(20),
  /** Ruling-by-ruling annotations the verifier relied on. */
  evidence: z.array(
    z.object({
      ruling_number: z.string(),
      product: z.string(),
      assigned_code: z.string(),
      relevance: z.string(),
    }),
  ),
});
export type CrossVerifierOutputT = z.infer<typeof CrossVerifierOutput>;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    agrees_with_predicted: { type: "boolean" },
    suggested_hts_code: {
      type: ["string", "null"],
      pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$",
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reasoning: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruling_number: { type: "string" },
          product: { type: "string" },
          assigned_code: { type: "string" },
          relevance: { type: "string" },
        },
        required: ["ruling_number", "product", "assigned_code", "relevance"],
      },
    },
  },
  required: ["agrees_with_predicted", "suggested_hts_code", "confidence", "reasoning", "evidence"],
};

interface CrossSearchHit {
  rulingNumber: string;
  rulingDate: string;
  subject: string;
  tariffs: string[];
}

async function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: AGENT, timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

async function crossSearch(term: string, pageSize = 12): Promise<CrossSearchHit[]> {
  const url = `${CROSS_BASE}/search?term=${encodeURIComponent(term)}&collection=ALL&pageSize=${pageSize}`;
  const d = (await fetchJson(url)) as { rulings?: CrossSearchHit[] };
  return d.rulings ?? [];
}

async function crossRulingText(num: string): Promise<string> {
  const url = `${CROSS_BASE}/ruling/${encodeURIComponent(num)}`;
  try {
    const d = (await fetchJson(url)) as { text?: string };
    return (d.text ?? "").slice(0, 2500);
  } catch {
    return "";
  }
}

export interface CrossVerifierInput {
  description: string;
  predicted_hts_code: string;
  predicted_hts_code_8: string;
}

export interface CrossVerifierResult {
  promptVersion: string;
  model: string;
  input: CrossVerifierInput;
  cross_search: {
    by_description: CrossSearchHit[];
    by_predicted_code: CrossSearchHit[];
  };
  rulings_consulted: Array<{ number: string; snippet: string }>;
  defense: CrossVerifierOutputT;
}

const SYSTEM_PROMPT = `You are a CROSS-grounded verifier for US customs HTS classifications. A first-pass classifier picked an HTS code; your job is to compare that pick against actual CBP binding rulings.

You will receive:
  - The seller's product description.
  - The predicted 10-digit code and its 8-digit prefix.
  - Two lists of rulings from rulings.cbp.gov:
      (a) rulings on materially-similar products (semantic search by description)
      (b) rulings that assigned the predicted 8-digit code (or a 10-digit child)
  - For up to ~8 of those rulings, the first ~2,500 characters of the ruling text.

Decide:
  1. **agrees_with_predicted**: do the relevant rulings (those on materially similar products) consistently agree with the predicted 8-digit code (or a 10-digit child)?
     - "Materially similar" means the article in the ruling could plausibly be the same product type as the importer's description.
     - Ignore rulings clearly on different products (a "phone" ruling isn't materially similar to a "cable").
  2. If !agrees, **suggested_hts_code**: what 10-digit code do the materially-similar rulings actually use? Use dotted form (XXXX.XX.XX.XX). If rulings split, set null.
  3. **confidence**:
     - high: 3+ materially-similar rulings all agree (with predicted or with a different code)
     - medium: 1-2 materially-similar rulings, or 3+ with some disagreement
     - low: rulings exist but materially-similar coverage is weak
  4. **reasoning**: 2-4 sentences citing specific ruling numbers (e.g. "N262709 classified a stoneware ceramic mug at 6912.00.4400; D83458 used the same line for a ceramic mug.").
  5. **evidence**: for each ruling you actually relied on (positively or as a counter), include {ruling_number, product, assigned_code, relevance}. Skip rulings you discarded as not materially similar.

Do NOT:
  - Invent rulings or codes not in the input.
  - Mark agrees=true if the materially-similar rulings clearly use a different code.
  - Mark agrees=false based on rulings for different product types.

Be honest: a "low-confidence agrees" is more useful than a confident wrong answer. Call the \`report_cross_verification\` tool.`;

export async function verifyAgainstCross(
  ctx: AppContext,
  input: CrossVerifierInput,
): Promise<CrossVerifierResult> {
  const model = ctx.config.defaultModel;

  // 1. Hit CROSS twice — by description (semantic), by predicted 8-digit (exact code).
  const [byDesc, byCode] = await Promise.all([
    crossSearch(input.description, 12),
    crossSearch(input.predicted_hts_code_8, 8),
  ]);
  // Dedupe by ruling number; prefer "by description" first.
  const seen = new Set<string>();
  const merged: CrossSearchHit[] = [];
  for (const r of [...byDesc, ...byCode]) {
    if (seen.has(r.rulingNumber)) continue;
    seen.add(r.rulingNumber);
    merged.push(r);
  }
  // Fetch text for the top ~8 most-relevant rulings (mix of both lists).
  const fetchTargets = merged.slice(0, 8);
  const rulings = await Promise.all(
    fetchTargets.map(async (r) => ({
      number: r.rulingNumber,
      snippet: await crossRulingText(r.rulingNumber),
    })),
  );

  const summaryBlock = merged
    .slice(0, 18)
    .map(
      (r) =>
        `  ${r.rulingNumber.padEnd(10)} ${r.rulingDate.slice(0, 10)} tariffs=[${r.tariffs
          .slice(0, 4)
          .join(", ")}]  ${r.subject.slice(0, 90)}`,
    )
    .join("\n");

  const rulingsBlock = rulings
    .filter((r) => r.snippet.length > 0)
    .map((r) => `=== ${r.number} ===\n${r.snippet}\n`)
    .join("\n");

  const userMessage = `Product description from the importer:
"""${input.description}"""

Predicted classification: ${input.predicted_hts_code} (8-digit: ${input.predicted_hts_code_8})

CBP CROSS rulings — search summary (by description first, then by predicted code, deduped):
${summaryBlock || "  (no hits)"}

Top ruling texts (truncated to 2500 chars each):

${rulingsBlock || "(no fetchable ruling texts)"}

Apply the verification procedure. Be honest. Call the tool.`;

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report the CROSS-grounded verification outcome",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("cross-verifier: model produced no tool_use block");
  const parsed = CrossVerifierOutput.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`cross-verifier: tool output failed Zod validation: ${parsed.error.message}`);
  }
  return {
    promptVersion: CROSS_VERIFIER_PROMPT_VERSION,
    model,
    input,
    cross_search: { by_description: byDesc, by_predicted_code: byCode },
    rulings_consulted: rulings,
    defense: parsed.data,
  };
}
