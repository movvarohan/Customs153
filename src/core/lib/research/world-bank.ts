// World Bank Indicators API — free, keyless macro data used to GROUND the
// sourcing agent's labor-cost and manufacturing-capacity claims in real
// numbers instead of model memory. Same on-demand https pattern as the
// tariff-monitor and cross-verifier agents.
//
// Indicators:
//   NY.GDP.PCAP.CD  GDP per capita (current US$)      → labor-cost proxy
//   NV.IND.MANF.ZS  Manufacturing, value added (%GDP) → manufacturing intensity
//   SL.TLF.TOTL.IN  Labor force, total                → workforce scale / availability
//
// The API returns BOM-prefixed JSON, so we strip it before parsing.

import https from "node:https";

const AGENT = new https.Agent({ rejectUnauthorized: false });
const BASE = "https://api.worldbank.org/v2";

const INDICATORS = {
  gdp_per_capita_usd: "NY.GDP.PCAP.CD",
  manufacturing_value_added_pct: "NV.IND.MANF.ZS",
  labor_force_total: "SL.TLF.TOTL.IN",
} as const;

export interface WorldBankProfile {
  country_iso2: string;
  country_name: string | null;
  gdp_per_capita_usd: number | null;
  gdp_per_capita_year: string | null;
  manufacturing_value_added_pct: number | null;
  labor_force_total: number | null;
  source_url: string;
}

interface WbRow {
  country?: { value?: string };
  value?: number | null;
  date?: string;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: AGENT, timeout: 12_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
          resolve(JSON.parse(text));
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("World Bank timeout")));
  });
}

/** Most-recent-non-empty value for one indicator, plus the country name. */
async function latest(iso2: string, indicator: string): Promise<{ value: number | null; year: string | null; country: string | null }> {
  const url = `${BASE}/country/${encodeURIComponent(iso2)}/indicator/${indicator}?format=json&per_page=1&mrnev=1`;
  const j = await fetchJson(url);
  if (!Array.isArray(j) || j.length < 2 || !Array.isArray(j[1]) || j[1].length === 0) {
    return { value: null, year: null, country: null };
  }
  const row = j[1][0] as WbRow;
  return {
    value: typeof row.value === "number" ? row.value : null,
    year: row.date ?? null,
    country: row.country?.value ?? null,
  };
}

/** Fetch a country's labor / manufacturing profile. Never throws — missing data returns nulls. */
export async function fetchCountryProfile(iso2: string): Promise<WorldBankProfile> {
  const code = iso2.toUpperCase();
  const source_url = `${BASE}/country/${code}/indicator/${INDICATORS.gdp_per_capita_usd}`;
  try {
    const [gdp, mfg, labor] = await Promise.all([
      latest(code, INDICATORS.gdp_per_capita_usd),
      latest(code, INDICATORS.manufacturing_value_added_pct),
      latest(code, INDICATORS.labor_force_total),
    ]);
    return {
      country_iso2: code,
      country_name: gdp.country ?? mfg.country ?? labor.country,
      gdp_per_capita_usd: gdp.value,
      gdp_per_capita_year: gdp.year,
      manufacturing_value_added_pct: mfg.value,
      labor_force_total: labor.value,
      source_url,
    };
  } catch {
    return {
      country_iso2: code,
      country_name: null,
      gdp_per_capita_usd: null,
      gdp_per_capita_year: null,
      manufacturing_value_added_pct: null,
      labor_force_total: null,
      source_url,
    };
  }
}

/** A compact one-line summary for feeding back to the model as a tool result. */
export function summarizeProfile(p: WorldBankProfile): string {
  const parts: string[] = [];
  parts.push(`${p.country_name ?? p.country_iso2} (World Bank, latest):`);
  if (p.gdp_per_capita_usd !== null) parts.push(`GDP/capita $${Math.round(p.gdp_per_capita_usd).toLocaleString()} (${p.gdp_per_capita_year})`);
  if (p.manufacturing_value_added_pct !== null) parts.push(`manufacturing ${p.manufacturing_value_added_pct.toFixed(1)}% of GDP`);
  if (p.labor_force_total !== null) parts.push(`labor force ${Math.round(p.labor_force_total).toLocaleString()}`);
  if (parts.length === 1) parts.push("no indicator data available");
  return parts.join("; ");
}
