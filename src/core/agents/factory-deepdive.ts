// Factory deep-dive — a focused second research pass on ONE named factory.
//
// Where Factory Finder surveys the field, this digs into a single factory:
// ownership/scale, facilities, recent developments, due-diligence flags
// (financial stability, China-component reliance, IP, UFLPA/forced-labor,
// quality), how best to engage it, and a ready-to-send outreach/RFQ email.
// Backed by web_search via the shared research loop, with citations.

import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { runResearchLoop, type SourceCitation } from "@/core/lib/research/research-loop";

export const FACTORY_DEEPDIVE_PROMPT_VERSION = "v1-2026-05-30";
const MAX_OUTPUT_TOKENS = 5000;

export const FactoryDeepDiveOutput = z.object({
  overview: z.string().min(20),
  founded: z.string().nullable(),
  ownership: z.string().min(3),
  workforce_scale: z.string().min(3),
  facilities: z.string().min(8),
  product_capabilities: z.array(z.string().min(2)).min(1).max(20),
  certifications: z.array(z.string().min(2)).max(20),
  notable_customers: z.array(z.string().min(2)).max(20),
  recent_developments: z.array(z.object({ period: z.string(), note: z.string().min(6) })).max(12),
  diligence_flags: z.array(z.object({ kind: z.enum(["positive", "watch", "risk"]), note: z.string().min(6) })).min(1).max(14),
  engagement_fit: z.string().min(15),
  draft_outreach: z.object({ subject: z.string().min(6), body: z.string().min(40) }),
  confidence_note: z.string().min(10),
});
export type FactoryDeepDiveOutputT = z.infer<typeof FactoryDeepDiveOutput>;

const REPORT_TOOL = "report_factory_deepdive";

const REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    overview: { type: "string", description: "2-3 plain-text sentences on who they are and why they matter for this product." },
    founded: { type: ["string", "null"], description: "Founding year if found, else null" },
    ownership: { type: "string", description: "Ownership / parent group / nationality of capital" },
    workforce_scale: { type: "string", description: "Employees / workforce size signal" },
    facilities: { type: "string", description: "Plants, locations, floor area, capacity" },
    product_capabilities: { type: "array", items: { type: "string" }, description: "Detailed manufacturing capabilities relevant to the product" },
    certifications: { type: "array", items: { type: "string" }, description: "Quality/compliance certs found. Empty if none." },
    notable_customers: { type: "array", items: { type: "string" }, description: "Known brands/customers. Empty if none." },
    recent_developments: { type: "array", items: { type: "object", properties: { period: { type: "string" }, note: { type: "string" } }, required: ["period", "note"] }, description: "Expansions, investments, news (period + one sentence)" },
    diligence_flags: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["positive", "watch", "risk"] }, note: { type: "string" } }, required: ["kind", "note"] }, description: "Due-diligence signals: positive strengths, watch items, and real risks (financial stability, China-component reliance, IP, forced-labor/UFLPA exposure, quality ramp)." },
    engagement_fit: { type: "string", description: "How to engage: bridge vs long-term, realistic MOQ/onboarding, what to ask for" },
    draft_outreach: {
      type: "object",
      description: "A ready-to-send outreach / RFQ email the importer can send.",
      properties: {
        subject: { type: "string" },
        body: { type: "string", description: "A concise, professional RFQ asking about capacity, MOQ, certifications, lead time, samples, and pricing. Use [Your name] / [Company] placeholders. Plain text." },
      },
      required: ["subject", "body"],
    },
    confidence_note: { type: "string", description: "How much was verifiable via search vs inferred; flag anything to confirm directly." },
  },
  required: ["overview", "founded", "ownership", "workforce_scale", "facilities", "product_capabilities", "certifications", "notable_customers", "recent_developments", "diligence_flags", "engagement_fit", "draft_outreach", "confidence_note"],
};

const SYSTEM_PROMPT = `You are a sourcing due-diligence analyst. A US importer is evaluating ONE specific factory for a product. Research it thoroughly via web_search and produce a deep profile plus a ready-to-send outreach email.

Cover: ownership/parent and scale, facilities, detailed capabilities, certifications, known customers, recent developments (expansions/investments/news), and due-diligence flags — be balanced: positive strengths, watch items, and genuine risks (financial stability, heavy reliance on imported Chinese components, IP protection, forced-labor/UFLPA exposure, quality-ramp risk). Then write engagement_fit (bridge vs long-term, realistic MOQ/onboarding) and a professional draft_outreach RFQ email.

Rules: plain prose only — no markdown, asterisks, or bullets inside field values. Do NOT invent facts, certifications, customers, or news; if you cannot verify something, say so in confidence_note and prefer "unknown". Never suggest transshipment or origin-faking. Call ${REPORT_TOOL} once.`;

export interface FactoryDeepDiveInput {
  factory_name: string;
  city: string;
  country_name: string;
  product_description: string;
}

export interface FactoryDeepDiveResult {
  promptVersion: string;
  input: FactoryDeepDiveInput;
  profile: FactoryDeepDiveOutputT;
  sources: SourceCitation[];
  research: { web_searches: number; world_bank_lookups: number };
}

export async function deepDiveFactory(ctx: AppContext, input: FactoryDeepDiveInput): Promise<FactoryDeepDiveResult> {
  const user = `Factory: ${input.factory_name}
Location: ${input.city}, ${input.country_name}
Product being sourced: ${input.product_description}

Research this specific factory in depth — ownership, scale, facilities, capabilities, certifications, customers, recent developments, and due-diligence flags — then draft an outreach RFQ email. Call ${REPORT_TOOL}.`;

  const { data, sources, research } = await runResearchLoop<FactoryDeepDiveOutputT>(ctx, {
    system: SYSTEM_PROMPT,
    user,
    reportToolName: REPORT_TOOL,
    reportToolDescription: "Report the factory deep-dive profile and draft outreach.",
    reportSchema: REPORT_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    parse: (raw) => {
      const parsed = FactoryDeepDiveOutput.safeParse(raw);
      if (!parsed.success) throw new Error(`factory-deepdive: validation failed: ${parsed.error.message}`);
      return parsed.data;
    },
  });

  // Slice for display — generous Zod caps avoid discarding a full research run.
  const profile: FactoryDeepDiveOutputT = {
    ...data,
    product_capabilities: data.product_capabilities.slice(0, 10),
    certifications: data.certifications.slice(0, 12),
    notable_customers: data.notable_customers.slice(0, 10),
    recent_developments: data.recent_developments.slice(0, 6),
    diligence_flags: data.diligence_flags.slice(0, 8),
  };
  return { promptVersion: FACTORY_DEEPDIVE_PROMPT_VERSION, input, profile, sources, research };
}
