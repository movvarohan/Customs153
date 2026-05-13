// Tariff rates lookup. Loads data/tariff-rates/<year>.json into ctx.cache
// once, then resolves HTS code + country to ad-valorem / Section 301 /
// Section 232 components. Production swaps this for a Cloudflare KV
// adapter; semantics stay the same.

import { promises as fs } from "node:fs";
import path from "node:path";
import { TariffRatesTable, type TariffRatesTableT } from "@/core/schemas/duty";
import type { AppContext } from "@/core/app-context";

const RATES_FILE = "data/tariff-rates/2026.json";
const CACHE_KEY = "tariff-rates:current";

let memo: TariffRatesTableT | null = null;

export async function loadTariffRates(ctx: AppContext): Promise<TariffRatesTableT> {
  if (memo) return memo;
  const cached = await ctx.cache.get<TariffRatesTableT>(CACHE_KEY);
  if (cached) {
    memo = TariffRatesTable.parse(cached);
    return memo;
  }
  const text = await fs.readFile(path.resolve(RATES_FILE), "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  const cleaned = stripDocKeys(raw);
  const parsed = TariffRatesTable.parse(cleaned);
  await ctx.cache.set(CACHE_KEY, parsed);
  memo = parsed;
  return memo;
}

/** Recursively drop keys starting with "_" (used for inline doc / disclaimers). */
function stripDocKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDocKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("_")) continue;
      out[k] = stripDocKeys(v);
    }
    return out;
  }
  return value;
}

export interface ResolvedRates {
  base_ad_valorem: number;
  base_source: string;
  section_301_rate: number | null;
  section_301_source: string | null;
  section_232_rate: number | null;
  section_232_source: string | null;
  warnings: string[];
}

/** Resolves all rate components for an HTS code + country pair. */
export function resolveRates(
  table: TariffRatesTableT,
  htsCode: string,
  countryOfOrigin: string,
): ResolvedRates {
  const warnings: string[] = [];

  // Base ad-valorem: keyed by 6-digit (XXXX.XX) prefix.
  const sixDigit = htsCode.length >= 7 ? htsCode.slice(0, 7) : htsCode.slice(0, 4);
  const base = table.ad_valorem[sixDigit];
  let baseRate: number;
  let baseSource: string;
  if (typeof base === "number") {
    baseRate = base;
    baseSource = `HTS 2026 ad valorem ${sixDigit}`;
  } else {
    baseRate = table.default_ad_valorem;
    baseSource = `rate not found - placeholder default ${(table.default_ad_valorem * 100).toFixed(2)}%`;
    warnings.push(`base ad-valorem rate not found for ${sixDigit}; using default ${(table.default_ad_valorem * 100).toFixed(2)}%`);
  }

  // Section 301 China.
  const chapter = htsCode.slice(0, 2);
  let s301Rate: number | null = null;
  let s301Source: string | null = null;
  if (countryOfOrigin.toUpperCase() === "CN") {
    const r = table.section_301_china.by_chapter[chapter];
    if (typeof r === "number") {
      s301Rate = r;
      s301Source = `Section 301 China (Ch ${chapter}, ${(r * 100).toFixed(1)}%)`;
    }
  }

  // Section 232 steel/aluminum.
  let s232Rate: number | null = null;
  let s232Source: string | null = null;
  const r232 = table.section_232.by_chapter[chapter];
  if (typeof r232 === "number") {
    s232Rate = r232;
    s232Source = `Section 232 (Ch ${chapter}, ${(r232 * 100).toFixed(1)}%)`;
  }

  return {
    base_ad_valorem: baseRate,
    base_source: baseSource,
    section_301_rate: s301Rate,
    section_301_source: s301Source,
    section_232_rate: s232Rate,
    section_232_source: s232Source,
    warnings,
  };
}
