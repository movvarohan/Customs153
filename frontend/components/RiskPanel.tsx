"use client";

import { classNames } from "@/lib/api";

export interface RiskCitation {
  source: "OFAC SDN" | "BIS Entity List" | "UFLPA Entity List" | "UFLPA Region Scrutiny" | "Entity Graph";
  source_id: string;
  source_date: string;
  quote: string;
}

export interface RiskProfile {
  importer: string;
  screened_at: string;
  parties_screened: { importer_name: string; importer_ein: string | null; supplier_names: string[] };
  sources_used: Array<{ name: string; rows: number; last_refreshed: string }>;
  sanctions_hits: Array<{ party_name: string; party_kind: "importer" | "supplier"; matched_name: string; match_quality: "exact" | "fuzzy" | "partial"; similarity: number; confidence: "low" | "medium" | "high"; citation: RiskCitation; recommended_action: string }>;
  uflpa_exposure: Array<{ party_name: string; party_kind: "importer" | "supplier"; exposure_kind: "direct_list_match" | "region" | "sector"; region_or_sector: string; confidence: "low" | "medium" | "high"; citation: RiskCitation; recommended_action: string }>;
  add_cvd_active_cases: Array<{ hts_code_8: string; country: string; case_number: string; product_description: string; margin_pct: number | null; confidence: "low" | "medium" | "high"; citation: RiskCitation; recommended_action: string }>;
  entity_anomalies: Array<{ kind: "shared_address" | "shared_principal" | "supplier_serves_multiple_importers" | "country_concentration"; description: string; parties_involved: string[]; confidence: "low" | "medium" | "high"; citation: RiskCitation; recommended_action: string }>;
  headline: string;
  overall_status: "clean" | "review_required" | "blocking";
}

export function RiskPanel({ risk }: { risk: RiskProfile }) {
  const status = risk.overall_status;
  const banner =
    status === "clean"
      ? { color: "bg-accent text-white", label: "CLEAN" }
      : status === "review_required"
      ? { color: "bg-amber-500 text-white", label: "REVIEW REQUIRED" }
      : { color: "bg-warn text-white", label: "BLOCKING" };

  return (
    <section className="mb-8">
      <div className="rounded-card border border-cardline bg-white shadow-card">
        <div className={classNames("flex flex-wrap items-center gap-3 rounded-t-card px-5 py-3", banner.color)}>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest">{banner.label}</span>
          <span className="text-sm font-medium">Risk &amp; compliance screen</span>
          <span className="ml-auto text-[11px] opacity-80">screened {new Date(risk.screened_at).toLocaleString()}</span>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-navy">{risk.headline}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RiskTile
              label="Sanctions (OFAC SDN + BIS)"
              kind={risk.sanctions_hits.length === 0 ? "clean" : "warn"}
              value={risk.sanctions_hits.length === 0 ? "Clean" : `${risk.sanctions_hits.length} match${risk.sanctions_hits.length === 1 ? "" : "es"}`}
              hint={`${risk.parties_screened.supplier_names.length + 1} parties screened`}
            />
            <RiskTile
              label="UFLPA exposure"
              kind={risk.uflpa_exposure.length === 0 ? "clean" : risk.uflpa_exposure.some((u) => u.exposure_kind === "direct_list_match") ? "block" : "warn"}
              value={risk.uflpa_exposure.length === 0 ? "None" : `${risk.uflpa_exposure.length} flag${risk.uflpa_exposure.length === 1 ? "" : "s"}`}
              hint={
                risk.uflpa_exposure.length === 0
                  ? "DHS Entity List + XUAR region"
                  : `${risk.uflpa_exposure.filter((u) => u.exposure_kind === "region").length} region · ${risk.uflpa_exposure.filter((u) => u.exposure_kind === "direct_list_match").length} direct`
              }
            />
            <RiskTile
              label="AD/CVD active cases"
              kind={risk.add_cvd_active_cases.length === 0 ? "clean" : "warn"}
              value={risk.add_cvd_active_cases.length === 0 ? "None" : `${risk.add_cvd_active_cases.length} case${risk.add_cvd_active_cases.length === 1 ? "" : "s"}`}
              hint="USITC + DOC ITA tracker"
            />
            <RiskTile
              label="Entity-graph anomalies"
              kind={risk.entity_anomalies.length === 0 ? "clean" : "warn"}
              value={risk.entity_anomalies.length === 0 ? "None" : `${risk.entity_anomalies.length} finding${risk.entity_anomalies.length === 1 ? "" : "s"}`}
              hint="concentration · shared address"
            />
          </div>

          {risk.sanctions_hits.length > 0 && (
            <RiskList title="Sanctions hits">
              {risk.sanctions_hits.map((h, i) => (
                <RiskRow
                  key={i}
                  kind={h.match_quality === "exact" ? "block" : "warn"}
                  title={`${h.party_name} → ${h.matched_name}`}
                  meta={`${h.citation.source} #${h.citation.source_id} · ${h.match_quality} match (${(h.similarity * 100).toFixed(0)}%) · refreshed ${h.citation.source_date}`}
                  body={h.recommended_action}
                />
              ))}
            </RiskList>
          )}

          {risk.uflpa_exposure.length > 0 && (
            <RiskList title="UFLPA exposure">
              {risk.uflpa_exposure.map((u, i) => (
                <RiskRow
                  key={i}
                  kind={u.exposure_kind === "direct_list_match" ? "block" : "warn"}
                  title={`${u.party_name} — ${u.region_or_sector}`}
                  meta={`${u.citation.source} · ${u.citation.quote} · refreshed ${u.citation.source_date}`}
                  body={u.recommended_action}
                />
              ))}
            </RiskList>
          )}

          {risk.add_cvd_active_cases.length > 0 && (
            <RiskList title="Active AD/CVD cases">
              {risk.add_cvd_active_cases.map((c, i) => (
                <RiskRow
                  key={i}
                  kind="warn"
                  title={`HTS ${c.hts_code_8} from ${c.country} — case ${c.case_number}${c.margin_pct != null ? ` (${c.margin_pct}%)` : ""}`}
                  meta={c.product_description}
                  body={c.recommended_action}
                />
              ))}
            </RiskList>
          )}

          {risk.entity_anomalies.length > 0 && (
            <RiskList title="Entity-graph anomalies">
              {risk.entity_anomalies.map((a, i) => (
                <RiskRow
                  key={i}
                  kind="warn"
                  title={a.description}
                  meta={`Parties: ${a.parties_involved.join("; ")}`}
                  body={a.recommended_action}
                />
              ))}
            </RiskList>
          )}

          <div className="rounded-md bg-navy-50/50 px-3 py-2 text-[11px] text-muted">
            <span className="font-semibold text-navy">Sources:</span>{" "}
            {risk.sources_used.map((s) => `${s.name} (${s.rows.toLocaleString()} rows, refreshed ${s.last_refreshed})`).join(" · ")}
          </div>
          <p className="text-[11px] italic text-muted">
            Every item in this section requires licensed-broker review before any filing or sourcing decision.
            customs-agent is not a licensed customs broker; this is decision-support for the broker partner.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Compact one-line summary suitable for embedding inside other pages. */
export function RiskBadge({ risk, href }: { risk: RiskProfile; href?: string }) {
  const banner =
    risk.overall_status === "clean"
      ? { color: "border-accent/40 bg-accent-50/40 text-accent-700", label: "CLEAN" }
      : risk.overall_status === "blocking"
      ? { color: "border-warn/50 bg-warn/10 text-warn", label: "BLOCKING" }
      : { color: "border-amber-400/50 bg-amber-50 text-amber-800", label: "REVIEW" };
  const body = (
    <div className={classNames("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2", banner.color)}>
      <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">{banner.label}</span>
      <span className="text-[12px] font-medium">Risk &amp; compliance</span>
      <span className="text-[11px] opacity-80">{risk.headline}</span>
      {href && <span className="ml-auto text-[11px] underline">View detail →</span>}
    </div>
  );
  return href ? <a href={href}>{body}</a> : body;
}

function RiskTile({ label, value, hint, kind }: { label: string; value: string; hint: string; kind: "clean" | "warn" | "block" }) {
  const border = kind === "clean" ? "border-accent/40" : kind === "warn" ? "border-amber-400/60" : "border-warn/60";
  const valueColor = kind === "clean" ? "text-accent-700" : kind === "warn" ? "text-amber-700" : "text-warn";
  return (
    <div className={classNames("rounded-md border bg-white px-3 py-2.5", border)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-0.5 text-lg font-bold", valueColor)}>{value}</div>
      <div className="text-[10px] text-muted">{hint}</div>
    </div>
  );
}

function RiskList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RiskRow({ title, meta, body, kind }: { title: string; meta: string; body: string; kind: "warn" | "block" }) {
  const border = kind === "block" ? "border-warn" : "border-amber-400";
  return (
    <div className={classNames("rounded-md border-l-4 border bg-navy-50/30 px-3 py-2", border)}>
      <div className="text-sm font-semibold text-navy">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted">{meta}</div>
      <div className="mt-1 text-[12px] leading-snug text-navy">{body}</div>
    </div>
  );
}
