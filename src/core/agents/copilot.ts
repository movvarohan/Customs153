// Conversational customs copilot — a tool-using agent over the whole system.
//
// The user chats in natural language; the model MUST use tools for any HTS
// code, duty figure, or ruling (it can't state one from memory), so every
// concrete claim is grounded in the same agents the rest of the product
// uses. The tool-use loop runs server-side and streams to the chat UI:
//   { type: "text_delta", delta }        assistant prose, token by token
//   { type: "tool_call", name, input }   the model decided to call a tool
//   { type: "tool_result", name, summary } the tool's result (one line)
//   { type: "done" }                      turn complete
//
// Tools wrap existing agents: classify_product, calculate_duty,
// tariff_engineering, search_cross_rulings.

import type Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import type { AppContext } from "@/core/app-context";
import { classify } from "./classifier";
import { calculateDuty } from "./duty-calculator";
import { generateCounterfactuals } from "./counterfactual";

export const COPILOT_PROMPT_VERSION = "v1-2026-05-29";
const MAX_TOOL_ROUNDS = 6;
const MAX_OUTPUT_TOKENS = 1500;
const AGENT = new https.Agent({ rejectUnauthorized: false });

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export type CopilotEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SYSTEM_PROMPT = `You are the customs copilot for a US importer — a licensed-broker-grade assistant for HTS classification, landed-duty calculation, and tariff strategy.

Hard rules:
- You may NOT state an HTS code, a duty amount, or a CBP ruling from memory. Use the tools. If a user asks "what's the code for X," call classify_product. If they ask "how much duty," call calculate_duty. If they ask how to pay less, call tariff_engineering. To ground a code in CBP precedent, call search_cross_rulings.
- Chain tools when needed: classify first to get a code, then price or engineer from it.
- After the tools return, explain the result in plain English, citing the HTS code, the GRI rule, and any CBP ruling numbers the tools surfaced. Be concise — a few sentences.
- You are not a licensed broker; a licensed broker reviews and files. Say so if the user asks about filing.

Default assumptions when the user doesn't specify: country of origin China (CN), a representative customs value if needed for duty (state the assumption). Keep responses tight and useful.`;

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "classify_product",
    description: "Classify a product description to a 10-digit HTS code with GRI reasoning and cited sources.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The product as a seller would describe it" },
        country_of_origin: { type: "string", description: "ISO-2 or country name; defaults to CN" },
      },
      required: ["description"],
    },
  },
  {
    name: "calculate_duty",
    description: "Compute total landed duty (base + Section 301 + Section 232 + MPF + HMF) for a classified line.",
    input_schema: {
      type: "object",
      properties: {
        hts_code_8: { type: "string", description: "8-digit HTS, dotted XXXX.XX.XX" },
        country_of_origin: { type: "string", description: "ISO-2 or country name" },
        customs_value_usd: { type: "number", description: "Customs value of the line in US dollars" },
      },
      required: ["hts_code_8", "country_of_origin", "customs_value_usd"],
    },
  },
  {
    name: "tariff_engineering",
    description: "Propose legal ways to reduce duty (sourcing, material, structure, FTA) with each option's duty impact.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        hts_code_8: { type: "string" },
        country_of_origin: { type: "string" },
        customs_value_usd: { type: "number" },
      },
      required: ["description", "hts_code_8", "country_of_origin", "customs_value_usd"],
    },
  },
  {
    name: "search_cross_rulings",
    description: "Search CBP's CROSS binding-rulings database for rulings on a product, returning ruling numbers and the codes they assigned.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

function iso2(s: string): string {
  const m: Record<string, string> = { china: "CN", vietnam: "VN", india: "IN", mexico: "MX", "united states": "US", usa: "US" };
  const k = s.trim().toLowerCase();
  return m[k] ?? (s.length === 2 ? s.toUpperCase() : s);
}

async function crossSearch(query: string): Promise<string> {
  const url = `https://rulings.cbp.gov/api/search?term=${encodeURIComponent(query)}&collection=ALL&pageSize=6`;
  const json = await new Promise<{ rulings?: Array<{ rulingNumber: string; tariffs: string[]; subject: string }> }>((resolve, reject) => {
    const req = https.get(url, { agent: AGENT, timeout: 12000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("CROSS timeout")));
  });
  const rulings = (json.rulings ?? []).slice(0, 6);
  if (rulings.length === 0) return "No CROSS rulings found.";
  return rulings.map((r) => `${r.rulingNumber} [${r.tariffs.slice(0, 3).join(", ")}] ${r.subject.slice(0, 70)}`).join("\n");
}

async function runTool(ctx: AppContext, name: string, input: Record<string, unknown>): Promise<{ resultText: string; summary: string }> {
  if (name === "classify_product") {
    const { result } = await classify(ctx, {
      description: String(input.description),
      ...(input.country_of_origin ? { country_of_origin: iso2(String(input.country_of_origin)) } : {}),
    });
    return {
      resultText: `HTS ${result.hts_code} (8-digit ${result.hts_code_8}), confidence ${result.confidence}, GRI ${result.gri_rule_applied}. Citations: ${result.citations.join(", ")}. Reasoning: ${result.reasoning}`,
      summary: `${result.hts_code_8} · ${result.confidence}`,
    };
  }
  if (name === "calculate_duty") {
    const cents = Math.round(Number(input.customs_value_usd) * 100);
    const d = await calculateDuty(ctx, {
      hts_code: String(input.hts_code_8),
      country_of_origin: iso2(String(input.country_of_origin)),
      customs_value_usd_cents: cents,
      transport_mode: "ocean",
    });
    const parts = d.components.map((c) => `${c.kind}=${(c.amount_usd_cents / 100).toFixed(2)}`).join(", ");
    return {
      resultText: `Total landed duty $${(d.total_duty_usd_cents / 100).toFixed(2)} on $${(cents / 100).toFixed(2)} value. Components: ${parts}.`,
      summary: `$${(d.total_duty_usd_cents / 100).toFixed(2)} landed duty`,
    };
  }
  if (name === "tariff_engineering") {
    const cents = Math.round(Number(input.customs_value_usd) * 100);
    const filed = await calculateDuty(ctx, { hts_code: String(input.hts_code_8), country_of_origin: iso2(String(input.country_of_origin)), customs_value_usd_cents: cents, transport_mode: "ocean", include_entry_fees: false });
    const cf = await generateCounterfactuals(ctx, {
      description: String(input.description),
      filed_hts_code_8: String(input.hts_code_8),
      filed_country_iso2: iso2(String(input.country_of_origin)),
      customs_value_usd_cents: cents,
      filed_total_duty_usd_cents: filed.total_duty_usd_cents,
    });
    const top = cf.scenarios.slice(0, 4).map((s) => `${s.label} (${s.kind}): save $${(s.savings_usd_cents / 100).toFixed(2)} — ${s.reasoning}`).join("\n");
    return { resultText: `Scenarios:\n${top}`, summary: `${cf.scenarios.length} options, best saves $${((cf.scenarios[0]?.savings_usd_cents ?? 0) / 100).toFixed(2)}` };
  }
  if (name === "search_cross_rulings") {
    const text = await crossSearch(String(input.query));
    return { resultText: text, summary: `${text.split("\n").length} rulings` };
  }
  return { resultText: `Unknown tool ${name}`, summary: "error" };
}

export async function runCopilot(
  ctx: AppContext,
  history: CopilotMessage[],
  onEvent: (e: CopilotEvent) => void | Promise<void>,
): Promise<void> {
  const messages: Anthropic.Messages.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const streamResp = ctx.anthropic.messages.stream({
        model: ctx.config.defaultModel,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
      for await (const ev of streamResp) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          await onEvent({ type: "text_delta", delta: ev.delta.text });
        }
      }
      const msg = await streamResp.finalMessage();
      const toolUses = msg.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");

      if (toolUses.length === 0) {
        await onEvent({ type: "done" });
        return;
      }

      messages.push({ role: "assistant", content: msg.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        await onEvent({ type: "tool_call", name: tu.name, input });
        try {
          const { resultText, summary } = await runTool(ctx, tu.name, input);
          await onEvent({ type: "tool_result", name: tu.name, summary });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
        } catch (e) {
          const msgText = e instanceof Error ? e.message : String(e);
          await onEvent({ type: "tool_result", name: tu.name, summary: `error: ${msgText}` });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Tool error: ${msgText}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
    await onEvent({ type: "done" });
  } catch (e) {
    await onEvent({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
