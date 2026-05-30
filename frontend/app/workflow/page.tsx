"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE_URL, classNames } from "@/lib/api";

type ActionType = "auto_fire" | "approval" | "passive";
interface WAction { type: ActionType; label: string; owner: string; filing_type?: "isf" | "entry" }
interface WShipment {
  id: string; supplier: string; product: string; route: string; eta: string;
  stage_key: string; action: WAction;
  isf_filing: { id: string; status: string } | null;
  entry_filing: { id: string; status: string } | null;
}
interface Filing { id: string; shipment_ref: string; type: string; status: string; title: string }
interface Stage { key: string; label: string }
interface WorkflowState {
  stages: Stage[];
  stage_counts: Record<string, number>;
  shipments: WShipment[];
  summary: { auto_fireable: number; awaiting_approval: number; in_motion: number };
  pending_filings: Filing[];
}
interface Fired { shipment_ref: string; type: "isf" | "entry"; title: string; readiness_pct: number }
interface RunRecord { at: string; fired: number; items: { shipment_ref: string; type: string }[] }
interface Sched { enabled: boolean; interval_seconds: number; last_run_at: string | null; next_run_at: string | null; history: RunRecord[] }

export default function WorkflowPage() {
  const [w, setW] = useState<WorkflowState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [fired, setFired] = useState<Fired[] | null>(null);
  const [sched, setSched] = useState<Sched | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/workflow`, { cache: "no-store" });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      setW(await r.json());
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  const loadSched = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/workflow/scheduler`, { cache: "no-store" });
      if (r.ok) setSched(await r.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); loadSched(); }, [load, loadSched]);
  // Poll so the board + auto-pilot status reflect background runs live.
  useEffect(() => {
    const id = setInterval(() => { void load(); void loadSched(); }, 4000);
    return () => clearInterval(id);
  }, [load, loadSched]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleSched = async () => {
    if (!sched) return;
    const r = await fetch(`${API_BASE_URL}/api/workflow/scheduler`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !sched.enabled }),
    });
    if (r.ok) setSched(await r.json());
  };

  const run = async () => {
    setRunning(true); setFired(null); setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/workflow/run`, { method: "POST" });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      const j = await r.json();
      setFired(j.fired ?? []);
      setW(j.state);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const approve = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/filings/${id}/approve`, { method: "POST" });
    await load();
  };

  const s = w?.summary;
  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Workflow
        </div>
        <h1 className="text-3xl font-bold text-navy">Shipment lifecycle pipeline</h1>
        <p className="mt-2 max-w-2xl text-muted">
          The whole lifecycle as one conveyor: ingest → ISF → entry → broker review → file → liquidation/PSC.
          The orchestrator auto-drafts each ISF and 7501 the moment its milestone comes due and routes it to the
          broker queue — so the only human steps left are the approvals.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {/* Conveyor */}
      {w && (
        <div className="overflow-x-auto rounded-card border border-cardline bg-white p-4 shadow-card">
          <div className="flex min-w-max items-stretch gap-1">
            {w.stages.map((st, i) => {
              const n = w.stage_counts[st.key] ?? 0;
              return (
                <div key={st.key} className="flex items-center">
                  <div className={classNames("min-w-[120px] rounded-md border px-3 py-2 text-center", n > 0 ? "border-accent/50 bg-accent-50/40" : "border-cardline bg-white")}>
                    <div className="text-[10px] uppercase tracking-wider text-muted">{st.label}</div>
                    <div className={classNames("text-2xl font-bold tabular-nums", n > 0 ? "text-accent-700" : "text-navy-200")}>{n}</div>
                  </div>
                  {i < w.stages.length - 1 && <span className="px-1 text-cardline">→</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Auto-pilot */}
      {sched && (
        <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSched}
                role="switch"
                aria-checked={sched.enabled}
                className={classNames("relative inline-flex h-6 w-11 items-center rounded-full transition", sched.enabled ? "bg-accent" : "bg-navy-100")}
              >
                <span className={classNames("inline-block h-4 w-4 transform rounded-full bg-white transition", sched.enabled ? "translate-x-6" : "translate-x-1")} />
              </button>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-navy">
                  {sched.enabled && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />}
                  Auto-pilot {sched.enabled ? "on" : "off"}
                </div>
                <div className="text-[11px] text-muted">
                  {sched.enabled ? (
                    <>Fires the pipeline every {sched.interval_seconds}s automatically · {sched.last_run_at ? `last run ${rel(sched.last_run_at, now)}` : "first run pending"}{sched.next_run_at ? ` · next in ${countdown(sched.next_run_at, now)}` : ""}</>
                  ) : (
                    <>Paused — drafts won&apos;t fire until you turn it back on or click Run automation.</>
                  )}
                </div>
              </div>
            </div>
            {sched.history.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sched.history.slice(0, 4).map((r, i) => (
                  <span key={i} className={classNames("rounded-full border px-2 py-0.5 text-[10px]", r.fired > 0 ? "border-accent/40 bg-accent-50/40 text-accent-700" : "border-cardline text-muted")}>
                    {r.at.slice(11, 19)} · {r.fired > 0 ? `fired ${r.fired}` : "up to date"}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Run automation */}
      {s && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-cardline bg-white p-4 shadow-card">
          <button onClick={run} disabled={running || s.auto_fireable === 0}
            className={classNames("rounded-md px-4 py-2 text-sm font-semibold transition",
              s.auto_fireable > 0 && !running ? "bg-accent text-white hover:bg-accent-700" : "cursor-not-allowed bg-navy-100 text-muted")}>
            {running ? "Running pipeline…" : s.auto_fireable > 0 ? `Run automation — auto-draft ${s.auto_fireable} filing${s.auto_fireable === 1 ? "" : "s"}` : "Nothing due to auto-draft"}
          </button>
          <span className="text-[12px] text-muted">
            {s.auto_fireable} ready to auto-draft · {s.awaiting_approval} awaiting broker approval · {s.in_motion} moving
          </span>
        </div>
      )}

      {fired && (
        <div className="rounded-card border border-accent/40 bg-accent-50/30 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-700">Pipeline run complete</div>
          {fired.length === 0 ? (
            <p className="mt-1 text-sm text-navy">No filings were due — everything is already drafted or in motion.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm text-navy">
              {fired.map((f, i) => (
                <li key={i}>✓ Auto-drafted <span className="font-semibold">{f.type.toUpperCase()}</span> for {f.title} ({f.readiness_pct}% ready) → routed to broker review</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Approval gates */}
      {w && w.pending_filings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">Human approvals needed ({w.pending_filings.length})</h2>
          <div className="space-y-2">
            {w.pending_filings.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-accent/50 bg-white px-4 py-3 shadow-card">
                <div className="min-w-0">
                  <span className="text-sm text-navy">{f.title}</span>
                  <span className="ml-2 text-[11px] uppercase tracking-wider text-muted">{f.type} · {f.shipment_ref}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/broker" className="text-[11px] font-semibold text-accent-700 hover:underline">Open in broker queue</Link>
                  <button onClick={() => approve(f.id)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700">Approve</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-shipment pipeline rows */}
      {w && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">Shipments in the pipeline ({w.shipments.length})</h2>
          <div className="overflow-hidden rounded-card border border-cardline bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-2.5 pl-4">Shipment</th><th className="py-2.5">Stage</th>
                  <th className="py-2.5">Next step</th><th className="py-2.5 pr-4">Owner</th>
                </tr>
              </thead>
              <tbody>
                {w.shipments.map((sh, i) => (
                  <tr key={sh.id} className={classNames("border-b border-cardline/60 last:border-b-0", i % 2 === 1 && "bg-navy-50/30")}>
                    <td className="py-2.5 pl-4">
                      <div className="font-mono text-[12px] text-navy">{sh.id}</div>
                      <div className="text-[11px] text-muted">{sh.supplier} · {sh.route}</div>
                    </td>
                    <td className="py-2.5"><span className="rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy">{stageLabel(w.stages, sh.stage_key)}</span></td>
                    <td className="py-2.5"><ActionBadge a={sh.action} /></td>
                    <td className="py-2.5 pr-4 text-[12px] text-muted">{sh.action.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-[11px] italic text-muted">
        Auto-drafting (ISF/7501 assembly + routing) is deterministic and instant — the model isn&apos;t in this loop.
        A licensed broker approves every filing before it&apos;s submitted; liquidation/PSC tracking continues in Deadlines.
      </p>
    </div>
  );
}

function ActionBadge({ a }: { a: WAction }) {
  if (a.type === "auto_fire") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{a.label}</span>;
  if (a.type === "approval") return <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">{a.label}</span>;
  return <span className="text-[12px] text-muted">{a.label}</span>;
}

function stageLabel(stages: Stage[], key: string): string {
  return stages.find((s) => s.key === key)?.label ?? key;
}

function rel(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  return `${m}m ${secs % 60}s ago`;
}
function countdown(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  return `${secs}s`;
}
