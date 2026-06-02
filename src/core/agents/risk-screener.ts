// Risk & compliance screener.
//
// Runs every party named on an entry — the importer + every supplier — against
// three publicly-available federal lists (OFAC SDN, BIS Entity List, UFLPA),
// against a structural check for addresses in XUAR scrutiny regions, and
// against a simple entity graph that surfaces anomalies like "two nominally
// independent suppliers share an address" or "the importer's filing pattern
// concentrates on a single high-risk origin." Also flags any AD/CVD case that
// applies to an HTS code on the filing.
//
// Deterministic. No LLM. Citations come straight from the row in the public
// list — the source, the stable row id, the dataset refresh date, and the
// quote. Confidence is set from match quality: exact name match = high,
// trigram-Jaccard ≥ 0.85 = medium, ≥ 0.70 = low.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppContext } from "@/core/app-context";
import type { HistoricalEntriesT } from "@/core/schemas/refund";
import type {
  RiskProfileT,
  SanctionsHitT,
  UflpaExposureT,
  AddCvdCaseT,
  EntityAnomalyT,
  RiskCitationT,
} from "@/core/schemas/risk";
import { loadRiskData, bestMatches, type SanctionsEntry } from "@/core/lib/risk-data";

interface AddCvdRow {
  case_number: string;
  hts_8: string;
  country: string;
  product: string;
  margin_pct: number;
  type: "AD" | "CVD";
}

let CACHED_ADDCVD: Promise<{ cases: AddCvdRow[]; last_updated: string }> | null = null;

function loadAddCvd(): Promise<{ cases: AddCvdRow[]; last_updated: string }> {
  if (CACHED_ADDCVD) return CACHED_ADDCVD;
  CACHED_ADDCVD = (async () => {
    const text = await fs.readFile(path.resolve(process.cwd(), "data/risk/addcvd-cases.json"), "utf8");
    const j = JSON.parse(text) as { _last_updated: string; cases: AddCvdRow[] };
    return { cases: j.cases, last_updated: j._last_updated };
  })();
  return CACHED_ADDCVD;
}

// Public — exported so the CLI / tests can call without an AppContext.
export async function runRiskScreen(input: HistoricalEntriesT): Promise<RiskProfileT> {
  const data = await loadRiskData();
  const addcvd = await loadAddCvd();

  const importer = input.importer.trim();
  const importerEin = input.importer_ein?.trim() || null;
  const supplierNames = new Set<string>();
  interface SupplierRow { name: string; address: string | undefined; city: string | undefined; province: string | undefined; country: string | undefined; from_entry: string }
  const suppliers: SupplierRow[] = [];
  for (const e of input.entries) {
    for (const s of e.suppliers ?? []) {
      if (!supplierNames.has(s.name)) {
        supplierNames.add(s.name);
        suppliers.push({
          name: s.name,
          address: s.address,
          city: s.city,
          province: s.province,
          country: s.country,
          from_entry: e.entry_number,
        });
      }
    }
  }

  // ── 1. Sanctions screen: importer + each supplier vs OFAC + BIS ─────────
  const sanctions_hits: SanctionsHitT[] = [];
  const screenSanctions = (
    name: string,
    kind: "importer" | "supplier",
    pool: SanctionsEntry[],
    sourceDate: string,
  ): SanctionsHitT[] => {
    const matches = bestMatches(name, pool);
    return matches.slice(0, 1).map<SanctionsHitT>((m) => ({
      party_name: name,
      party_kind: kind,
      matched_name: m.entry.name,
      match_quality: m.quality,
      similarity: m.similarity,
      confidence: m.quality === "exact" ? "high" : m.quality === "fuzzy" ? "medium" : "low",
      citation: {
        source: m.entry.source,
        source_id: m.entry.id,
        source_date: sourceDate,
        quote: `${m.entry.name}${m.entry.country ? ` (${m.entry.country})` : ""}${m.entry.program ? ` — ${m.entry.program}` : ""}`,
      },
      recommended_action:
        m.quality === "exact"
          ? `BLOCKING — ${kind} appears on the ${m.entry.source}. Do not transact without specific OFAC/BIS licence.`
          : `Review — ${kind} matches a ${m.entry.source} entry by ${(m.similarity * 100).toFixed(0)}%. Confirm parties are distinct before proceeding.`,
    }));
  };
  for (const pool of [data.ofac_sdn, data.bis_entity_list]) {
    const sourceDate = pool === data.ofac_sdn
      ? data.sources.find((s) => s.name === "OFAC SDN")!.last_refreshed
      : data.sources.find((s) => s.name === "BIS Entity List")!.last_refreshed;
    sanctions_hits.push(...screenSanctions(importer, "importer", pool, sourceDate));
    for (const s of suppliers) sanctions_hits.push(...screenSanctions(s.name, "supplier", pool, sourceDate));
  }

  // ── 2. UFLPA: direct list + region scrutiny + sector scrutiny ───────────
  const uflpa_exposure: UflpaExposureT[] = [];
  const screenUflpaDirect = (name: string, kind: "importer" | "supplier"): UflpaExposureT[] => {
    const matches = bestMatches(name, data.uflpa);
    return matches.slice(0, 1).map<UflpaExposureT>((m) => ({
      party_name: name,
      party_kind: kind,
      exposure_kind: "direct_list_match",
      region_or_sector: `${m.entry.city}, ${m.entry.province} (${m.entry.sector})`,
      confidence: m.quality === "exact" ? "high" : m.quality === "fuzzy" ? "medium" : "low",
      citation: {
        source: "UFLPA Entity List",
        source_id: m.entry.id,
        source_date: data.sources.find((s) => s.name === "UFLPA Entity List")!.last_refreshed,
        quote: `${m.entry.name} — ${m.entry.sublist}, added ${m.entry.added_date}`,
      },
      recommended_action:
        "BLOCKING — UFLPA rebuttable presumption applies. Goods may be excluded under 19 USC §1307 unless the importer rebuts with clear-and-convincing evidence the goods were not made with forced labor.",
    }));
  };
  uflpa_exposure.push(...screenUflpaDirect(importer, "importer"));
  for (const s of suppliers) uflpa_exposure.push(...screenUflpaDirect(s.name, "supplier"));

  // Region: any supplier whose city/province matches XUAR or a labor-transfer
  // destination. Avoid duplicating direct-list matches.
  const xuarLower = data.uflpa_regions.xuar_cities.map((c) => c.toLowerCase());
  const transferLower = data.uflpa_regions.labor_transfer_cities.map((c) => c.toLowerCase());
  for (const s of suppliers) {
    const haystack = [s.city, s.province, s.address].filter(Boolean).join(" ").toLowerCase();
    if (!haystack) continue;
    const xuarHit = xuarLower.find((c) => haystack.includes(c));
    const transferHit = !xuarHit ? transferLower.find((c) => haystack.includes(c)) : null;
    if (!xuarHit && !transferHit) continue;
    // Skip if we already have a direct list match for this supplier.
    if (uflpa_exposure.some((u) => u.party_name === s.name && u.exposure_kind === "direct_list_match")) continue;
    const region = xuarHit ?? transferHit!;
    uflpa_exposure.push({
      party_name: s.name,
      party_kind: "supplier",
      exposure_kind: "region",
      region_or_sector: `${s.city}, ${s.province} (XUAR scrutiny region)`,
      confidence: "high",
      citation: {
        source: "UFLPA Region Scrutiny",
        source_id: region,
        source_date: data.uflpa_regions.last_updated,
        quote: `Address in ${s.city ?? s.province} — region subject to UFLPA scrutiny per CBP UFLPA Operational Guidance.`,
      },
      recommended_action:
        "REVIEW — Supplier address falls within XUAR or a documented labor-transfer destination. Request supply-chain documentation (mill test certificates, payroll, transport records) before filing.",
    });
  }

  // ── 3. AD/CVD: any case whose (hts_8, country) matches a filed line ─────
  const seenCase = new Set<string>();
  const add_cvd_active_cases: AddCvdCaseT[] = [];
  const addCvdDate = addcvd.last_updated;
  for (const e of input.entries) {
    for (const li of e.line_items) {
      const hts8 = li.hts_code_as_filed.slice(0, 7); // dotted "XXXX.XX"
      for (const c of addcvd.cases) {
        if (c.hts_8 === hts8 && c.country === e.country_of_origin) {
          const key = `${c.case_number}|${hts8}|${c.country}`;
          if (seenCase.has(key)) continue;
          seenCase.add(key);
          add_cvd_active_cases.push({
            hts_code_8: hts8,
            country: c.country,
            case_number: c.case_number,
            product_description: c.product,
            margin_pct: c.margin_pct,
            confidence: "high",
            citation: {
              source: "Entity Graph",
              source_id: c.case_number,
              source_date: addCvdDate,
              quote: `${c.type} case ${c.case_number}: ${c.product} from ${c.country}, ${c.margin_pct}% cash-deposit rate.`,
            },
            recommended_action: `REVIEW — Active ${c.type} order may apply at ${c.margin_pct}% on this HTS line. Confirm scope; an entry filed without the AD/CVD case number may be subject to retroactive duty.`,
          });
        }
      }
    }
  }

  // ── 4. Entity graph anomalies ──────────────────────────────────────────
  const entity_anomalies: EntityAnomalyT[] = [];
  // Anomaly: country concentration ≥ 90% of value through one country.
  const valueByCountry = new Map<string, number>();
  let totalValue = 0;
  for (const e of input.entries) {
    const v = e.line_items.reduce((a, li) => a + li.total_value_usd_cents, 0);
    totalValue += v;
    valueByCountry.set(e.country_of_origin, (valueByCountry.get(e.country_of_origin) ?? 0) + v);
  }
  for (const [c, v] of valueByCountry) {
    if (totalValue > 0 && v / totalValue >= 0.9 && valueByCountry.size >= 1 && totalValue >= 100_000_00) {
      entity_anomalies.push({
        kind: "country_concentration",
        description: `${(v / totalValue * 100).toFixed(0)}% of the importer's filing value (≈ $${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}) is single-sourced from ${c}.`,
        parties_involved: [importer, c],
        confidence: "high",
        citation: {
          source: "Entity Graph",
          source_id: `concentration:${c}`,
          source_date: new Date().toISOString().slice(0, 10),
          quote: `Entries: ${input.entries.length}; total value: $${(totalValue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}; ${c}: $${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
        },
        recommended_action: "REVIEW — Single-country concentration is a tariff-shock exposure; consider mapping a sourcing alternative in the Policy Lab.",
      });
    }
  }

  // Anomaly: shared address — two suppliers share a city + a substring of
  // address (proxy for "same office").
  const byAddrKey = new Map<string, string[]>();
  for (const s of suppliers) {
    const key = `${(s.city ?? "").toLowerCase()}|${(s.address ?? "").toLowerCase().slice(0, 20)}`;
    if (!s.address || !s.city) continue;
    byAddrKey.set(key, [...(byAddrKey.get(key) ?? []), s.name]);
  }
  for (const [, names] of byAddrKey) {
    if (names.length < 2) continue;
    entity_anomalies.push({
      kind: "shared_address",
      description: `${names.length} suppliers list overlapping address prefixes — possible related parties.`,
      parties_involved: names,
      confidence: "medium",
      citation: {
        source: "Entity Graph",
        source_id: `shared-addr:${names.join("|")}`,
        source_date: new Date().toISOString().slice(0, 10),
        quote: `Suppliers sharing an address prefix may be the same operating entity using multiple trade names.`,
      },
      recommended_action: "REVIEW — Verify these are independent suppliers; if related, single-entity transfer-pricing rules may apply.",
    });
  }

  // ── 5. Headline + overall status ───────────────────────────────────────
  const blockingHits = sanctions_hits.filter((h) => h.match_quality === "exact").length
    + uflpa_exposure.filter((u) => u.exposure_kind === "direct_list_match" && u.confidence === "high").length;
  const reviewItems = sanctions_hits.length - blockingHits
    + uflpa_exposure.filter((u) => u.exposure_kind !== "direct_list_match").length
    + add_cvd_active_cases.length
    + entity_anomalies.length;
  const overall: RiskProfileT["overall_status"] = blockingHits > 0 ? "blocking" : reviewItems > 0 ? "review_required" : "clean";

  const xuarSupplierCount = uflpa_exposure.filter((u) => u.exposure_kind === "region").length;
  const headline = (() => {
    const parts: string[] = [];
    parts.push(`Screened ${1 + suppliers.length} parties against OFAC SDN, BIS Entity List, and UFLPA`);
    parts.push(blockingHits === 0 && uflpa_exposure.filter((u) => u.exposure_kind === "direct_list_match").length === 0
      ? "no direct list matches"
      : `${blockingHits} blocking match(es)`);
    if (xuarSupplierCount > 0) parts.push(`${xuarSupplierCount} supplier(s) in regions under heightened UFLPA scrutiny (broker should request supply-chain documentation)`);
    if (add_cvd_active_cases.length > 0) parts.push(`${add_cvd_active_cases.length} active AD/CVD case(s) touching filed HTS lines`);
    return parts.join("; ") + ".";
  })();

  const sources_used: RiskProfileT["sources_used"] = [
    ...data.sources,
    { name: "AD/CVD Active Cases", rows: addcvd.cases.length, last_refreshed: addCvdDate },
    { name: "UFLPA Region Scrutiny", rows: data.uflpa_regions.xuar_cities.length, last_refreshed: data.uflpa_regions.last_updated },
  ];

  return {
    importer,
    screened_at: new Date().toISOString(),
    parties_screened: {
      importer_name: importer,
      importer_ein: importerEin,
      supplier_names: suppliers.map((s) => s.name),
    },
    sources_used,
    sanctions_hits,
    uflpa_exposure,
    add_cvd_active_cases,
    entity_anomalies,
    headline,
    overall_status: overall,
  };
}

// Thin wrapper so the agent can be called from routes the same way the
// other agents are (takes AppContext, returns the profile). For now ctx is
// unused — the screen is fully local — but the signature keeps us future-
// proof when we move the lists into a vector store / D1.
export async function screenRisk(_ctx: AppContext, input: HistoricalEntriesT): Promise<RiskProfileT> {
  return runRiskScreen(input);
}

// Re-export citation type so callers don't import from two places.
export type { RiskCitationT };
