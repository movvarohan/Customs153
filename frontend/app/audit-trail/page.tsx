"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames } from "@/lib/api";

interface Record_ {
  id: string;
  occurred_at: string;
  actor: string;
  model: string | null;
  prompt_version: string | null;
  hts_code: string | null;
  hts_code_8: string | null;
  gri_rule_applied: string | null;
  confidence: "low" | "medium" | "high" | null;
  precision_level: string | null;
  citations: string[];
  validation_warning: string | null;
  candidate_count: number;
  top_candidate: string | null;
  reasoning: string | null;
}

export default function AuditTrailPage() {
  const [records, setRecords] = useState<Record_[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/audit-log?limit=60`, { cache: "no-store" });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      const j = (await r.json()) as { records: Record_[] };
      setRecords(j.records);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-navy-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-navy">
          Reasonable-care binder
        </div>
        <h1 className="text-3xl font-bold text-navy">Audit trail</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Every classification is logged immutably with its timestamp, model and prompt version, the GRI
          rule applied, confidence, cited sources, and how many candidates were considered. This is the
          record you hand CBP if they open a focused assessment.
        </p>
        <button
          onClick={load}
          className="mt-3 rounded-md border border-cardline bg-white px-3.5 py-1.5 text-xs font-semibold text-navy shadow-sm transition hover:border-navy/40"
        >
          Refresh
        </button>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {records && records.length === 0 && (
        <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
          No classifications logged yet. Run a shipment on Process invoice or Find refunds and the records
          appear here.
        </div>
      )}

      {records && records.length > 0 && (
        <div className="overflow-hidden rounded-card border border-cardline bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2.5 pl-4">Timestamp (UTC)</th>
                <th className="py-2.5">HTS</th>
                <th className="py-2.5">GRI</th>
                <th className="py-2.5">Conf.</th>
                <th className="py-2.5">Model / prompt</th>
                <th className="py-2.5 pr-4">Sources</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const open = openId === r.id;
                return (
                  <>
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(open ? null : r.id)}
                      className={classNames(
                        "cursor-pointer border-b border-cardline/60 align-top transition-colors last:border-b-0 hover:bg-accent-50/40",
                        i % 2 === 1 && "bg-navy-50/30",
                      )}
                    >
                      <td className="py-2.5 pl-4 font-mono text-[11px] text-muted">{r.occurred_at.replace("T", " ").slice(0, 19)}</td>
                      <td className="py-2.5 font-mono text-navy">{r.hts_code ?? "—"}</td>
                      <td className="py-2.5 tabular-nums text-muted">{r.gri_rule_applied ?? "—"}</td>
                      <td className="py-2.5">
                        {r.confidence && (
                          <span
                            className={classNames(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              r.confidence === "high" && "bg-accent text-white",
                              r.confidence === "medium" && "bg-navy-100 text-navy",
                              r.confidence === "low" && "bg-amber-100 text-amber-800",
                            )}
                          >
                            {r.confidence}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-[11px] text-muted">
                        {r.model} · {r.prompt_version}
                      </td>
                      <td className="py-2.5 pr-4 text-[11px] text-muted">
                        {r.citations.length} cited · {r.candidate_count} considered
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${r.id}-d`} className="border-b border-cardline bg-navy-50/40">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Record</div>
                              <dl className="mt-1 space-y-0.5 text-[11px]">
                                <Row k="Audit ID" v={r.id} mono />
                                <Row k="Actor" v={r.actor} mono />
                                <Row k="Precision level" v={r.precision_level ?? "—"} />
                                <Row k="Top retrieved" v={r.top_candidate ?? "—"} mono />
                                {r.validation_warning && <Row k="Warning" v={r.validation_warning} warn />}
                              </dl>
                              <div className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                                Cited sources
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {r.citations.map((c, k) => (
                                  <span key={k} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-navy">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Reasoning trace</div>
                              <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-navy">
                                {r.reasoning ?? "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{k}</dt>
      <dd className={classNames(warn ? "text-warn" : "text-navy", mono && "font-mono break-all")}>{v}</dd>
    </div>
  );
}
