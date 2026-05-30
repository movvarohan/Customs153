"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

type FlagKind = "info" | "warn" | "risk";
interface Flag { kind: FlagKind; label: string }
interface Duty {
  base_usd_cents: number;
  section_301_usd_cents: number;
  section_232_usd_cents: number;
  mpf_usd_cents: number;
  hmf_usd_cents: number;
  total_usd_cents: number;
}
interface Line {
  sku: string;
  description: string;
  hts_code: string;
  hts_code_8: string;
  chapter: string;
  source: "agent" | "broker";
  last_classified_at: string;
  customs_value_usd_cents: number;
  duty: Duty;
  effective_rate: number;
  confidence: number;
  flags: Flag[];
}
interface Queue {
  customer_id: string;
  summary: { pending: number; signed: number; flagged: number; total_value_usd_cents: number; total_duty_usd_cents: number };
  lines: Line[];
}

export default function BrokerQueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/broker/queue`, { cache: "no-store" });
      if (!r.ok) { setError(`backend ${r.status}: ${await r.text()}`); return; }
      setQueue(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const act = useCallback(
    async (description: string, hts_code: string, action: "confirm" | "correct") => {
      setBusy(description);
      try {
        const r = await fetch(`${API_BASE_URL}/api/broker/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description, hts_code }),
        });
        if (!r.ok) { setError(`${action} failed: ${r.status} ${await r.text()}`); return; }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const approveAllHighConfidence = useCallback(async () => {
    if (!queue) return;
    const targets = queue.lines.filter((l) => l.source === "agent" && l.confidence >= 0.95 && !(edits[l.sku] && edits[l.sku] !== l.hts_code));
    setBusy("bulk");
    try {
      for (const l of targets) {
        await fetch(`${API_BASE_URL}/api/broker/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: l.description, hts_code: l.hts_code }),
        });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [queue, edits, refresh]);

  const lines = queue?.lines ?? [];
  const q = filter.trim().toLowerCase();
  const match = (l: Line) => !q || l.description.toLowerCase().includes(q) || l.hts_code.includes(q);
  const pending = lines.filter((l) => l.source === "agent" && match(l));
  const signed = lines.filter((l) => l.source === "broker" && match(l));
  const s = queue?.summary;
  const highConf = lines.filter((l) => l.source === "agent" && l.confidence >= 0.95).length;

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Broker partner view
        </div>
        <h1 className="text-3xl font-bold text-navy">Classification review queue</h1>
        <p className="mt-2 max-w-2xl text-muted">
          What the licensed broker partner sees for <span className="font-semibold text-navy">Atlas Retail Holdings LLC</span>.
          Each line carries the agent&apos;s classification, its confidence, the real duty exposure, and any review
          flags. Approve to add the broker&apos;s signature; correct to override — either way it feeds this importer&apos;s
          SKU memory so the agent gets it right next time.
        </p>
      </header>

      {error && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{error}</div>}

      {/* Summary */}
      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Pending review" value={String(s.pending)} sub="awaiting broker signature" amber={s.pending > 0} />
          <Stat label="Broker-signed" value={String(s.signed)} sub="in SKU memory" accent />
          <Stat label="Flagged lines" value={String(s.flagged)} sub="301 / 232 / verify" warn={s.flagged > 0} />
          <Stat label="Duty under review" value={fmtMoney(s.total_duty_usd_cents)} sub={`on ${fmtMoney(s.total_value_usd_cents)} value`} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by description or HTS…"
          className="w-64 rounded-md border border-cardline bg-white px-3 py-1.5 text-sm"
        />
        <button
          onClick={approveAllHighConfidence}
          disabled={busy !== null || highConf === 0}
          className={classNames(
            "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
            highConf > 0 && busy === null
              ? "border-accent bg-accent text-white hover:bg-accent-700"
              : "cursor-not-allowed border-cardline text-muted opacity-60",
          )}
        >
          {busy === "bulk" ? "Signing…" : `Approve all ≥95% confidence (${highConf})`}
        </button>
        <span className="text-[11px] text-muted">Bulk-sign the high-confidence lines, then review the flagged ones by hand.</span>
      </div>

      <Section title="Pending broker review" count={pending.length} hint="agent predictions — no signature yet">
        {pending.length === 0 ? (
          <Empty>No pending classifications match. Process an invoice on <code className="rounded bg-navy-50 px-1 text-[11px]">/process-invoice</code> to add lines.</Empty>
        ) : (
          pending.map((l) => <Row key={l.sku} l={l} edits={edits} setEdits={setEdits} busy={busy} act={act} />)
        )}
      </Section>

      <Section title="Broker-confirmed SKU memory" count={signed.length} hint="the prior the classifier trusts on the next shipment">
        {signed.length === 0 ? (
          <Empty>Approve or correct a pending line to see it move here.</Empty>
        ) : (
          signed.map((l) => <Row key={l.sku} l={l} edits={edits} setEdits={setEdits} busy={busy} act={act} />)
        )}
      </Section>

      <p className="text-[11px] italic text-muted">
        Every decision is scoped to this importer of record. Duty figures are the deterministic engine (base +
        Section 301 + Section 232 + MPF + HMF) on a representative entry value; the broker&apos;s signature is what
        makes a classification final under 19 CFR Part 111.
      </p>
    </div>
  );
}

function Row({
  l, edits, setEdits, busy, act,
}: {
  l: Line;
  edits: Record<string, string>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: string | null;
  act: (description: string, hts_code: string, action: "confirm" | "correct") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const edit = edits[l.sku] ?? l.hts_code;
  const dirty = edit !== l.hts_code;
  const valid = /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(edit);
  const isBusy = busy === l.description;

  return (
    <div className={classNames("rounded-card border bg-white shadow-card transition", open ? "border-accent/50" : "border-cardline")}>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className={classNames("mt-0.5 shrink-0 text-muted transition", open && "rotate-90")}>›</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-navy">{l.description}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">{l.hts_code_8}</span>
              <ConfidencePill source={l.source} confidence={l.confidence} />
              {l.flags.slice(0, 2).map((f, i) => <FlagChip key={i} f={f} />)}
              {l.flags.length > 2 && <span className="text-[10px] text-muted">+{l.flags.length - 2} more</span>}
            </span>
          </span>
        </button>

        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-navy">{fmtMoney(l.duty.total_usd_cents)}</div>
          <div className="text-[10px] text-muted">{(l.effective_rate * 100).toFixed(1)}% on {fmtMoney(l.customs_value_usd_cents)}</div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={edit}
            onChange={(e) => setEdits((prev) => ({ ...prev, [l.sku]: e.target.value }))}
            className={classNames("w-36 rounded-md border bg-white px-2 py-1 font-mono text-xs", valid ? "border-cardline" : "border-warn/60")}
            placeholder="XXXX.XX.XX.XX"
          />
          <button
            disabled={!valid || isBusy}
            onClick={() => act(l.description, edit, dirty ? "correct" : "confirm")}
            className={classNames(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition",
              dirty ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-accent text-white hover:bg-accent-700",
              (!valid || isBusy) && "cursor-not-allowed opacity-50",
            )}
          >
            {isBusy ? "…" : dirty ? "Save correction" : l.source === "broker" ? "Re-sign" : "Approve & sign"}
          </button>
        </div>
      </div>

      {open && <Drawer l={l} edit={edit} dirty={dirty} setEdits={setEdits} />}
    </div>
  );
}

function Drawer({ l, edit, dirty, setEdits }: { l: Line; edit: string; dirty: boolean; setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  const [cross, setCross] = useState<null | "loading" | CrossResult>(null);
  const [note, setNote] = useState("");

  const checkCross = async () => {
    setCross("loading");
    try {
      const r = await fetch(`${API_BASE_URL}/api/cross-verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: l.description, predicted_hts_code: l.hts_code, predicted_hts_code_8: l.hts_code_8 }),
      });
      const j = await r.json();
      if (!r.ok) { setCross({ error: j.error ? String(j.error) : `backend ${r.status}` }); return; }
      setCross(j as CrossResult);
    } catch (e) {
      setCross({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const comps: Array<{ label: string; v: number; color: string }> = [
    { label: "Base ad valorem", v: l.duty.base_usd_cents, color: "#2f5fd0" },
    { label: "Section 301", v: l.duty.section_301_usd_cents, color: "#d04f4f" },
    { label: "Section 232", v: l.duty.section_232_usd_cents, color: "#9a6dd0" },
    { label: "MPF", v: l.duty.mpf_usd_cents, color: "#0ea672" },
    { label: "HMF", v: l.duty.hmf_usd_cents, color: "#14b8a6" },
  ].filter((c) => c.v > 0);

  return (
    <div className="border-t border-cardline bg-navy-50/40 px-4 py-4">
      <div className="grid gap-5 md:grid-cols-3">
        {/* Duty breakdown */}
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Duty exposure (China origin, ocean)</div>
          <div className="mb-2 h-3 w-full overflow-hidden rounded bg-white">
            <div className="flex h-full">
              {comps.map((c, i) => (
                <div key={i} title={`${c.label}: ${fmtMoney(c.v)}`} style={{ width: `${(c.v / l.duty.total_usd_cents) * 100}%`, background: c.color }} />
              ))}
            </div>
          </div>
          <dl className="space-y-0.5 text-[11px]">
            {comps.map((c, i) => (
              <div key={i} className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-muted"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label}</dt>
                <dd className="tabular-nums text-navy">{fmtMoney(c.v)}</dd>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-cardline pt-1 font-semibold">
              <dt className="text-navy">Total landed duty</dt>
              <dd className="tabular-nums text-navy">{fmtMoney(l.duty.total_usd_cents)}</dd>
            </div>
          </dl>
        </div>

        {/* Flags + record */}
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Review flags</div>
          {l.flags.length === 0 ? (
            <p className="text-[11px] text-muted">No flags — straightforward classification.</p>
          ) : (
            <ul className="space-y-1">
              {l.flags.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px]">
                  <FlagDot kind={f.kind} />
                  <span className="text-navy">{f.label}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">Record</div>
          <dl className="mt-1 space-y-0.5 text-[11px]">
            <KV k="Full HTS" v={dirty ? `${l.hts_code} → ${edit}` : l.hts_code} mono />
            <KV k="Chapter" v={l.chapter} />
            <KV k="Status" v={l.source === "broker" ? "Broker-confirmed" : "Pending review"} />
            <KV k="Last classified" v={new Date(l.last_classified_at).toLocaleString()} />
          </dl>
        </div>

        {/* CROSS + notes */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">CBP precedent (live CROSS)</div>
            <button onClick={checkCross} disabled={cross === "loading"}
              className="rounded border border-accent/40 bg-white px-2 py-0.5 text-[10px] font-semibold text-accent-700 transition hover:bg-accent-50 disabled:opacity-50">
              {cross === "loading" ? "Checking…" : "Check rulings"}
            </button>
          </div>
          <CrossPanel cross={cross} />

          <div className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">Broker note</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a review note (kept with this session)…"
            className="mt-1 h-16 w-full resize-none rounded-md border border-cardline bg-white px-2 py-1.5 text-[11px]"
          />
          {l.source === "agent" && (
            <button
              onClick={() => setEdits((p) => ({ ...p, [l.sku]: l.hts_code }))}
              className="mt-1 text-[10px] text-muted underline hover:text-navy"
            >
              Reset override to agent code
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface CrossResult {
  error?: string;
  defense?: {
    agrees_with_predicted: boolean;
    suggested_hts_code: string | null;
    confidence: "low" | "medium" | "high";
    reasoning: string;
    evidence: Array<{ ruling_number: string; product: string; assigned_code: string; relevance?: string }>;
  };
}

function cleanError(raw: string): string {
  // Anthropic errors arrive as "400 {json}". Extract the human message, and
  // special-case the most common operational failure (no API credits).
  if (/credit balance is too low/i.test(raw)) return "Anthropic API credits exhausted — add credits to run live rulings checks.";
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { error?: { message?: string } };
      if (j.error?.message) return j.error.message;
    } catch { /* fall through */ }
  }
  return raw.slice(0, 160);
}

function CrossPanel({ cross }: { cross: null | "loading" | CrossResult }) {
  if (cross === null) return <p className="text-[11px] text-muted">Query CBP&apos;s CROSS rulings database to check this code against precedent.</p>;
  if (cross === "loading") return <p className="flex items-center gap-1.5 text-[11px] text-muted"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />Searching CBP CROSS rulings…</p>;
  if (cross.error || !cross.defense) return <p className="text-[11px] text-warn">{cleanError(cross.error ?? "no verdict returned")}</p>;
  const d = cross.defense;
  const agree = d.agrees_with_predicted;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={classNames("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", agree ? "bg-accent text-white" : "bg-warn/15 text-warn")}>
          {agree ? "Rulings agree" : "Rulings differ"}
        </span>
        <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy">{d.confidence} confidence</span>
        {!agree && d.suggested_hts_code && (
          <span className="font-mono text-[10px] text-warn">→ {d.suggested_hts_code}</span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-navy">{d.reasoning}</p>
      {d.evidence.slice(0, 4).map((e, i) => (
        <div key={i} className="rounded border border-cardline bg-white px-2 py-1 text-[10px]">
          <span className="font-mono font-semibold text-accent-700">{e.ruling_number}</span>
          {e.assigned_code && <span className="ml-1 font-mono text-muted">{e.assigned_code}</span>}
          {e.product && <span className="ml-1 text-muted">— {e.product.slice(0, 56)}</span>}
        </div>
      ))}
    </div>
  );
}

function ConfidencePill({ source, confidence }: { source: "agent" | "broker"; confidence: number }) {
  if (source === "broker") {
    return <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">signed</span>;
  }
  const pct = Math.round(confidence * 100);
  const tone = confidence >= 0.9 ? "bg-accent-50 text-accent-700" : confidence >= 0.8 ? "bg-amber-50 text-amber-700" : "bg-warn/10 text-warn";
  return <span className={classNames("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", tone)}>{pct}% conf</span>;
}

function FlagChip({ f }: { f: Flag }) {
  const tone = f.kind === "risk" ? "bg-warn/10 text-warn" : f.kind === "warn" ? "bg-amber-50 text-amber-700" : "bg-navy-50 text-muted";
  return <span className={classNames("rounded px-1.5 py-0.5 text-[9px] font-medium", tone)}>{f.label}</span>;
}

function FlagDot({ kind }: { kind: FlagKind }) {
  const color = kind === "risk" ? "bg-warn" : kind === "warn" ? "bg-amber-500" : "bg-navy-300";
  return <span className={classNames("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", color)} />;
}

function Section({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
        {title} ({count})
        <span className="ml-2 text-[11px] font-normal normal-case text-muted">{hint}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">{children}</div>;
}

function Stat({ label, value, sub, accent, warn, amber }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; amber?: boolean }) {
  return (
    <div className={classNames("rounded-card border bg-white p-4 shadow-card", accent ? "border-accent" : warn ? "border-warn/50" : amber ? "border-amber-300" : "border-cardline")}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-1 text-2xl font-bold tabular-nums", accent ? "text-accent" : warn ? "text-warn" : amber ? "text-amber-700" : "text-navy")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted">{k}</dt>
      <dd className={classNames("text-navy", mono && "font-mono")}>{v}</dd>
    </div>
  );
}
