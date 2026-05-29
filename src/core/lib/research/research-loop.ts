// Shared agentic research loop: web_search (Anthropic server tool) + a keyless
// World Bank macro-data tool + a caller-supplied structured "report" tool.
//
// Both the per-product sourcing agent and the portfolio reroute agent use this
// so the live-research plumbing (citation extraction, World Bank execution,
// forcing the final report) lives in exactly one place.

import type Anthropic from "@anthropic-ai/sdk";
import type { AppContext } from "@/core/app-context";
import { fetchCountryProfile, summarizeProfile } from "./world-bank";

const MAX_WEB_SEARCHES = 6;
const WORLD_BANK_TOOL = "world_bank_country_profile";

export interface SourceCitation {
  title: string;
  url: string;
}

// The web_search server tool isn't in the installed SDK's typed tool union,
// so it's declared as a raw object and cast at the call boundary.
export const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES } as unknown as Anthropic.Messages.ToolUnion;

const WORLD_BANK_TOOL_DEF: Anthropic.Messages.Tool = {
  name: WORLD_BANK_TOOL,
  description: "Real World Bank macro data for a country: GDP per capita (labor-cost proxy), manufacturing % of GDP, and labor-force size.",
  input_schema: {
    type: "object",
    properties: { country_iso2: { type: "string", description: "ISO-2 country code, e.g. VN, IN, MX, TH, MY, BD" } },
    required: ["country_iso2"],
  },
};

/** Pull {title,url} citations + a server-tool-use (search) count out of a response's content. */
export function extractCitations(content: unknown[]): { cites: SourceCitation[]; searches: number } {
  const cites: SourceCitation[] = [];
  let searches = 0;
  for (const b of content) {
    const blk = b as { type?: string; content?: unknown };
    if (blk.type === "server_tool_use") searches += 1;
    if (blk.type === "web_search_tool_result" && Array.isArray(blk.content)) {
      for (const r of blk.content) {
        const item = r as { url?: string; title?: string };
        if (item.url) cites.push({ title: (item.title ?? item.url).slice(0, 160), url: item.url });
      }
    }
  }
  return { cites, searches };
}

export interface ResearchLoopSpec<T> {
  system: string;
  user: string;
  reportToolName: string;
  reportToolDescription: string;
  reportSchema: Anthropic.Messages.Tool["input_schema"];
  /** Validate & narrow the report tool input; throw on invalid. */
  parse: (input: unknown) => T;
  maxRounds?: number;
  maxTokens?: number;
}

export interface ResearchLoopResult<T> {
  data: T;
  sources: SourceCitation[];
  research: { web_searches: number; world_bank_lookups: number };
}

/** Run web_search + World Bank research until the model calls the report tool. */
export async function runResearchLoop<T>(ctx: AppContext, spec: ResearchLoopSpec<T>): Promise<ResearchLoopResult<T>> {
  const maxRounds = spec.maxRounds ?? 6;
  const maxTokens = spec.maxTokens ?? 8000;
  const model = ctx.config.defaultModel;

  const tools: Anthropic.Messages.ToolUnion[] = [
    WEB_SEARCH_TOOL,
    WORLD_BANK_TOOL_DEF,
    { name: spec.reportToolName, description: spec.reportToolDescription, input_schema: spec.reportSchema },
  ];
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: spec.user }];

  const allCites: SourceCitation[] = [];
  const wbSources: SourceCitation[] = [];
  let webSearchCount = 0;
  let worldBankCount = 0;
  let data: T | null = null;

  for (let round = 0; round < maxRounds && data === null; round++) {
    const forceReport = round === maxRounds - 1;
    const response = await ctx.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: spec.system,
      tools,
      tool_choice: forceReport ? { type: "tool", name: spec.reportToolName } : { type: "auto" },
      messages,
    });

    const { cites, searches } = extractCitations(response.content as unknown[]);
    allCites.push(...cites);
    webSearchCount += searches;

    const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    const report = toolUses.find((t) => t.name === spec.reportToolName);
    if (report) {
      data = spec.parse(report.input);
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const wbCalls = toolUses.filter((t) => t.name === WORLD_BANK_TOOL);
    if (wbCalls.length > 0) {
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of wbCalls) {
        worldBankCount += 1;
        const iso = String((tu.input as { country_iso2?: string }).country_iso2 ?? "").toUpperCase();
        try {
          const profile = await fetchCountryProfile(iso);
          wbSources.push({ title: `World Bank indicators — ${profile.country_name ?? iso}`, url: profile.source_url });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: summarizeProfile(profile) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `World Bank lookup failed: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    } else {
      messages.push({ role: "user", content: `Continue your research if needed, then call ${spec.reportToolName} with your findings.` });
    }
  }

  if (data === null) throw new Error("research loop: no report produced");

  // De-dupe citations by URL; web results first, then World Bank sources.
  const seen = new Set<string>();
  const sources: SourceCitation[] = [];
  for (const c of [...allCites, ...wbSources]) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    sources.push(c);
    if (sources.length >= 14) break;
  }

  return { data, sources, research: { web_searches: webSearchCount, world_bank_lookups: worldBankCount } };
}
