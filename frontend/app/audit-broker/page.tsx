"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney, readNDJSON } from "@/lib/api";

interface StepEvent {
  type: "step" | "downloaded" | "done" | "error" | "notice" | "refund_status" | "refund_line" | "refund_done";
  index?: number;
  action?: string;
  narration?: string;
  screenshot_b64?: string;
  portal_path?: string;
  simulated?: boolean;
  filename?: string;
  bytes?: number;
  path?: string;
  entries_downloaded?: number;
  total_ms?: number;
  message?: string;
  total_lines?: number;
  outcome?: { kind: string; recoverable_usd_cents?: number };
  findings?: {
    total_recoverable_usd_cents: number;
    refund_opportunities: Array<{
      entry_number: string;
      line_description: string;
      hts_filed: string;
      hts_predicted: string;
      recoverable_amount_usd_cents: number;
      our_confidence: string;
    }>;
  };
}

export default function AuditBrokerPage() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [latestShot, setLatestShot] = useState<string | null>(null);
  const [portalPath, setPortalPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refundStatus, setRefundStatus] = useState<string | null>(null);
  const [refundProgress, setRefundProgress] = useState<{ done: number; total: number; recoverable: number }>({ done: 0, total: 0, recoverable: 0 });
  const [findings, setFindings] = useState<StepEvent["findings"] | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const run = useCallback(async () => {
    setRunning(true);
    setEvents([]);
    setLatestShot(null);
    setPortalPath(null);
    setNotice(null);
    setErr(null);
    setRefundStatus(null);
    setRefundProgress({ done: 0, total: 0, recoverable: 0 });
    setFindings(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/ace-agent`, { method: "POST" });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      for await (const ev of readNDJSON<StepEvent>(r)) {
        if (ev.type === "step" || ev.type === "downloaded" || ev.type === "done") {
          setEvents((prev) => [...prev, ev]);
        }
        if (ev.type === "step") {
          if (ev.screenshot_b64) setLatestShot(ev.screenshot_b64);
          if (ev.portal_path) setPortalPath(ev.portal_path);
        }
        if (ev.type === "notice") setNotice(ev.message ?? null);
        if (ev.type === "refund_status") {
          setRefundStatus(ev.message ?? null);
          if (typeof ev.total_lines === "number") {
            setRefundProgress((p) => ({ ...p, total: ev.total_lines as number }));
          }
        }
        if (ev.type === "refund_line") {
          setRefundProgress((p) => ({
            done: p.done + 1,
            total: p.total,
            recoverable:
              p.recoverable + (ev.outcome?.kind === "opportunity" ? ev.outcome.recoverable_usd_cents ?? 0 : 0),
          }));
        }
        if (ev.type === "refund_done") {
          setFindings(ev.findings ?? null);
          setRefundStatus(null);
        }
        if (ev.type === "error") {
          setErr(ev.message ?? "unknown error");
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const downloaded = events.filter((e) => e.type === "downloaded");
  const done = events.find((e) => e.type === "done");

  return (
    <div className="space-y-8">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Browser agent
        </div>
        <h1 className="text-3xl font-bold text-navy">Audit my broker</h1>
        <p className="mt-2 max-w-2xl text-muted">
          A real Playwright browser logs into the importer's ACE Importer Portal, pulls the last 12 months
          of entry summaries as PDFs, and feeds them straight into the refund finder. No CSV upload, no
          forwarding emails to broker support. Watch the agent navigate.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={running}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Agent is driving the portal…" : "Audit my broker"}
          </button>
          {done && (
            <span className="text-[11px] text-muted">
              Downloaded {done.entries_downloaded} entries in {((done.total_ms ?? 0) / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <p className="mt-3 text-[11px] italic text-muted">
          The agent operates the ACE Importer Portal the same way a person would — it signs in, navigates the
          entry-summary list, and downloads each 7501. No data entry on your side.
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>
      )}
      {notice && (
        <div className="rounded-md border border-cardline bg-navy-50 px-3 py-2 text-[11px] text-muted">{notice}</div>
      )}

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Live screenshot */}
        <div className="rounded-card border border-cardline bg-white p-3 shadow-card">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            {running && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
            Live agent view
          </div>
          {latestShot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="agent screenshot"
              src={`data:image/png;base64,${latestShot}`}
              className="w-full rounded border border-cardline"
            />
          ) : portalPath ? (
            <iframe
              title="ACE Importer Portal"
              src={`${API_BASE_URL}${portalPath}`}
              className="h-[460px] w-full rounded border border-cardline bg-white"
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded border border-dashed border-cardline text-xs text-muted">
              Click &quot;Audit my broker&quot; to launch the agent.
            </div>
          )}
        </div>

        {/* Step log */}
        <div className="rounded-card border border-cardline bg-white p-3 shadow-card">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            Agent actions
          </div>
          <div ref={logRef} className="max-h-96 space-y-1.5 overflow-y-auto text-xs">
            {events.length === 0 && <div className="text-muted">No actions yet.</div>}
            {events.map((e, i) => (
              <div
                key={i}
                className={classNames(
                  "rounded border px-2 py-1.5",
                  e.type === "step" && "border-accent/30 bg-accent-50/40",
                  e.type === "downloaded" && "border-navy-100 bg-navy-50",
                  e.type === "done" && "border-accent bg-accent text-white",
                  e.type === "error" && "border-warn bg-warn/10 text-warn",
                )}
              >
                {e.type === "step" && (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-navy">
                        step {e.index}
                      </span>
                      <span className="font-mono text-[10px] text-muted">{e.action}</span>
                    </div>
                    <div className="mt-0.5 text-navy">{e.narration}</div>
                  </>
                )}
                {e.type === "downloaded" && (
                  <div>
                    <span className="font-mono text-navy">{e.filename}</span>{" "}
                    <span className="text-muted">({Math.round((e.bytes ?? 0) / 1024)} KB)</span>
                  </div>
                )}
                {e.type === "done" && (
                  <div className="font-semibold">
                    Finished — {e.entries_downloaded} entries downloaded, {((e.total_ms ?? 0) / 1000).toFixed(1)}s
                  </div>
                )}
                {e.type === "error" && <div>Error: {e.message}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {downloaded.length > 0 && (
        <section className="rounded-card border border-cardline bg-white p-4 shadow-card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">
            Entries pulled ({downloaded.length})
          </h2>
          <ul className="space-y-1 text-xs">
            {downloaded.map((d, i) => (
              <li key={i} className="font-mono text-navy">
                {d.filename}{" "}
                <span className="text-muted">— {Math.round((d.bytes ?? 0) / 1024)} KB, parsed and ready</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Refund analysis runs automatically right after the pull */}
      {(refundStatus || refundProgress.total > 0 || findings) && (
        <section className="rounded-card border border-accent bg-navy-50 p-5 shadow-card">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Refund analysis
          </div>
          {findings ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span className="text-4xl font-bold tabular-nums text-accent">
                  {fmtMoney(findings.total_recoverable_usd_cents)}
                </span>
                <span className="text-xs text-muted">
                  recoverable across {findings.refund_opportunities.length} opportunit
                  {findings.refund_opportunities.length === 1 ? "y" : "ies"} — pulled and analyzed without you
                  sending anything
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {findings.refund_opportunities.map((o, i) => (
                  <div key={i} className="rounded-md border border-cardline bg-white p-3 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-navy">{o.entry_number}</span>
                      <span className="font-bold tabular-nums text-accent-700">
                        {fmtMoney(o.recoverable_amount_usd_cents)}
                      </span>
                    </div>
                    <p className="mt-1 text-navy">{o.line_description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span className="rounded bg-warn/10 px-1.5 py-0.5 font-mono text-warn line-through">
                        {o.hts_filed}
                      </span>
                      <span aria-hidden>→</span>
                      <span className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-accent-700">
                        {o.hts_predicted}
                      </span>
                      <span className="uppercase tracking-wider">{o.our_confidence} confidence</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-2">
              <div className="flex items-center gap-2 text-sm text-navy">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
                {refundStatus ?? "Analyzing…"}
              </div>
              {refundProgress.total > 0 && (
                <>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${Math.round((refundProgress.done / refundProgress.total) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {refundProgress.done} / {refundProgress.total} line items ·{" "}
                    <span className="text-accent-700">{fmtMoney(refundProgress.recoverable)}</span> recoverable so far
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
