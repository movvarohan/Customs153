"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
      const r = await fetch(`${API_BASE_URL}/api/audit-log?limit=80`, { cache: "no-store" });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      const j = (await r.json()) as { records: Record_[] };
      setRecords(j.records);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    if (!records) return null;
    const models = new Set(records.map((r) => r.model).filter(Boolean));
    const prompts = new Set(records.map((r) => r.prompt_version).filter(Boolean));
    const cited = records.reduce((a, r) => a + r.citations.length, 0);
    const grounded = records.filter((r) => r.citations.length > 0).length;
    return {
      total: records.length,
      models: [...models],
      prompts: [...prompts],
      cited,
      groundedPct: records.length ? Math.round((grounded / records.length) * 100) : 0,
    };
  }, [records]);

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-card border border-cardline bg-navy text-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-50">
              <ShieldIcon />
              Immutable ledger · reasonable care
            </div>
            <h1 className="text-3xl font-bold">Audit trail</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/70">
              Every classification is written once, with its timestamp, model and prompt version, the GRI
              rule applied, confidence, and cited sources. This is the binder you hand CBP if they open a
              focused assessment — each decision is reproducible from the record.
            </p>
          </div>
          <button
            onClick={load}
            className="shrink-0 rounded-md border border-white/20 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15"
          >
            Refresh
          </button>
        </div>
        {stats && (
          <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
            <LedgerStat label="Records logged" value={String(stats.total)} />
            <LedgerStat label="Citation grounding" value={`${stats.groundedPct}%`} />
            <LedgerStat label="Sources cited" value={String(stats.cited)} />
            <LedgerStat label="Model / prompt" value={`${stats.models.length}·${stats.prompts.length}`} sub={stats.models.join(", ")} />
          </div>
        )}
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {records && records.length === 0 && (
        <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
          No classifications logged yet. Run a shipment on Process invoice or Find refunds and records
          appear here.
        </div>
      )}

      {records && records.length > 0 && (
        <div className="space-y-2">
          {records.map((r) => {
            const open = openId === r.id;
            const accent =
              r.confidence === "high" ? "border-l-accent" : r.confidence === "medium" ? "border-l-navy-300" : "border-l-amber-400";
            return (
              <div
                key={r.id}
                className={classNames(
                  "overflow-hidden rounded-card border border-cardline border-l-4 bg-white shadow-card transition",
                  accent,
                )}
              >
                <button
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-navy-50/40"
                >
                  <span className="font-mono text-[10px] text-muted">{r.id.slice(0, 8)}</span>
                  <span className="w-36 shrink-0 font-mono text-sm font-semibold text-navy">{r.hts_code ?? "—"}</span>
                  <span className="hidden shrink-0 sm:inline">
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
                  </span>
                  <span className="hidden flex-1 truncate text-[11px] text-muted md:inline">
                    GRI {r.gri_rule_applied ?? "—"} · {r.citations.length} cited · {r.candidate_count} considered
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">
                    {r.occurred_at.replace("T", " ").slice(0, 19)}Z
                  </span>
                  <span className={classNames("shrink-0 text-muted transition", open && "rotate-90")}>›</span>
                </button>
                {open && (
                  <div className="border-t border-cardline bg-navy-50/40 px-4 py-4">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-3">
                        <div>
                          <FieldLabel>Record</FieldLabel>
                          <dl className="mt-1 space-y-1 text-[11px]">
                            <Row k="Audit ID" v={r.id} mono />
                            <Row k="Logged at" v={`${r.occurred_at.replace("T", " ").slice(0, 19)} UTC`} mono />
                            <Row k="Actor" v={r.actor} mono />
                            <Row k="Model" v={r.model ?? "—"} />
                            <Row k="Prompt" v={r.prompt_version ?? "—"} mono />
                            <Row k="GRI rule" v={r.gri_rule_applied ?? "—"} />
                            <Row k="Precision" v={r.precision_level ?? "—"} />
                            <Row k="Top retrieved" v={r.top_candidate ?? "—"} mono />
                            {r.validation_warning && <Row k="Warning" v={r.validation_warning} warn />}
                          </dl>
                        </div>
                        <div>
                          <FieldLabel>Cited sources ({r.citations.length})</FieldLabel>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.citations.length === 0 && <span className="text-[11px] text-muted">none</span>}
                            {r.citations.map((c, k) => (
                              <span key={k} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-navy ring-1 ring-inset ring-cardline">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Reasoning trace</FieldLabel>
                        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-cardline bg-white p-3">
                          <p className="whitespace-pre-line text-[11px] leading-relaxed text-navy">
                            {r.reasoning ?? "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LedgerStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-navy px-5 py-4">
      <div className="text-[10px] uppercase tracking-widest text-white/50">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{children}</div>;
}

function Row({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{k}</dt>
      <dd className={classNames(warn ? "text-warn" : "text-navy", mono && "break-all font-mono")}>{v}</dd>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
