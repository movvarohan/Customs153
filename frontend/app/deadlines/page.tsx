"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

type Status = "psc_open" | "pre_liquidation" | "protest_open" | "closed";
type Urgency = "urgent" | "soon" | "ok" | "none";
interface Entry {
  entry_number: string;
  entry_date: string;
  port_of_entry: string;
  country_of_origin: string;
  line_count: number;
  value_usd_cents: number;
  duty_paid_usd_cents: number;
  liquidation_date: string;
  psc_deadline: string;
  protest_deadline: string;
  status: Status;
  next_deadline: string;
  next_label: string;
  days_left: number;
  actionable: boolean;
  urgency: Urgency;
}
interface Result {
  summary: {
    importer: string;
    as_of: string;
    total_entries: number;
    psc_open: number;
    protest_open: number;
    closed: number;
    urgent: number;
    actionable_duty_usd_cents: number;
    total_duty_usd_cents: number;
  };
  entries: Entry[];
}

const STATUS_LABEL: Record<Status, string> = {
  psc_open: "PSC window open",
  pre_liquidation: "Awaiting liquidation",
  protest_open: "Protest window open",
  closed: "Window closed",
};

export default function DeadlinesPage() {
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"actionable" | "all">("actionable");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/deadlines`, { cache: "no-store" });
        if (!r.ok) { setErr(`backend ${r.status}`); return; }
        setData(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const s = data?.summary;
  const rows = (data?.entries ?? []).filter((e) => (tab === "actionable" ? e.actionable : true));

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Deadline tracker
        </div>
        <h1 className="text-3xl font-bold text-navy">Liquidation &amp; refund windows</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Every entry runs a clock. A Post Summary Correction must be filed before liquidation (~314 days
          from entry); a protest, within 180 days after. We track where each of {s?.importer ?? "the importer"}&apos;s
          entries sits today so recoverable duty never quietly expires.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {s && (
        <>
          {s.urgent > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-warn/50 bg-warn/5 px-4 py-3">
              <span className="rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Act now</span>
              <span className="text-sm text-navy">
                <span className="font-semibold">{s.urgent} {s.urgent === 1 ? "entry" : "entries"}</span> have an actionable window closing within 30 days.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="PSC window open" value={String(s.psc_open)} sub="can still file a correction" accent />
            <Stat label="Protest window open" value={String(s.protest_open)} sub="post-liquidation, ≤180 days" />
            <Stat label="Closing ≤30 days" value={String(s.urgent)} sub="urgent" warn={s.urgent > 0} />
            <Stat label="Duty in open windows" value={fmtMoney(s.actionable_duty_usd_cents)} sub={`of ${fmtMoney(s.total_duty_usd_cents)} total`} />
          </div>
        </>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(["actionable", "all"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={classNames(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition",
              tab === t ? "bg-navy text-white" : "border border-cardline bg-white text-navy hover:border-navy/40",
            )}>
            {t === "actionable" ? "Actionable now" : "All entries"} ({t === "actionable" ? (data?.entries.filter((e) => e.actionable).length ?? 0) : (data?.entries.length ?? 0)})
          </button>
        ))}
      </div>

      {data && (
        <div className="space-y-2">
          {rows.map((e) => <DeadlineRow key={e.entry_number} e={e} />)}
          {rows.length === 0 && <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">No entries in this view.</div>}
        </div>
      )}

      <p className="text-[11px] italic text-muted">
        Liquidation modeled at the standard 314-day cycle; actual dates come from CBP&apos;s bulletin notices and may
        be extended or suspended. We confirm the scheduled liquidation date in ACE before filing.
      </p>
    </div>
  );
}

function DeadlineRow({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const urgentTone = e.urgency === "urgent" ? "border-warn/60" : e.urgency === "soon" ? "border-amber-300" : "border-cardline";
  // Lifecycle progress: entry → PSC close → liquidation → protest close.
  const t0 = new Date(e.entry_date).getTime();
  const tEnd = new Date(e.protest_deadline).getTime();
  const now = Date.now();
  const pct = Math.max(0, Math.min(100, ((now - t0) / (tEnd - t0)) * 100));
  const mark = (iso: string) => ((new Date(iso).getTime() - t0) / (tEnd - t0)) * 100;

  return (
    <div className={classNames("rounded-card border bg-white shadow-card", urgentTone)}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left">
        <span className={classNames("mt-0.5 shrink-0 text-muted transition", open && "rotate-90")}>›</span>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-sm text-navy">{e.entry_number}</span>
          <span className="ml-2 text-[11px] text-muted">{e.entry_date} · {e.port_of_entry} · {e.country_of_origin} · {e.line_count} {e.line_count === 1 ? "line" : "lines"}</span>
        </div>
        <StatusBadge status={e.status} urgency={e.urgency} />
        <div className="w-40 text-right">
          <div className={classNames("text-sm font-semibold tabular-nums", e.urgency === "urgent" ? "text-warn" : "text-navy")}>
            {e.actionable ? `${e.days_left} days left` : e.status === "closed" ? "—" : `${e.days_left} days`}
          </div>
          <div className="text-[10px] text-muted">{e.next_label} {e.next_deadline}</div>
        </div>
        <div className="w-28 text-right">
          <div className="text-sm font-semibold tabular-nums text-navy">{fmtMoney(e.duty_paid_usd_cents)}</div>
          <div className="text-[10px] text-muted">duty paid</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-cardline bg-navy-50/40 px-4 py-4">
          {/* Lifecycle timeline */}
          <div className="mb-4">
            <div className="relative mt-6 h-1 rounded-full bg-navy-100">
              <div className="absolute left-0 top-0 h-1 rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
              {[
                { iso: e.entry_date, label: "Entry" },
                { iso: e.psc_deadline, label: "PSC closes" },
                { iso: e.liquidation_date, label: "Liquidation" },
                { iso: e.protest_deadline, label: "Protest closes" },
              ].map((m, i) => {
                const left = Math.max(0, Math.min(100, mark(m.iso)));
                return (
                  <div key={i} className="absolute -top-1 flex -translate-x-1/2 flex-col items-center" style={{ left: `${left}%` }}>
                    <span className="h-3 w-3 rounded-full border-2 border-white bg-navy" />
                    <span className="mt-1 whitespace-nowrap text-[9px] font-semibold text-navy">{m.label}</span>
                    <span className="text-[9px] text-muted">{m.iso}</span>
                  </div>
                );
              })}
              {/* Today marker */}
              <div className="absolute -top-3 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pct}%` }}>
                <span className="text-[9px] font-bold text-accent-700">today</span>
                <span className="h-5 w-0.5 bg-accent-700" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 text-[11px] md:grid-cols-3">
            <KV k="Entry value" v={fmtMoney(e.value_usd_cents)} />
            <KV k="Duty paid" v={fmtMoney(e.duty_paid_usd_cents)} />
            <KV k="Scheduled liquidation" v={e.liquidation_date} />
            <KV k="PSC deadline" v={e.psc_deadline} />
            <KV k="Protest deadline" v={e.protest_deadline} />
            <KV k="Status" v={STATUS_LABEL[e.status]} />
          </div>

          {e.actionable && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href="/find-refunds" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700">
                {e.status === "psc_open" ? "Audit this entry for a PSC" : "Review for a protest"}
              </a>
              <span className="text-[11px] text-muted">
                {e.status === "psc_open"
                  ? "Run the refund finder, then draft the Post Summary Correction before the window closes."
                  : "The entry has liquidated — recoverable duty now requires a protest under 19 USC 1514."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, urgency }: { status: Status; urgency: Urgency }) {
  const tone =
    status === "closed" ? "bg-cardline text-muted"
      : urgency === "urgent" ? "bg-warn text-white"
        : status === "psc_open" ? "bg-accent text-white"
          : status === "protest_open" ? "bg-amber-100 text-amber-800"
            : "bg-navy-100 text-navy";
  return <span className={classNames("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone)}>{STATUS_LABEL[status]}</span>;
}

function Stat({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={classNames("rounded-card border bg-white p-4 shadow-card", accent ? "border-accent" : warn ? "border-warn/50" : "border-cardline")}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-1 text-2xl font-bold tabular-nums", accent ? "text-accent" : warn ? "text-warn" : "text-navy")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-muted">{k}</dt>
      <dd className="font-medium text-navy">{v}</dd>
    </div>
  );
}
