// Factory Finder — deep agentic research on specific contract manufacturers.
//
// Goes farther than the sourcing/reroute briefs: for a given product and
// country it researches NAMED factories and, per factory, returns
//   - capabilities: product lines, certifications, scale
//   - openings:     whether they take new clients, how much capacity is open,
//                   onboarding lead time, MOQ — the "can I actually get in" view
//   - horizon:      an explicit tactical-bridge vs long-term-partner assessment
//                   (a fast flexible stop-gap to dodge a tariff spike, vs a
//                   mature certified partner you grow with) with a recommendation
//   - key customers and the main engagement risk
// Backed by web_search + World Bank via the shared research loop; every run
// carries its citations.

import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { runResearchLoop, type SourceCitation } from "@/core/lib/research/research-loop";

export const FACTORY_FINDER_PROMPT_VERSION = "v1-2026-05-30";
const MAX_OUTPUT_TOKENS = 7500;

const Factory = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  region: z.string().min(2),
  website: z.string().nullable(),
  product_lines: z.array(z.string().min(2)).min(1).max(8),
  certifications: z.array(z.string().min(2)).max(10),
  scale_note: z.string().min(8),
  accepting_new_clients: z.enum(["yes", "likely", "unknown", "no"]),
  available_capacity: z.enum(["open", "moderate", "tight", "unknown"]),
  onboarding_lead_time: z.string().min(4),
  moq_note: z.string().min(3),
  key_customers: z.array(z.string().min(2)).max(8),
  tactical_bridge_fit: z.enum(["high", "medium", "low"]),
  strategic_partner_fit: z.enum(["high", "medium", "low"]),
  recommendation: z.enum(["temporary", "long_term", "both", "neither"]),
  horizon_rationale: z.string().min(15),
  risk_note: z.string().min(8),
});
export type FactoryT = z.infer<typeof Factory>;

export const FactoryFinderOutput = z.object({
  search_summary: z.string().min(20),
  country_labor_note: z.string().min(8),
  factories: z.array(Factory).min(2).max(8),
});
export type FactoryFinderOutputT = z.infer<typeof FactoryFinderOutput>;

const REPORT_TOOL = "report_factories";

const REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    search_summary: { type: "string", description: "2 plain-text sentences on what you found and the standout options." },
    country_labor_note: { type: "string", description: "One sentence on the country's labor cost / manufacturing base, grounded in the World Bank data you pulled." },
    factories: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      description: "Specific, real, named contract manufacturers for this product in this country — prefer ones you confirmed via web search.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          city: { type: "string" },
          region: { type: "string", description: "Province / industrial corridor" },
          website: { type: ["string", "null"], description: "Company website if found, else null" },
          product_lines: { type: "array", items: { type: "string" }, description: "What they actually manufacture relevant to this product" },
          certifications: { type: "array", items: { type: "string" }, description: "Quality/compliance certs found (ISO 9001, IATF 16949, BSCI, FDA, FSC, UL...). Empty if none found." },
          scale_note: { type: "string", description: "Size signal: employees, number of plants, annual capacity, year founded" },
          accepting_new_clients: { type: "string", enum: ["yes", "likely", "unknown", "no"], description: "Whether they appear open to new OEM/ODM customers" },
          available_capacity: { type: "string", enum: ["open", "moderate", "tight", "unknown"], description: "How much production capacity looks open / available" },
          onboarding_lead_time: { type: "string", description: "Realistic time to qualify + first production (samples to volume)" },
          moq_note: { type: "string", description: "Minimum order quantity implications" },
          key_customers: { type: "array", items: { type: "string" }, description: "Known brands/customers, if any. Empty if none found." },
          tactical_bridge_fit: { type: "string", enum: ["high", "medium", "low"], description: "Fit as a fast, flexible TEMPORARY stop-gap to dodge a near-term tariff" },
          strategic_partner_fit: { type: "string", enum: ["high", "medium", "low"], description: "Fit as a mature, scalable LONG-TERM partner" },
          recommendation: { type: "string", enum: ["temporary", "long_term", "both", "neither"], description: "Best use of this factory" },
          horizon_rationale: { type: "string", description: "Why it suits temporary vs long-term — ramp speed/flexibility vs scale/certification/cost" },
          risk_note: { type: "string", description: "The main engagement risk (quality ramp, China component reliance, IP, financial stability)" },
        },
        required: ["name", "city", "region", "website", "product_lines", "certifications", "scale_note", "accepting_new_clients", "available_capacity", "onboarding_lead_time", "moq_note", "key_customers", "tactical_bridge_fit", "strategic_partner_fit", "recommendation", "horizon_rationale", "risk_note"],
      },
    },
  },
  required: ["search_summary", "country_labor_note", "factories"],
};

const SYSTEM_PROMPT = `You are a sourcing research analyst finding specific contract manufacturers for a US importer. For the given product and country, do the legwork a sourcing agent would and profile real, named factories — backed by RESEARCH, not memory.

Process:
1. Use web_search aggressively to find SPECIFIC named contract manufacturers / OEM-ODM factories that make this product category in the target country. Pull their product lines, certifications, scale, known customers, and any signal of whether they take new clients and how much capacity is open.
2. Call world_bank_country_profile for the country to ground the labor/capacity context.
3. Call ${REPORT_TOOL} once with the profiles.

For EACH factory assess two horizons explicitly:
- tactical_bridge_fit: how good a fast, flexible TEMPORARY stop-gap it is (quick to qualify, flexible MOQ, can absorb volume now to dodge a tariff spike) — even if pricier or smaller.
- strategic_partner_fit: how good a LONG-TERM partner it is (mature, certified, scalable, financially stable, lower long-run cost, deeper integration).
Then set recommendation (temporary / long_term / both / neither) and explain in horizon_rationale.

For "openings": set accepting_new_clients and available_capacity from real signals (active OEM/ODM marketing, export listings, recent expansions). Use "unknown" honestly when you can't tell — do NOT fabricate capacity claims.

Writing style: plain prose only — no markdown, asterisks, bold, or bullets inside field values. Be specific and cite via search. Do NOT invent factories, certifications, or customers; if unsure, say so or use unknown. Never suggest transshipment or origin-faking.`;

export interface FactoryFinderInput {
  product_description: string;
  country_iso2: string;
  country_name: string;
}

export interface FactoryFinderResult {
  promptVersion: string;
  input: FactoryFinderInput;
  search_summary: string;
  country_labor_note: string;
  factories: FactoryT[];
  sources: SourceCitation[];
  research: { web_searches: number; world_bank_lookups: number };
}

export async function findFactories(ctx: AppContext, input: FactoryFinderInput): Promise<FactoryFinderResult> {
  const user = `Product: ${input.product_description}
Target country: ${input.country_name} (${input.country_iso2})

Find specific named factories that make this product in ${input.country_name}. For each, research capabilities, certifications, scale, capacity/openings (do they take new clients, how much capacity is open, onboarding lead time, MOQ), key customers, and a temporary-bridge vs long-term-partner assessment. Pull World Bank data for ${input.country_name}, then call ${REPORT_TOOL}.`;

  const { data, sources, research } = await runResearchLoop<FactoryFinderOutputT>(ctx, {
    system: SYSTEM_PROMPT,
    user,
    reportToolName: REPORT_TOOL,
    reportToolDescription: "Report the researched factory profiles.",
    reportSchema: REPORT_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    parse: (raw) => {
      const parsed = FactoryFinderOutput.safeParse(raw);
      if (!parsed.success) throw new Error(`factory-finder: validation failed: ${parsed.error.message}`);
      return parsed.data;
    },
  });

  return {
    promptVersion: FACTORY_FINDER_PROMPT_VERSION,
    input,
    search_summary: data.search_summary,
    country_labor_note: data.country_labor_note,
    factories: data.factories.map((f) => ({
      ...f,
      product_lines: f.product_lines.slice(0, 6),
      certifications: f.certifications.slice(0, 8),
      key_customers: f.key_customers.slice(0, 6),
    })),
    sources,
    research,
  };
}
