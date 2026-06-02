// Schema for the risk-screener agent's output.
//
// The screener checks every party named on an entry — importer + suppliers —
// against three publicly-available federal lists (OFAC SDN, BIS Entity List,
// UFLPA), and runs two structural checks: country-of-origin in UFLPA
// scrutiny regions, and an entity-graph anomaly scan. Each finding carries a
// citation that points back to the underlying public source and a confidence
// (exact / fuzzy / partial).

import { z } from "zod";

export const RiskCitation = z.object({
  /** The public list this finding came from. */
  source: z.enum([
    "OFAC SDN",
    "BIS Entity List",
    "UFLPA Entity List",
    "UFLPA Region Scrutiny",
    "Entity Graph",
  ]),
  /** Stable identifier within the source list (OFAC SDN UID, BIS docket id,
   *  UFLPA entry number, or a deterministic hash for derived findings). */
  source_id: z.string(),
  /** ISO date the source dataset was last refreshed. */
  source_date: z.string(),
  /** Free-text quote / row dump from the source that supports the finding. */
  quote: z.string(),
});
export type RiskCitationT = z.infer<typeof RiskCitation>;

export const SanctionsHit = z.object({
  /** The party from the importer's data that triggered the match. */
  party_name: z.string(),
  party_kind: z.enum(["importer", "supplier"]),
  /** Matched entity name as it appears in the list. */
  matched_name: z.string(),
  match_quality: z.enum(["exact", "fuzzy", "partial"]),
  /** Jaccard / Levenshtein similarity, 0–1. */
  similarity: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  citation: RiskCitation,
  /** One-sentence broker-facing explanation. */
  recommended_action: z.string(),
});
export type SanctionsHitT = z.infer<typeof SanctionsHit>;

export const UflpaExposure = z.object({
  party_name: z.string(),
  party_kind: z.enum(["importer", "supplier"]),
  /** "direct" = on the UFLPA Entity List. "region" = address in XUAR or a
   *  sector-of-concern with scrutiny presumption. */
  exposure_kind: z.enum(["direct_list_match", "region", "sector"]),
  region_or_sector: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  citation: RiskCitation,
  recommended_action: z.string(),
});
export type UflpaExposureT = z.infer<typeof UflpaExposure>;

export const AddCvdCase = z.object({
  /** 8-digit HTS code the case targets. */
  hts_code_8: z.string(),
  /** Country of origin the case applies to. */
  country: z.string(),
  case_number: z.string(),
  product_description: z.string(),
  /** Both the AD and CVD rate if both apply, as published cash-deposit rates. */
  margin_pct: z.number().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  citation: RiskCitation,
  recommended_action: z.string(),
});
export type AddCvdCaseT = z.infer<typeof AddCvdCase>;

export const EntityAnomaly = z.object({
  kind: z.enum([
    "shared_address",
    "shared_principal",
    "supplier_serves_multiple_importers",
    "country_concentration",
  ]),
  description: z.string(),
  parties_involved: z.array(z.string()).min(2),
  confidence: z.enum(["high", "medium", "low"]),
  citation: RiskCitation,
  recommended_action: z.string(),
});
export type EntityAnomalyT = z.infer<typeof EntityAnomaly>;

export const RiskProfile = z.object({
  importer: z.string(),
  screened_at: z.string(),
  parties_screened: z.object({
    importer_name: z.string(),
    importer_ein: z.string().nullable(),
    supplier_names: z.array(z.string()),
  }),
  sources_used: z.array(z.object({
    name: z.string(),
    rows: z.number().int().nonnegative(),
    last_refreshed: z.string(),
  })),
  sanctions_hits: z.array(SanctionsHit),
  uflpa_exposure: z.array(UflpaExposure),
  add_cvd_active_cases: z.array(AddCvdCase),
  entity_anomalies: z.array(EntityAnomaly),
  /** Summary line for the demo banner / report subtitle. */
  headline: z.string(),
  overall_status: z.enum(["clean", "review_required", "blocking"]),
});
export type RiskProfileT = z.infer<typeof RiskProfile>;
