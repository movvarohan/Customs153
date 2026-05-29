// Reroute intelligence — the Policy Lab's research-backed destination brief.
//
// When a CFO reroutes the whole catalog out of China in the Policy Lab, this
// agent researches the chosen DESTINATION country for the catalog's product
// mix: where the goods would actually be made (named clusters + suppliers,
// with coordinates for a map), a researched blended unit-cost index vs China
// (which feeds the lab's break-even economics), real World Bank labor/capacity
// data, freight/lead-time availability, and the key ramp risks — all cited.
//
// Same shared web_search + World Bank research loop as the sourcing agent.

import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { runResearchLoop, type SourceCitation } from "@/core/lib/research/research-loop";

export const REROUTE_INTEL_PROMPT_VERSION = "v1-2026-05-29";
const MAX_OUTPUT_TOKENS = 6000;

const RerouteHub = z.object({
  hub_city: z.string(),
  hub_region: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  feasibility: z.enum(["high", "medium", "low"]),
  example_suppliers: z.array(z.string()).min(1).max(12),
  note: z.string().min(8),
});

export const RerouteIntelOutput = z.object({
  origin_hub: z.object({ city: z.string(), region: z.string(), lat: z.number(), lng: z.number() }),
  destination_hubs: z.array(RerouteHub).min(1).max(3),
  blended_unit_cost_index: z.number().min(40).max(300), // China = 100
  avg_labor_cost_note: z.string().min(4),
  manufacturing_availability: z.enum(["high", "medium", "low"]),
  lead_time_note: z.string(),
  key_risks: z.array(z.string().min(4)).min(1).max(8),
  summary: z.string().min(20),
});
export type RerouteIntelOutputT = z.infer<typeof RerouteIntelOutput>;

const REPORT_TOOL = "report_reroute_intel";

const REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    origin_hub: {
      type: "object",
      description: "Where this catalog's goods are most likely made today in China, with approx lat/lng.",
      properties: { city: { type: "string" }, region: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } },
      required: ["city", "region", "lat", "lng"],
    },
    destination_hubs: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      description: "Real manufacturing clusters in the destination country that could make this catalog's product mix.",
      items: {
        type: "object",
        properties: {
          hub_city: { type: "string" },
          hub_region: { type: "string", description: "The industrial corridor and what it's known for" },
          lat: { type: "number" },
          lng: { type: "number" },
          feasibility: { type: "string", enum: ["high", "medium", "low"] },
          example_suppliers: { type: "array", items: { type: "string" }, description: "Named contract manufacturers / OEM ecosystem (prefer names found via web search)" },
          note: { type: "string", description: "Why this cluster fits the catalog" },
        },
        required: ["hub_city", "hub_region", "lat", "lng", "feasibility", "example_suppliers", "note"],
      },
    },
    blended_unit_cost_index: { type: "number", description: "Blended ex-works unit cost for THIS catalog at the destination, relative to China=100 (e.g. 104 = 4% pricier). Most low-cost countries 90–120." },
    avg_labor_cost_note: { type: "string", description: "Labor cost grounded in the World Bank data you pulled" },
    manufacturing_availability: { type: "string", enum: ["high", "medium", "low"], description: "Capacity/ecosystem availability for this catalog's categories" },
    lead_time_note: { type: "string", description: "Ocean transit / lead-time + freight availability vs China" },
    key_risks: { type: "array", items: { type: "string" }, description: "Top ramp/quality/origin risks of the move" },
    summary: { type: "string" },
  },
  required: ["origin_hub", "destination_hubs", "blended_unit_cost_index", "avg_labor_cost_note", "manufacturing_availability", "lead_time_note", "key_risks", "summary"],
};

const SYSTEM_PROMPT = `You are a supply-chain research analyst advising a US importer that is considering moving its CHINA-sourced catalog to another country to escape Section 301 tariffs. Research the named DESTINATION country for the catalog's product mix and produce a relocation brief, backed by RESEARCH not memory.

Process:
1. Use web_search to find where these product categories are actually manufactured in the destination country — name real clusters/cities and real contract manufacturers/OEMs. Search current freight/shipping availability and lead times from the destination to the US.
2. Call world_bank_country_profile for the destination to ground labor-cost and capacity claims in real data (GDP/capita, manufacturing % of GDP, labor force).
3. Call ${REPORT_TOOL} once with the brief.

Set blended_unit_cost_index honestly for the whole catalog moving there (China=100). Be specific and cited. Do NOT suggest transshipment/origin-faking or invent FTAs.`;

export interface RerouteIntelInput {
  destination_iso2: string;
  destination_name: string;
  category_summary: string;
}

export interface RerouteIntelResult {
  promptVersion: string;
  destination_iso2: string;
  destination_name: string;
  origin_hub: RerouteIntelOutputT["origin_hub"];
  destination_hubs: RerouteIntelOutputT["destination_hubs"];
  blended_unit_cost_index: number;
  /** blended_unit_cost_index / 100 − 1, the premium the Policy Lab feeds into break-even. */
  unit_cost_premium_pct: number;
  avg_labor_cost_note: string;
  manufacturing_availability: "high" | "medium" | "low";
  lead_time_note: string;
  key_risks: string[];
  summary: string;
  sources: SourceCitation[];
  research: { web_searches: number; world_bank_lookups: number };
}

export async function analyzeReroute(ctx: AppContext, input: RerouteIntelInput): Promise<RerouteIntelResult> {
  const user = `Destination country: ${input.destination_name} (${input.destination_iso2})
Current origin: China (CN)
Catalog product mix to relocate: ${input.category_summary}

Research where this catalog could be made in ${input.destination_name} (named clusters + suppliers), pull World Bank labor/capacity data, assess freight/lead time, and call ${REPORT_TOOL}.`;

  const { data, sources, research } = await runResearchLoop<RerouteIntelOutputT>(ctx, {
    system: SYSTEM_PROMPT,
    user,
    reportToolName: REPORT_TOOL,
    reportToolDescription: "Report the destination relocation brief.",
    reportSchema: REPORT_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    parse: (raw) => {
      const parsed = RerouteIntelOutput.safeParse(raw);
      if (!parsed.success) throw new Error(`reroute-intel: validation failed: ${parsed.error.message}`);
      return parsed.data;
    },
  });

  return {
    promptVersion: REROUTE_INTEL_PROMPT_VERSION,
    destination_iso2: input.destination_iso2,
    destination_name: input.destination_name,
    origin_hub: data.origin_hub,
    destination_hubs: data.destination_hubs.map((h) => ({ ...h, example_suppliers: h.example_suppliers.slice(0, 6) })),
    blended_unit_cost_index: data.blended_unit_cost_index,
    unit_cost_premium_pct: Math.round((data.blended_unit_cost_index / 100 - 1) * 1000) / 1000,
    avg_labor_cost_note: data.avg_labor_cost_note,
    manufacturing_availability: data.manufacturing_availability,
    lead_time_note: data.lead_time_note,
    key_risks: data.key_risks.slice(0, 5),
    summary: data.summary,
    sources,
    research,
  };
}
