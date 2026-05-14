// CBP Form 7501 entry-summary parser.
//
// Converts a customs-entry PDF into a single HistoricalEntry that the PSC
// finder consumes. Mirrors the extractor's pattern (Claude Sonnet 4.5 with
// native PDF support + tool-use call), with a different schema and prompt.

import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppContext } from "@/core/app-context";
import {
  HistoricalEntry,
  type HistoricalEntryT,
} from "@/core/schemas/refund";
import {
  ENTRY_SUMMARY_PROMPT_VERSION,
  ENTRY_SUMMARY_SYSTEM_PROMPT,
} from "./prompts/entry-summary-system";

const TOOL_NAME = "report_entry_summary";
const MAX_OUTPUT_TOKENS = 8192;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    entry_number: { type: "string" },
    entry_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    port_of_entry: { type: "string" },
    country_of_origin: { type: "string", pattern: "^[A-Z]{2}$" },
    mode_of_transport: {
      type: ["string", "null"],
      enum: ["ocean", "air", "ground", "other", null],
      description: "Mode of transport from Box 24 ('Mode of Transportation Code') on Form 7501. Common codes: 10/11 = Vessel/ocean, 40/41 = Air, 30/31 = Truck/ground, 60 = Mail. Map to one of: ocean, air, ground, other. Null if not on the form.",
    },
    importer: { type: "string" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 },
          unit_value_usd_cents: { type: "integer", minimum: 0 },
          total_value_usd_cents: { type: "integer", minimum: 0 },
          hts_code_as_filed: { type: "string" },
          duty_paid_usd_cents: { type: "integer", minimum: 0 },
        },
        required: [
          "description",
          "quantity",
          "unit_value_usd_cents",
          "total_value_usd_cents",
          "hts_code_as_filed",
          "duty_paid_usd_cents",
        ],
      },
      minItems: 1,
    },
  },
  required: [
    "entry_number",
    "entry_date",
    "port_of_entry",
    "country_of_origin",
    "importer",
    "line_items",
  ],
};

export interface EntrySummaryParseResult {
  entry: HistoricalEntryT;
  /** Importer name pulled from the form — used as HistoricalEntries.importer when no other source. */
  importer: string;
}

export interface EntrySummaryTrace {
  parseId: string;
  promptVersion: string;
  model: string;
  documentPath: string;
  documentBytes: number;
  rawToolInput: unknown;
  result: EntrySummaryParseResult;
}

export async function parseEntrySummary(
  ctx: AppContext,
  documentPath: string,
): Promise<{ result: EntrySummaryParseResult; trace: EntrySummaryTrace }> {
  const parseId = randomUUID();
  const model = ctx.config.defaultModel;
  const absPath = path.resolve(documentPath);
  const bytes = await fs.readFile(absPath);
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== ".pdf") {
    throw new Error(`entry-summary parser only accepts PDFs (got ${ext})`);
  }

  const documentBlock: Anthropic.Messages.DocumentBlockParam = {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: bytes.toString("base64"),
    },
  };

  const userMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: [
      documentBlock,
      {
        type: "text" as const,
        text: "Extract this CBP entry record into the structured shape required by the report_entry_summary tool. Preserve every line item's description verbatim. Apply the rules in the system prompt.",
      },
    ],
  };

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: ENTRY_SUMMARY_SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report the structured contents of a CBP entry summary",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [userMessage],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("entry-summary parser: model produced no tool_use block");
  }

  // Pull importer + entry separately because HistoricalEntries.importer lives
  // at the wrapper level, not inside HistoricalEntry.
  const raw = toolUse.input as { importer?: unknown } & Record<string, unknown>;
  const importer =
    typeof raw.importer === "string" && raw.importer.trim().length > 0
      ? raw.importer.trim()
      : "Unknown importer";

  const parsed = HistoricalEntry.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `entry-summary parser: tool output failed Zod validation: ${parsed.error.message}`,
    );
  }
  const entry = parsed.data;

  // Sanity: line totals should sum to something. We don't have a single
  // entered-value box on the schema (it's per line), so skip reconciliation.
  if (entry.line_items.length === 0) {
    throw new Error("entry-summary parser: no line items on the form");
  }

  const result: EntrySummaryParseResult = { entry, importer };

  const trace: EntrySummaryTrace = {
    parseId,
    promptVersion: ENTRY_SUMMARY_PROMPT_VERSION,
    model,
    documentPath: absPath,
    documentBytes: bytes.byteLength,
    rawToolInput: toolUse.input,
    result,
  };

  await persistAuditLog(ctx, parseId, model, trace);
  return { result, trace };
}

async function persistAuditLog(
  ctx: AppContext,
  parseId: string,
  model: string,
  trace: EntrySummaryTrace,
): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const actor = `system:entry-summary-parser@${model}#${ENTRY_SUMMARY_PROMPT_VERSION}`;
  const payload = JSON.stringify(trace);
  await ctx.db
    .prepare(
      "INSERT INTO audit_log (id, occurred_at, actor, entity_kind, entity_id, action, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, occurredAt, actor, "entry_summary", parseId, "parse", payload)
    .run();
}
