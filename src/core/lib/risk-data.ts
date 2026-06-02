// Loads + caches the three risk-screening datasets used by
// src/core/agents/risk-screener.ts.
//
// All three are small (<15k rows total) so we keep them in memory and run
// the screen as a deterministic fuzzy match — no DB, no embedding lookup,
// no LLM. Trigram Jaccard + normalised-name exact match is enough to find
// every entry on the lists that's spelled within reason of the input.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface SanctionsEntry {
  source: "OFAC SDN" | "BIS Entity List";
  id: string;
  name: string;
  alt_names: string[];
  /** Normalised form for matching: lowercase, no punctuation, no corp suffix. */
  normalised: string;
  trigrams: Set<string>;
  country: string | null;
  address: string | null;
  program: string | null;
  notes: string | null;
}

export interface UflpaEntry {
  id: string;
  name: string;
  normalised: string;
  trigrams: Set<string>;
  city: string;
  province: string;
  country: string;
  sector: string;
  added_date: string;
  sublist: string;
}

export interface UflpaRegionsTable {
  xuar_cities: string[];
  labor_transfer_cities: string[];
  scrutinized_sectors: string[];
  last_updated: string;
}

export interface RiskData {
  ofac_sdn: SanctionsEntry[];
  bis_entity_list: SanctionsEntry[];
  uflpa: UflpaEntry[];
  uflpa_regions: UflpaRegionsTable;
  loaded_at: string;
  sources: Array<{ name: string; rows: number; last_refreshed: string }>;
}

let CACHED: Promise<RiskData> | null = null;

export function clearRiskDataCache(): void {
  CACHED = null;
}

export function loadRiskData(dataDir = "data/risk"): Promise<RiskData> {
  if (CACHED) return CACHED;
  CACHED = (async () => {
    const root = path.resolve(process.cwd(), dataDir);
    const [ofacText, bisText, uflpaText, regionsText] = await Promise.all([
      fs.readFile(path.join(root, "ofac-sdn.csv"), "utf8"),
      fs.readFile(path.join(root, "bis-entity-list.csv"), "utf8"),
      fs.readFile(path.join(root, "uflpa-entity-list.csv"), "utf8"),
      fs.readFile(path.join(root, "uflpa-regions.json"), "utf8"),
    ]);

    const ofac = parseOfac(ofacText);
    const bis = parseBis(bisText);
    const uflpa = parseUflpa(uflpaText);
    const regionsRaw = JSON.parse(regionsText) as {
      _last_updated?: string;
      xuar_cities: string[];
      labor_transfer_destinations: { cities: string[] };
      scrutinized_sectors: { sectors: string[] };
    };
    const regions: UflpaRegionsTable = {
      xuar_cities: regionsRaw.xuar_cities,
      labor_transfer_cities: regionsRaw.labor_transfer_destinations.cities,
      scrutinized_sectors: regionsRaw.scrutinized_sectors.sectors,
      last_updated: regionsRaw._last_updated ?? new Date().toISOString().slice(0, 10),
    };

    return {
      ofac_sdn: ofac,
      bis_entity_list: bis,
      uflpa,
      uflpa_regions: regions,
      loaded_at: new Date().toISOString(),
      sources: [
        { name: "OFAC SDN", rows: ofac.length, last_refreshed: dataRefreshDate(root, "ofac-sdn.csv") },
        { name: "BIS Entity List", rows: bis.length, last_refreshed: dataRefreshDate(root, "bis-entity-list.csv") },
        { name: "UFLPA Entity List", rows: uflpa.length, last_refreshed: dataRefreshDate(root, "uflpa-entity-list.csv") },
      ],
    };
  })();
  return CACHED;
}

function dataRefreshDate(root: string, file: string): string {
  // Synchronous to keep loadRiskData() simple; we already read the file.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { statSync } = require("node:fs") as typeof import("node:fs");
    const s = statSync(path.join(root, file));
    return s.mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ─── CSV parsing — small files, simple quoted-field parser, no dep ────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') inQuote = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseOfac(text: string): SanctionsEntry[] {
  const rows = parseCsv(text);
  return rows.map((r) => {
    const name = r.name ?? "";
    const normalised = normalise(name);
    return {
      source: "OFAC SDN" as const,
      id: r.uid ?? "",
      name,
      alt_names: [],
      normalised,
      trigrams: trigrams(normalised),
      country: null,
      address: null,
      program: r.program ?? null,
      notes: r.remarks || null,
    };
  });
}

function parseBis(text: string): SanctionsEntry[] {
  const rows = parseCsv(text);
  return rows.map((r) => {
    const name = r.name ?? "";
    const alts = (r.alt_names ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    const normalised = normalise(name);
    return {
      source: "BIS Entity List" as const,
      id: r.entity_number ?? "",
      name,
      alt_names: alts,
      normalised,
      trigrams: trigrams(normalised),
      country: r.country ?? null,
      address: r.addresses ?? null,
      program: r.license_requirement ?? null,
      notes: r.license_policy ?? null,
    };
  });
}

function parseUflpa(text: string): UflpaEntry[] {
  const rows = parseCsv(text);
  return rows.map((r) => {
    const name = r.name ?? "";
    const normalised = normalise(name);
    return {
      id: r.entry_number ?? "",
      name,
      normalised,
      trigrams: trigrams(normalised),
      city: r.city ?? "",
      province: r.province ?? "",
      country: r.country ?? "",
      sector: r.sector ?? "",
      added_date: r.added_date ?? "",
      sublist: r.sublist ?? "",
    };
  });
}

// ─── Name normalisation + trigram fuzzy match ────────────────────────────

const CORP_SUFFIX = /\b(co\.?|company|corp\.?|corporation|inc\.?|ltd\.?|limited|llc|gmbh|sa|s\.a\.|s\.r\.l\.|plc|holdings?|group|industries|industrial|international|intl|trading|technologies|tech|enterprise|enterprises|manufacturing|mfg|services|svcs|joint stock|jsc|ojsc|pvt|private)\b/g;

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(CORP_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  const padded = `  ${s}  `;
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type MatchQuality = "exact" | "fuzzy" | "partial";

export interface MatchResult<T> {
  entry: T;
  similarity: number;
  quality: MatchQuality;
}

/** Return all entries whose normalised name is similar enough to the query.
 *  Thresholds: exact (sim ≥ 0.99), fuzzy (sim ≥ 0.85), partial (sim ≥ 0.70).
 *  Below partial is rejected entirely. */
export function bestMatches<T extends { normalised: string; trigrams: Set<string> }>(
  query: string,
  pool: T[],
  thresholds = { exact: 0.99, fuzzy: 0.85, partial: 0.7 },
): MatchResult<T>[] {
  const qNorm = normalise(query);
  if (!qNorm) return [];
  const qTri = trigrams(qNorm);
  const out: MatchResult<T>[] = [];
  for (const entry of pool) {
    if (entry.normalised === qNorm) {
      out.push({ entry, similarity: 1, quality: "exact" });
      continue;
    }
    const sim = jaccard(qTri, entry.trigrams);
    if (sim >= thresholds.exact) out.push({ entry, similarity: sim, quality: "exact" });
    else if (sim >= thresholds.fuzzy) out.push({ entry, similarity: sim, quality: "fuzzy" });
    else if (sim >= thresholds.partial) out.push({ entry, similarity: sim, quality: "partial" });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
