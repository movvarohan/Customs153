// Document extraction agent.
//
// Flow:
//   1. Read the document bytes (PDF or image).
//   2. Send to Claude Sonnet 4.5 via a tool-use call:
//        - PDFs: native PDF support via `type: "document"` content block.
//        - Images: `type: "image"` content block (PNG/JPEG/GIF/WebP).
//   3. Validate the structured output against ExtractedShipment.
//   4. Sanity-check that line_item totals sum to the document total within
//      $0.01 in invoice currency. Mismatch → reconciliation_warning,
//      never a hard fail.
//   5. If the invoice currency isn't USD, look up an FX rate from
//      ctx.cache (key "fx:rate:<CURRENCY>") and compute USD-cent totals.
//   6. Persist the full trace (document path, model response, validation)
//      to audit_log.

import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppContext } from "@/core/app-context";
import {
  ExtractedShipment,
  type ExtractedShipmentT,
  type ExtractionResultT,
} from "@/core/schemas/extraction";
import {
  EXTRACTOR_PROMPT_VERSION,
  EXTRACTOR_SYSTEM_PROMPT,
} from "./prompts/extractor-system";

const TOOL_NAME = "report_extraction";
const MAX_OUTPUT_TOKENS = 8192;
/** Hard cap. Multi-page docs over this go through chunk-and-merge. */
const MAX_PDF_PAGES_PER_CALL = 10;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    document_kind: {
      type: "string",
      enum: [
        "commercial_invoice",
        "packing_list",
        "bill_of_lading",
        "mill_test_certificate",
        "isf_data",
        "unknown",
      ],
    },
    vendor: { type: "string" },
    invoice_number: { type: "string" },
    invoice_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    consignee: { type: ["string", "null"] },
    country_of_origin: { type: ["string", "null"] },
    mode_of_transport: {
      type: ["string", "null"],
      enum: ["ocean", "air", "ground", "other", null],
      description: "Mode of transport — ocean / air / ground / other. Drives whether HMF applies. Null if not on the document.",
    },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    total_value: {
      type: "integer",
      minimum: 0,
      description: "Document grand total in invoice currency, integer cents.",
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Seller's verbatim line description, not normalized." },
          quantity: { type: "number", exclusiveMinimum: 0 },
          unit_value: { type: "integer", minimum: 0, description: "Unit price in invoice currency, integer cents." },
          total_value: { type: "integer", minimum: 0, description: "Row extended total in invoice currency, integer cents." },
          country_of_origin: { type: ["string", "null"] },
          hts_code_from_invoice: { type: ["string", "null"] },
          material_composition: { type: ["string", "null"] },
          model_number: { type: ["string", "null"] },
        },
        required: [
          "description",
          "quantity",
          "unit_value",
          "total_value",
          "country_of_origin",
          "hts_code_from_invoice",
          "material_composition",
          "model_number",
        ],
      },
    },
    requires_clarification: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line_index: { type: "integer", minimum: 0 },
          reason: { type: "string" },
        },
        required: ["line_index", "reason"],
      },
    },
  },
  required: [
    "document_kind",
    "vendor",
    "invoice_number",
    "invoice_date",
    "consignee",
    "country_of_origin",
    "currency",
    "total_value",
    "line_items",
    "requires_clarification",
  ],
};

export interface ExtractTrace {
  extractionId: string;
  promptVersion: string;
  model: string;
  /** All documents that were merged into this single shipment. */
  documentPaths: string[];
  documentBytesTotal: number;
  rawToolInput: unknown;
  result: ExtractionResultT;
}

/** Reconciliation tolerance in invoice currency cents (= $0.01). */
const RECON_TOLERANCE_CENTS = 1;

export async function extract(
  ctx: AppContext,
  documentPaths: string | string[],
): Promise<{ result: ExtractionResultT; trace: ExtractTrace }> {
  const paths = Array.isArray(documentPaths) ? documentPaths : [documentPaths];
  if (paths.length === 0) {
    throw new Error("extractor: at least one document path is required");
  }
  const extractionId = randomUUID();
  const model = ctx.config.defaultModel;

  const docs = await Promise.all(
    paths.map(async (p) => {
      const absPath = path.resolve(p);
      const bytes = await fs.readFile(absPath);
      const ext = path.extname(absPath).toLowerCase();
      const isPdf = ext === ".pdf";
      const block = isPdf ? buildPdfBlock(bytes) : buildImageBlock(bytes, ext);
      return { absPath, bytes, ext, isPdf, block };
    }),
  );

  if (docs.some((d) => d.isPdf)) {
    // Sonnet accepts up to MAX_PDF_PAGES_PER_CALL pages per document content
    // block. Larger PDFs go through chunk-and-merge; we leave that as a TODO
    // and the SDK / model will surface a "too many pages" error if exceeded.
    void MAX_PDF_PAGES_PER_CALL;
  }

  const promptText =
    docs.length === 1
      ? "Extract this customs document into the structured shape required by the report_extraction tool. Preserve every line item's seller description verbatim. Apply the rules in the system prompt; flag vague descriptions in requires_clarification."
      : `${docs.length} documents are attached. They describe the SAME shipment. Merge them into ONE ExtractedShipment per the rules in the system prompt: invoice for monetary fields, packing list for country_of_origin and material_composition, mill test certificate for steel/aluminum material details. Cross-reference line items by description + model + quantity. Output a SINGLE record via report_extraction.`;

  const userMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: [
      ...docs.map((d) => d.block),
      { type: "text" as const, text: promptText },
    ],
  };

  const response = await ctx.anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: EXTRACTOR_SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Report the structured contents of a customs document",
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
    throw new Error("extractor: model produced no tool_use block");
  }
  const parsed = ExtractedShipment.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`extractor: tool output failed Zod validation: ${parsed.error.message}`);
  }
  const shipment = parsed.data;

  // ── Reconciliation: line items vs document total in invoice currency ───
  const sumLineCents = shipment.line_items.reduce((a, b) => a + b.total_value, 0);
  const recon: string | null =
    Math.abs(sumLineCents - shipment.total_value) <= RECON_TOLERANCE_CENTS
      ? null
      : `line items sum to ${sumLineCents} ${shipment.currency} cents; document total is ${shipment.total_value} ${shipment.currency} cents (diff ${sumLineCents - shipment.total_value})`;

  // ── Currency conversion ────────────────────────────────────────────────
  let fxRate: number | null = null;
  let totalUsdCents: number | null = null;
  if (shipment.currency === "USD") {
    fxRate = 1;
    totalUsdCents = shipment.total_value;
  } else {
    const rate = await ctx.cache.get<number>(`fx:rate:${shipment.currency}`);
    if (typeof rate === "number" && rate > 0) {
      fxRate = rate;
      totalUsdCents = Math.round(shipment.total_value * rate);
    }
  }

  const result: ExtractionResultT = {
    ...shipment,
    reconciliation_warning: recon,
    total_value_usd_cents: totalUsdCents,
    fx_rate_used: fxRate,
  };

  const trace: ExtractTrace = {
    extractionId,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    model,
    documentPaths: docs.map((d) => d.absPath),
    documentBytesTotal: docs.reduce((a, d) => a + d.bytes.byteLength, 0),
    rawToolInput: toolUse.input,
    result,
  };

  await persistAuditLog(ctx, extractionId, model, trace);
  return { result, trace };
}

function buildPdfBlock(bytes: Buffer): Anthropic.Messages.DocumentBlockParam {
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: bytes.toString("base64"),
    },
  };
}

function buildImageBlock(bytes: Buffer, ext: string): Anthropic.Messages.ImageBlockParam {
  const mediaType = (() => {
    switch (ext) {
      case ".png":
        return "image/png" as const;
      case ".jpg":
      case ".jpeg":
        return "image/jpeg" as const;
      case ".gif":
        return "image/gif" as const;
      case ".webp":
        return "image/webp" as const;
      default:
        throw new Error(`extractor: unsupported image extension ${ext}`);
    }
  })();
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: bytes.toString("base64"),
    },
  };
}

async function persistAuditLog(
  ctx: AppContext,
  extractionId: string,
  model: string,
  trace: ExtractTrace,
): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const actor = `system:extractor@${model}#${EXTRACTOR_PROMPT_VERSION}`;
  const payload = JSON.stringify(trace);
  await ctx.db
    .prepare(
      "INSERT INTO audit_log (id, occurred_at, actor, entity_kind, entity_id, action, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, occurredAt, actor, "extraction", extractionId, "extract", payload)
    .run();
}
