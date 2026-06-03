"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

type Party = "Freight forwarder" | "Ocean carrier" | "Customs broker" | "CBP" | "Drayage trucker" | "Warehouse";
type MilestoneStatus = "done" | "in_progress" | "next" | "upcoming" | "at_risk";
interface Milestone { key: string; label: string; party: Party; date: string; deadline: string | null; rule_note: string | null; status: MilestoneStatus }
interface NextAction { label: string; party: Party; due: string; days_left: number; urgency: "urgent" | "soon" | "ok" }
interface Shipment {
  id: string; supplier: string; product: string; container: string; carrier: string; vessel: string;
  origin_port: string; dest_port: string; etd: string; eta: string; transit_days: number;
  last_free_day: string; demurrage_risk: boolean; current_stage: string; next_action: NextAction | null; milestones: Milestone[];
}
interface Result {
  importer: string; as_of: string;
  summary: { in_flight: number; actions_due: number; at_risk: number; awaiting_release: number; demurrage_risk: number };
  shipments: Shipment[];
}

const PARTY_COLOR: Record<Party, string> = {
  "Freight forwarder": "#6366f1",
  "Ocean carrier": "#2f5fd0",
  "Customs broker": "#0ea672",
  CBP: "#d97706",
  "Drayage trucker": "#0891b2",
  Warehouse: "#7c3aed",
};

export default function CoordinationPage() {
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/coordination`, { cache: "no-store" });
        if (!r.ok) { setErr(`backend ${r.status}`); return; }
        setData(await r.json());
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  const s = data?.summary;
  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Logistics coordination
        </div>
        <h1 className="text-3xl font-bold text-navy">Shipment coordination</h1>
        <p className="mt-2 max-w-2xl text-muted">
          The broker sits between the forwarder, the carrier, the drayage trucker, and the warehouse — and the
          entry has hard timing rules. Every in-flight shipment, where it is in the chain, who owns the next move,
          and which deadlines are at risk: ISF (≥24h before loading), the entry (before arrival), and the
          container&apos;s last free day before demurrage.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {s && (
        <>
          {(s.at_risk > 0 || s.demurrage_risk > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-warn/50 bg-warn/5 px-4 py-3">
              <span className="rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Action needed</span>
              <span className="text-sm text-navy">
                {s.at_risk > 0 && <>{s.at_risk} shipment{s.at_risk === 1 ? "" : "s"} with a hard deadline due within 24h. </>}
                {s.demurrage_risk > 0 && <>{s.demurrage_risk} container{s.demurrage_risk === 1 ? "" : "s"} approaching last free day (demurrage).</>}
              </span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Shipments in flight" value={String(s.in_flight)} />
            <Stat label="Actions due ≤3 days" value={String(s.actions_due)} amber={s.actions_due > 0} />
            <Stat label="Hard deadline at risk" value={String(s.at_risk)} warn={s.at_risk > 0} />
            <Stat label="Demurrage risk" value={String(s.demurrage_risk)} warn={s.demurrage_risk > 0} />
          </div>
        </>
      )}

      {/* Party legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(PARTY_COLOR) as Party[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PARTY_COLOR[p] }} />{p}
          </span>
        ))}
      </div>

      {data && <div className="space-y-3">{data.shipments.map((sh) => <ShipmentCard key={sh.id} sh={sh} />)}</div>}

      <p className="text-[11px] italic text-muted">
        Dates are modeled from each shipment&apos;s ETD/ETA on a standard ocean cycle for illustration; live
        coordination syncs ISF/entry status from ACE and vessel/last-free-day from the carrier and terminal.
      </p>
    </div>
  );
}

function ShipmentCard({ sh }: { sh: Shipment }) {
  const [open, setOpen] = useState(false);
  const na = sh.next_action;
  const tone = na?.urgency === "urgent" ? "border-warn/60" : na?.urgency === "soon" ? "border-amber-300" : "border-cardline";

  // Progress along the chain.
  const t0 = new Date(sh.etd).getTime() - 21 * 86400000;
  const tEnd = new Date(sh.last_free_day).getTime();
  const now = Date.now();
  const pct = Math.max(0, Math.min(100, ((now - t0) / (tEnd - t0)) * 100));

  return (
    <div className={classNames("rounded-card border bg-white shadow-card", tone)}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left">
        <span className={classNames("mt-0.5 shrink-0 text-muted transition", open && "rotate-90")}>›</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm text-navy">{sh.id}</span>
            <span className="text-sm text-navy">{sh.supplier}</span>
          </div>
          <div className="text-[11px] text-muted">{sh.product} · {sh.origin_port} → {sh.dest_port} · {sh.carrier} {sh.vessel}</div>
        </div>
        {sh.demurrage_risk && <span className="rounded-full bg-warn px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">demurrage risk</span>}
        <div className="w-52 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted">Now: {sh.current_stage}</div>
          {na ? (
            <div className={classNames("text-sm font-semibold", na.urgency === "urgent" ? "text-warn" : "text-navy")}>
              {na.label} · {na.days_left <= 0 ? "due now" : `${na.days_left}d`}
            </div>
          ) : <div className="text-sm font-semibold text-accent-700">Delivered</div>}
          {na && <div className="text-[10px] text-muted" style={{ color: PARTY_COLOR[na.party] }}>owner: {na.party}</div>}
        </div>
      </button>

      {open && (
        <div className="border-t border-cardline bg-navy-50/40 px-4 py-4">
          {/* Progress bar */}
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
            <div className="h-full rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
          </div>

          {/* Milestone chain */}
          <ol className="space-y-2">
            {sh.milestones.map((m) => (
              <li key={m.key} className="flex items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.status === "done" ? PARTY_COLOR[m.party] : m.status === "at_risk" ? "#dc2626" : "#cbd5e1", boxShadow: m.status === "next" || m.status === "in_progress" ? `0 0 0 3px ${PARTY_COLOR[m.party]}33` : undefined }} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className={classNames("font-medium", m.status === "done" ? "text-navy" : m.status === "upcoming" ? "text-muted" : "text-navy")}>{m.label}</span>
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white" style={{ background: PARTY_COLOR[m.party] }}>{m.party}</span>
                    <StatusTag status={m.status} />
                  </div>
                  <div className="text-[10px] text-muted">
                    {m.date}{m.deadline && m.deadline !== m.date && <span> · deadline {m.deadline}</span>}
                    {m.rule_note && <span className="italic"> · {m.rule_note}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-4">
            <KV k="Container" v={sh.container} />
            <KV k="ETD → ETA" v={`${sh.etd} → ${sh.eta}`} />
            <KV k="Transit" v={`${sh.transit_days} days`} />
            <KV k="Last free day" v={sh.last_free_day} />
          </div>

          {sh.next_action && <CoordinatePanel sh={sh} />}
        </div>
      )}
    </div>
  );
}

interface Outreach { recommended_channel: "email" | "call" | "sms"; urgency: "high" | "normal"; email: { to_party: string; subject: string; body: string }; call_script: string; sms: string; summary: string }
interface IsfElement { n: number; label: string; value: string; status: "filled" | "assumed" | "needs_supplier" | "to_confirm" }
interface Isf { shipment_ref: string; elements: IsfElement[]; carrier_elements: string[]; missing: string[]; readiness_pct: number }
interface EntryLine { description: string; hts_code: string; country_of_origin: string; value_usd_cents: number; base_duty_usd_cents: number; section_301_usd_cents: number; section_232_usd_cents: number; line_duty_usd_cents: number; hts_status: "filled" | "to_confirm" }
interface Entry { shipment_ref: string; entry_type: string; port_of_entry: string; importer_of_record: string; ior_number: string; consignee_number: string; country_of_origin: string; lines: EntryLine[]; mpf_usd_cents: number; hmf_usd_cents: number; total_entered_value_usd_cents: number; total_duty_usd_cents: number; missing: string[]; readiness_pct: number }
type Draft =
  | { kind: "isf"; isf: Isf; outreach: Outreach }
  | { kind: "entry"; entry: Entry; outreach: Outreach }
  | { kind: "comms"; outreach: Outreach };

function CoordinatePanel({ sh }: { sh: Shipment }) {
  const [state, setState] = useState<null | "loading" | Draft>(null);
  const [err, setErr] = useState<string | null>(null);
  const [routed, setRouted] = useState(false);
  const [emailSent, setEmailSent] = useState<null | { at: string }>(null);
  const [textSent, setTextSent] = useState<null | { at: string }>(null);
  const [callPhase, setCallPhase] = useState<"idle" | "dialing" | "connected" | "complete">("idle");
  const [callStartedAt, setCallStartedAt] = useState<string | null>(null);

  const draft = async () => {
    setState("loading"); setErr(null); setRouted(false); setEmailSent(null); setTextSent(null); setCallPhase("idle"); setCallStartedAt(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/coordination/draft`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shipment_id: sh.id }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ? cleanErr(String(j.error)) : `backend ${r.status}`); setState(null); return; }
      setState(j as Draft);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setState(null); }
  };

  const route = async (type: string, title: string, payload: unknown) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/filings`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ shipment_ref: sh.id, type, title, payload }),
      });
      if (r.ok) setRouted(true);
    } catch { /* ignore */ }
  };

  const d = state && state !== "loading" ? state : null;
  const o = d?.outreach;

  return (
    <div className="mt-4 rounded-md border border-accent/30 bg-accent-50/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-700">Agentic coordination</span>
        {!d && <button onClick={draft} disabled={state === "loading"}
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50">
          {state === "loading" ? "Drafting…" : `Coordinate: ${sh.next_action?.label}`}
        </button>}
      </div>
      {err && <div className="mt-2 text-[11px] text-warn">{err}</div>}
      {state === "loading" && <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />Drafting the next step…</div>}

      {d && (
        <div className="mt-3 space-y-3 text-[11px]">
          {d.kind === "isf" && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-navy">Draft ISF (10+2) — {d.isf.readiness_pct}% ready</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-navy-100"><div className="h-full bg-accent" style={{ width: `${d.isf.readiness_pct}%` }} /></div>
              </div>
              <table className="w-full">
                <tbody>
                  {d.isf.elements.map((e) => (
                    <tr key={e.n} className="border-b border-cardline/40 last:border-b-0">
                      <td className="py-1 pr-2 text-muted">{e.n}.</td>
                      <td className="py-1 pr-2 text-navy">{e.label}</td>
                      <td className="py-1 pr-2 text-muted">{e.value}</td>
                      <td className="py-1 text-right"><IsfTag s={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-[10px] text-muted">+ carrier-filed: {d.isf.carrier_elements.join("; ")}</div>
              {!routed ? (
                <button onClick={() => route("isf", `ISF 10+2 — ${sh.id} (${sh.supplier})`, { isf: d.isf })} className="mt-2 rounded-md bg-navy px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-navy/90">
                  Route ISF to broker review →
                </button>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent-50 px-2 py-1 text-[11px] font-semibold text-accent-700">Routed to broker review ✓ — appears in the Broker queue</div>
              )}
            </div>
          )}

          {d.kind === "entry" && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-navy">Draft CBP 7501 entry — {d.entry.readiness_pct}% ready</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-navy-100"><div className="h-full bg-accent" style={{ width: `${d.entry.readiness_pct}%` }} /></div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded bg-navy-50/40 p-2 text-[10px]">
                <KV k="Entry type" v={d.entry.entry_type} />
                <KV k="Port of entry" v={d.entry.port_of_entry} />
                <KV k="Importer of record" v={`${d.entry.importer_of_record} (${d.entry.ior_number})`} />
                <KV k="Country of origin" v={d.entry.country_of_origin} />
              </div>
              <table className="mt-2 w-full text-[10px]">
                <thead>
                  <tr className="border-b border-cardline text-left uppercase tracking-wider text-muted">
                    <th className="py-1">Line</th><th className="py-1">HTS</th>
                    <th className="py-1 text-right">Entered value</th><th className="py-1 text-right">Base</th>
                    <th className="py-1 text-right">301</th><th className="py-1 text-right">Line duty</th>
                  </tr>
                </thead>
                <tbody>
                  {d.entry.lines.map((ln, i) => (
                    <tr key={i} className="border-b border-cardline/40">
                      <td className="py-1 pr-2 text-navy">{ln.description}</td>
                      <td className="py-1 pr-2 font-mono text-muted">{ln.hts_code}{ln.hts_status === "to_confirm" && <span className="ml-1 rounded bg-amber-50 px-1 text-[8px] uppercase text-amber-700">confirm</span>}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{fmtMoney(ln.value_usd_cents)}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{fmtMoney(ln.base_duty_usd_cents)}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{fmtMoney(ln.section_301_usd_cents)}</td>
                      <td className="py-1 text-right tabular-nums font-semibold text-navy">{fmtMoney(ln.line_duty_usd_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-[10px] text-muted">
                <span>MPF {fmtMoney(d.entry.mpf_usd_cents)}</span>
                <span>HMF {fmtMoney(d.entry.hmf_usd_cents)}</span>
                <span className="font-semibold text-navy">Total entered value {fmtMoney(d.entry.total_entered_value_usd_cents)}</span>
                <span className="font-semibold text-navy">Total duty + fees {fmtMoney(d.entry.total_duty_usd_cents)}</span>
              </div>
              {d.entry.missing.length > 0 && <div className="mt-1 text-[10px] text-warn">Needs before filing: {d.entry.missing.join(", ")}</div>}
              {!routed ? (
                <button onClick={() => route("entry", `CBP 7501 — ${sh.id} (${sh.supplier})`, { entry: d.entry })} className="mt-2 rounded-md bg-navy px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-navy/90">
                  Route entry (7501) to broker review →
                </button>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent-50 px-2 py-1 text-[11px] font-semibold text-accent-700">Routed to broker review ✓ — appears in the Broker queue</div>
              )}
            </div>
          )}

          {o && (
            <OutreachPanel
              outreach={o}
              emailSent={emailSent}
              textSent={textSent}
              callPhase={callPhase}
              callStartedAt={callStartedAt}
              onSendEmail={() => {
                // Real action: open the user's mail client with subject + body prefilled.
                const subject = encodeURIComponent(o.email.subject);
                const body = encodeURIComponent(o.email.body);
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
                setEmailSent({ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
              }}
              onSendText={() => {
                window.location.href = `sms:?&body=${encodeURIComponent(o.sms)}`;
                setTextSent({ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
              }}
              onStartCall={() => {
                setCallStartedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
                setCallPhase("dialing");
                window.setTimeout(() => setCallPhase((p) => (p === "dialing" ? "connected" : p)), 1800);
              }}
              onEndCall={() => setCallPhase("complete")}
              onResetCall={() => { setCallPhase("idle"); setCallStartedAt(null); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function OutreachPanel({
  outreach: o,
  emailSent, textSent, callPhase, callStartedAt,
  onSendEmail, onSendText, onStartCall, onEndCall, onResetCall,
}: {
  outreach: Outreach;
  emailSent: { at: string } | null;
  textSent: { at: string } | null;
  callPhase: "idle" | "dialing" | "connected" | "complete";
  callStartedAt: string | null;
  onSendEmail: () => void;
  onSendText: () => void;
  onStartCall: () => void;
  onEndCall: () => void;
  onResetCall: () => void;
}) {
  const [tab, setTab] = useState<"email" | "call" | "sms">(o.recommended_channel);

  return (
    <div className="rounded-md border border-cardline bg-white p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Outreach to {o.email.to_party}
        </span>
        <span className="rounded-full bg-navy-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-navy">
          agent recommends: {o.recommended_channel}
        </span>
        {o.urgency === "high" && (
          <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warn">
            urgent
          </span>
        )}
      </div>

      {/* Channel tabs */}
      <div className="mb-2 flex gap-1 rounded-md bg-navy-50/50 p-1 text-[11px] font-semibold">
        <ChannelTab kind="email" active={tab === "email"} recommended={o.recommended_channel === "email"} sent={!!emailSent} onClick={() => setTab("email")} />
        <ChannelTab kind="call"  active={tab === "call"}  recommended={o.recommended_channel === "call"}  sent={callPhase === "complete"} onClick={() => setTab("call")} />
        <ChannelTab kind="sms"   active={tab === "sms"}   recommended={o.recommended_channel === "sms"}   sent={!!textSent} onClick={() => setTab("sms")} />
      </div>

      {/* Email tab */}
      {tab === "email" && (
        <div>
          <div className="text-[12px] text-navy"><span className="text-muted">To:</span> <span className="font-medium">{o.email.to_party}</span></div>
          <div className="text-[12px] text-navy"><span className="text-muted">Subject:</span> {o.email.subject}</div>
          <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-cardline bg-navy-50/40 p-2 font-sans text-[11px] leading-snug text-navy">{o.email.body}</pre>
          {emailSent ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-50/60 px-2.5 py-1.5 text-[11px]">
              <span className="text-base">✓</span>
              <span className="font-semibold text-accent-700">Email opened in your mail client at {emailSent.at}</span>
              <button onClick={onSendEmail} className="ml-auto text-[10px] font-semibold text-accent-700 underline hover:no-underline">Open again</button>
            </div>
          ) : (
            <button
              onClick={onSendEmail}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              <span aria-hidden>✉️</span> Send email
            </button>
          )}
        </div>
      )}

      {/* Call tab */}
      {tab === "call" && (
        <div>
          <div className="text-[12px] text-navy"><span className="text-muted">Call:</span> <span className="font-medium">{o.email.to_party}</span></div>
          <div className="mt-1.5 rounded-md border border-cardline bg-navy-50/40 p-2 text-[11px] leading-snug text-navy">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted">Talk track</span>
            <div className="mt-0.5">{o.call_script}</div>
          </div>
          {callPhase === "idle" && (
            <button
              onClick={onStartCall}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              <span aria-hidden>📞</span> Call {o.email.to_party}
            </button>
          )}
          {(callPhase === "dialing" || callPhase === "connected") && (
            <CallActive party={o.email.to_party} startedAt={callStartedAt} phase={callPhase} onEnd={onEndCall} />
          )}
          {callPhase === "complete" && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-50/60 px-2.5 py-1.5 text-[11px]">
              <span className="text-base">✓</span>
              <span className="font-semibold text-accent-700">Call completed at {callStartedAt}</span>
              <button onClick={onResetCall} className="ml-auto text-[10px] font-semibold text-accent-700 underline hover:no-underline">Call again</button>
            </div>
          )}
        </div>
      )}

      {/* SMS tab */}
      {tab === "sms" && (
        <div>
          <div className="text-[12px] text-navy"><span className="text-muted">Text:</span> <span className="font-medium">{o.email.to_party}</span></div>
          <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-cardline bg-navy-50/40 p-2 font-sans text-[11px] leading-snug text-navy">{o.sms}</pre>
          {textSent ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-50/60 px-2.5 py-1.5 text-[11px]">
              <span className="text-base">✓</span>
              <span className="font-semibold text-accent-700">Text opened in your SMS app at {textSent.at}</span>
              <button onClick={onSendText} className="ml-auto text-[10px] font-semibold text-accent-700 underline hover:no-underline">Open again</button>
            </div>
          ) : (
            <button
              onClick={onSendText}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              <span aria-hidden>💬</span> Send text
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] italic text-muted">
        The agent drafts; a human reviews and dispatches. Email and text open your mail/SMS client with the draft prefilled —
        nothing is auto-sent.
      </p>
    </div>
  );
}

function ChannelTab({ kind, active, recommended, sent, onClick }: { kind: "email" | "call" | "sms"; active: boolean; recommended: boolean; sent: boolean; onClick: () => void }) {
  const icon = kind === "email" ? "✉️" : kind === "call" ? "📞" : "💬";
  const label = kind === "email" ? "Email" : kind === "call" ? "Call" : "Text";
  return (
    <button
      onClick={onClick}
      className={classNames(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition",
        active ? "bg-white text-navy shadow-sm ring-1 ring-cardline" : "text-muted hover:bg-white/60 hover:text-navy",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
      {recommended && !sent && <span className="rounded-full bg-accent/20 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-accent-700">rec</span>}
      {sent && <span className="text-[10px] text-accent-700">✓</span>}
    </button>
  );
}

function CallActive({ party, startedAt, phase, onEnd }: { party: string; startedAt: string | null; phase: "dialing" | "connected"; onEnd: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== "connected") return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-accent/50 bg-gradient-to-br from-navy to-accent-700 text-white shadow-sm">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-base">
          {phase === "dialing" ? <span className="animate-pulse">📞</span> : "📞"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{party}</div>
          <div className="text-[10px] opacity-80">
            {phase === "dialing" && <span className="animate-pulse">Dialing…</span>}
            {phase === "connected" && <span>Connected · {mm}:{ss}</span>}
            {startedAt && <span> · started {startedAt}</span>}
          </div>
        </div>
        <button
          onClick={onEnd}
          className="rounded-md bg-warn/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-warn"
        >
          End call
        </button>
      </div>
    </div>
  );
}

function IsfTag({ s }: { s: IsfElement["status"] }) {
  const map: Record<IsfElement["status"], { l: string; c: string }> = {
    filled: { l: "filled", c: "bg-accent-50 text-accent-700" },
    assumed: { l: "assumed", c: "bg-navy-50 text-navy" },
    to_confirm: { l: "confirm", c: "bg-amber-50 text-amber-700" },
    needs_supplier: { l: "from supplier", c: "bg-warn/15 text-warn" },
  };
  const m = map[s];
  return <span className={classNames("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", m.c)}>{m.l}</span>;
}

function cleanErr(raw: string): string {
  if (/credit balance is too low/i.test(raw)) return "Anthropic API credits exhausted — add credits to draft outreach.";
  return raw.slice(0, 180);
}

function StatusTag({ status }: { status: MilestoneStatus }) {
  const map: Record<MilestoneStatus, { label: string; cls: string }> = {
    done: { label: "done", cls: "bg-accent-50 text-accent-700" },
    in_progress: { label: "in transit", cls: "bg-navy-100 text-navy" },
    next: { label: "next up", cls: "bg-amber-50 text-amber-700" },
    upcoming: { label: "upcoming", cls: "bg-navy-50 text-muted" },
    at_risk: { label: "at risk", cls: "bg-warn/15 text-warn" },
  };
  const m = map[status];
  return <span className={classNames("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", m.cls)}>{m.label}</span>;
}

function Stat({ label, value, warn, amber }: { label: string; value: string; warn?: boolean; amber?: boolean }) {
  return (
    <div className={classNames("rounded-card border bg-white p-4 shadow-card", warn ? "border-warn/50" : amber ? "border-amber-300" : "border-cardline")}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-1 text-2xl font-bold tabular-nums", warn ? "text-warn" : amber ? "text-amber-700" : "text-navy")}>{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div><span className="text-muted">{k}:</span> <span className="font-medium text-navy">{v}</span></div>;
}
