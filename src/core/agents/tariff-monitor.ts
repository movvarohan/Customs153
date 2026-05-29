// Federal Register / tariff watcher.
//
// Fetches recent Federal Register documents matching customs-relevant
// agencies and keywords (CBP, USTR, USITC, ITA — Section 301, 232,
// Reciprocal Tariffs, Section 201, USMCA, exclusions). For each
// document, asks Claude to extract: which HTS codes are affected,
// which countries, what changed (rate up, rate down, exclusion granted,
// exclusion expired, new investigation, etc.), and the financial
// direction for an importer. Cross-references the per-customer SKU
// memory and surfaces affected products.
//
// On-demand fetch in this demo (no background scheduler); in production
// this is a cron-like loop hitting the same API.

import type Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { listSkuMemory } from "@/core/lib/sku-memory";

const TOOL_NAME = "report_fr_impact";
const MAX_OUTPUT_TOKENS = 2048;
export const TARIFF_MONITOR_PROMPT_VERSION = "v1-2026-05-29";

const AGENT = new https.Agent({ rejectUnauthorized: false });
const FR_API_BASE = "https://www.federalregister.gov/api/v1";

const RELEVANT_AGENCIES = [
  "u-s-customs-and-border-protection",
  "trade-representative-office-of-united-states",
  "international-trade-administration",
  "international-trade-commission",
];

// Note: we don't add a `conditions[term]` filter — the FR search treats
// multiple terms as AND, which over-restricts. Filtering by the four
// trade-relevant agencies is already a strong signal.

interface FrDocument {
  document_number: string;
  title: string;
  abstract: string | null;
  agencies: Array<{ name: string; slug?: string }>;
  publication_date: string;
  html_url: string;
  type: string;
}

export const FrImpactOutput = z.object({
  category: z.enum([
    "section_301_change",
    "section_232_change",
    "exclusion_granted",
    "exclusion_expired",
    "rate_change_other",
    "new_investigation",
    "procedural_only",
    "other",
  ]),
  direction: z.enum(["duty_up", "duty_down", "neutral", "uncertain"]),
  affected_hts_codes_8: z.array(z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/)),
  affected_countries_iso2: z.array(z.string().regex(/^[A-Z]{2}$/)),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  broker_summary: z.string().min(20),
});
export type FrImpactOutputT = z.infer<typeof FrImpactOutput>;

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    category: {
      type: "string",
      enum: [
        "section_301_change",
        "section_232_change",
        "exclusion_granted",
        "exclusion_expired",
        "rate_change_other",
        "new_investigation",
        "procedural_only",
        "other",
      ],
    },
    direction: { type: "string", enum: ["duty_up", "duty_down", "neutral", "uncertain"] },
    affected_hts_codes_8: {
      type: "array",
      items: { type: "string", pattern: "^\\d{4}\\.\\d{2}\\.\\d{2}$" },
    },
    affected_countries_iso2: {
      type: "array",
      items: { type: "string", pattern: "^[A-Z]{2}$" },
    },
    effective_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    broker_summary: { type: "string" },
  },
  required: [
    "category",
    "direction",
    "affected_hts_codes_8",
    "affected_countries_iso2",
    "effective_date",
    "broker_summary",
  ],
};

const SYSTEM_PROMPT = `You read Federal Register documents and extract their importer-relevant impact.

You will be given a document's title, abstract, agencies, and type. Extract:

  - category: which CBP-relevant bucket the action falls in.
  - direction: for the average US importer affected, does this raise or lower their duty bill?
  - affected_hts_codes_8: every 8-digit HTS code the document mentions or affects. ALWAYS dotted XXXX.XX.XX. If the document covers an entire chapter without naming specific 8-digit lines, leave empty and explain in broker_summary.
  - affected_countries_iso2: every country the action applies to, in ISO-3166-1 alpha-2 (CN, VN, etc.). Empty if global.
  - effective_date: the stated effective date. Null if only proposed; null if no date is stated in the abstract.
  - broker_summary: 1-2 sentences a broker would say to their importer client, naming the action and the financial direction.

Do NOT invent HTS codes or countries. If the abstract is procedural / non-substantive (e.g. a meeting notice), use category=procedural_only and direction=neutral. Call the \`report_fr_impact\` tool.`;

async function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { agent: AGENT, timeout: 15_000, headers: { "user-agent": "customs-agent/0.1" } },
      (res) => {
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
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("FR timeout")));
  });
}

export async function fetchRecentFrDocuments(opts: { perPage?: number; daysBack?: number } = {}): Promise<FrDocument[]> {
  const perPage = opts.perPage ?? 12;
  const daysBack = opts.daysBack ?? 60;
  const since = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const url =
    `${FR_API_BASE}/documents.json?per_page=${perPage}` +
    `&order=newest` +
    `&conditions%5Bpublication_date%5D%5Bgte%5D=${since}` +
    RELEVANT_AGENCIES.map((a) => `&conditions%5Bagencies%5D%5B%5D=${encodeURIComponent(a)}`).join("") +
    `&fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=abstract&fields%5B%5D=agencies&fields%5B%5D=publication_date&fields%5B%5D=html_url&fields%5B%5D=type`;
  const j = (await fetchJson(url)) as { results?: FrDocument[] };
  return j.results ?? [];
}

export async function analyzeFrDocument(
  ctx: AppContext,
  doc: FrDocument,
): Promise<FrImpactOutputT> {
  const userMessage = `Federal Register document:
Title: ${doc.title}
Publication date: ${doc.publication_date}
Agencies: ${doc.agencies.map((a) => a.name).join(", ")}
Type: ${doc.type}
Document number: ${doc.document_number}

Abstract:
${doc.abstract ?? "(no abstract published)"}

Extract impact. Call the tool.`;

  const response = await ctx.anthropic.messages.create({
    model: ctx.config.defaultModel,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "Report the FR document's importer impact", input_schema: TOOL_INPUT_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });
  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("tariff-monitor: no tool_use block");
  const parsed = FrImpactOutput.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`tariff-monitor: tool output failed Zod validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface TariffWatchResult {
  promptVersion: string;
  fetched_at: string;
  documents: Array<{
    document_number: string;
    title: string;
    abstract: string | null;
    publication_date: string;
    html_url: string;
    agencies: string[];
    impact: FrImpactOutputT | null;
    impact_error?: string;
    affected_skus: Array<{ description: string; hts_code: string; hts_code_8: string; source: "agent" | "broker" }>;
  }>;
}

export async function runTariffWatch(ctx: AppContext, customerId: string): Promise<TariffWatchResult> {
  const docs = await fetchRecentFrDocuments({ perPage: 10, daysBack: 90 });
  const skuRows = await listSkuMemory(ctx, customerId);

  const out: TariffWatchResult["documents"] = [];
  for (const d of docs) {
    let impact: FrImpactOutputT | null = null;
    let err: string | undefined;
    try {
      impact = await analyzeFrDocument(ctx, d);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const matchingSkus = impact
      ? skuRows.filter((s) =>
          impact!.affected_hts_codes_8.some((c) => c === s.current_hts_code_8),
        )
      : [];
    out.push({
      document_number: d.document_number,
      title: d.title,
      abstract: d.abstract,
      publication_date: d.publication_date,
      html_url: d.html_url,
      agencies: d.agencies.map((a) => a.name),
      impact,
      ...(err ? { impact_error: err } : {}),
      affected_skus: matchingSkus.map((s) => ({
        description: s.canonical_description,
        hts_code: s.current_hts_code,
        hts_code_8: s.current_hts_code_8,
        source: s.source,
      })),
    });
  }

  return {
    promptVersion: TARIFF_MONITOR_PROMPT_VERSION,
    fetched_at: new Date().toISOString(),
    documents: out,
  };
}
