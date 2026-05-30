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
  classification_id: string | null;
  customs_value_usd_cents: number;
  duty: Duty;
  effective_rate: number;
  confidence: number;
  flags: Flag[];
}
interface CareRecord {
  id: string;
  gri_rule_applied: string | null;
  confidence: "low" | "medium" | "high" | null;
  precision_level: string | null;
  product_description: string | null;
  candidate_count: number;
  top_candidates: { hts_code: string; score: number; description: string }[];
  citations: string[];
  alternatives_considered: { hts_code: string; rejected_because: string }[];
  missing_inputs_for_precision: string[];
  reasoning: string | null;
  model: string | null;
  prompt_version: string | null;
}
interface Queue {
  customer_id: string;
  summary: { pending: number; signed: number; flagged: number; total_value_usd_cents: number; total_duty_usd_cents: number };
  lines: Line[];
}
interface EntryFiling {
  entry_type: string; port_of_entry: string; importer_of_record: string; ior_number: string; country_of_origin: string;
  lines: { description: string; hts_code: string; value_usd_cents: number; base_duty_usd_cents: number; section_301_usd_cents: number; line_duty_usd_cents: number; hts_status: string }[];
  mpf_usd_cents: number; hmf_usd_cents: number; total_entered_value_usd_cents: number; total_duty_usd_cents: number; missing: string[]; readiness_pct: number;
}
interface Filing {
  id: string;
  shipment_ref: string;
  type: string;
  status: "pending_review" | "approved";
  title: string;
  payload: {
    isf?: { elements: { n: number; label: string; value: string; status: string }[]; readiness_pct: number; missing: string[] };
    entry?: EntryFiling;
  };
  created_at: string;
}

export default function BrokerQueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filings, setFilings] = useState<Filing[]>([]);

  const refreshFilings = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/filings`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setFilings(j.filings ?? []); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshFilings(); }, [refreshFilings]);

  const approveFiling = useCallback(async (id: string) => {
    await fetch(`${API_BASE_URL}/api/filings/${id}/approve`, { method: "POST" });
    await refreshFilings();
  }, [refreshFilings]);

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

      {filings.length > 0 && (
        <Section title="Filings — pending broker review" count={filings.filter((f) => f.status === "pending_review").length} hint="ISF & entry (7501) drafts routed from shipment coordination">
          {filings.map((f) => <FilingRow key={f.id} f={f} onApprove={() => approveFiling(f.id)} />)}
        </Section>
      )}

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
  const [record, setRecord] = useState<null | "loading" | CareRecord | { error: string }>(null);

  // Fetch the machine-checkable record once when the drawer opens. The
  // broker should see this BEFORE deciding to approve — it's the four
  // legal-steps trace the agent produced for this classification.
  useEffect(() => {
    if (!l.classification_id || record !== null) return;
    setRecord("loading");
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/audit-log/${l.classification_id}`, { cache: "no-store" });
        if (!r.ok) { setRecord({ error: `backend ${r.status}` }); return; }
        const j = (await r.json()) as { record: CareRecord };
        setRecord(j.record);
      } catch (e) {
        setRecord({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [l.classification_id, record]);

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
            <KV
              k="Confidence"
              v={`${l.source === "broker" ? "Signed" : `${Math.round(l.confidence * 100)}% (${l.confidence >= 0.9 ? "high" : l.confidence >= 0.75 ? "medium" : "low"})`}`}
            />
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

      {/* Reasonable-care record — the four legal steps the agent followed.
          Read this BEFORE approving. */}
      <div className="mt-5 rounded-md border border-cardline bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-navy px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
            Reasonable-care record
          </div>
          {typeof record === "object" && record && "gri_rule_applied" in record && (
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="rounded bg-navy-50/60 px-1.5 py-0.5 font-semibold text-navy ring-1 ring-inset ring-cardline">
                GRI {record.gri_rule_applied ?? "—"}
              </span>
              {record.confidence && (
                <span
                  className={classNames(
                    "rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider",
                    record.confidence === "high" && "bg-accent text-white",
                    record.confidence === "medium" && "bg-navy-100 text-navy",
                    record.confidence === "low" && "bg-amber-100 text-amber-800",
                  )}
                >
                  {record.confidence} confidence
                </span>
              )}
              {record.precision_level && (
                <span className="rounded bg-navy-50/60 px-1.5 py-0.5 text-navy ring-1 ring-inset ring-cardline">
                  precision: {record.precision_level}-digit
                </span>
              )}
              <span className="text-muted">Review the four legal steps before approving.</span>
            </div>
          )}
        </div>
        {record === null || record === "loading" ? (
          <p className="text-[11px] text-muted">{l.classification_id ? "Loading record…" : "No classification record on file for this line yet."}</p>
        ) : "error" in record ? (
          <p className="text-[11px] text-warn">Could not load record: {record.error}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* ① Product facts used */}
            <div>
              <PillarLabel n={1}>Product facts used</PillarLabel>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-cardline bg-navy-50/40 p-2">
                <p className="whitespace-pre-line text-[11px] leading-relaxed text-navy">
                  {record.product_description ?? "—"}
                </p>
              </div>
              {record.missing_inputs_for_precision.length > 0 && (
                <p className="mt-1 text-[10px] text-amber-700">
                  Missing for tighter precision: {record.missing_inputs_for_precision.join("; ")}
                </p>
              )}
            </div>

            {/* ② Tariff notes considered */}
            <div>
              <PillarLabel n={2}>Tariff notes considered ({record.candidate_count})</PillarLabel>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-cardline bg-navy-50/40 p-2">
                {record.top_candidates.length === 0 ? (
                  <p className="text-[11px] text-muted">no candidates recorded</p>
                ) : (
                  <ul className="space-y-1">
                    {record.top_candidates.map((tc, k) => (
                      <li key={k} className="flex gap-2 text-[11px] leading-snug">
                        <span className="w-28 shrink-0 font-mono text-navy">{tc.hts_code}</span>
                        <span className="flex-1 truncate text-muted" title={tc.description}>{tc.description || "—"}</span>
                        <span className="shrink-0 tabular-nums text-[10px] text-muted">{tc.score.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ③ CBP rulings cited */}
            <div>
              <PillarLabel n={3}>CBP rulings cited ({record.citations.length})</PillarLabel>
              <div className="mt-1 flex flex-wrap gap-1">
                {record.citations.length === 0 && <span className="text-[11px] text-muted">none</span>}
                {record.citations.map((c, k) => (
                  <span key={k} className="rounded bg-navy-50/40 px-1.5 py-0.5 font-mono text-[11px] text-navy ring-1 ring-inset ring-cardline">{c}</span>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted">Every cited code is enforced to be in the retrieved candidate set.</p>
            </div>

            {/* ④ Why competing codes were rejected */}
            <div>
              <PillarLabel n={4}>Why competing codes were rejected</PillarLabel>
              <div className="mt-1 space-y-1.5">
                {record.alternatives_considered.length === 0 ? (
                  <p className="text-[11px] text-muted">No competing codes weighed.</p>
                ) : (
                  record.alternatives_considered.map((a, k) => (
                    <div key={k} className="rounded-md border border-cardline bg-navy-50/40 p-2 text-[11px] leading-snug">
                      <div className="font-mono text-navy">{a.hts_code}</div>
                      <div className="mt-0.5 text-muted">{a.rejected_because}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Reasoning trace (full width) */}
            <div className="md:col-span-2">
              <PillarLabel n={null}>Reasoning trace</PillarLabel>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-cardline bg-navy-50/40 p-2">
                <p className="whitespace-pre-line text-[11px] leading-relaxed text-navy">{record.reasoning ?? "—"}</p>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                Audit ID <span className="font-mono">{record.id.slice(0, 8)}</span> · {record.model ?? "—"} · prompt {record.prompt_version ?? "—"}
              </p>
            </div>
          </div>
        )}
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

function FilingRow({ f, onApprove }: { f: Filing; onApprove: () => void }) {
  const [open, setOpen] = useState(false);
  const isf = f.payload?.isf;
  const entry = f.payload?.entry;
  const readiness = isf?.readiness_pct ?? entry?.readiness_pct;
  const approved = f.status === "approved";
  return (
    <div className={classNames("rounded-card border bg-white shadow-card", approved ? "border-cardline" : "border-accent/50")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={classNames("shrink-0 text-muted transition", open && "rotate-90")}>›</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-navy">{f.title}</span>
            <span className="text-[11px] text-muted">{f.type.toUpperCase()} · {f.shipment_ref}{readiness != null ? ` · ${readiness}% ready` : ""}</span>
          </span>
        </button>
        {approved ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">approved</span>
        ) : (
          <button onClick={onApprove} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700">Approve filing</button>
        )}
      </div>
      {open && isf && (
        <div className="border-t border-cardline bg-navy-50/40 px-4 py-3">
          <table className="w-full text-[11px]">
            <tbody>
              {isf.elements.map((e) => (
                <tr key={e.n} className="border-b border-cardline/40 last:border-b-0">
                  <td className="py-1 pr-2 text-muted">{e.n}.</td>
                  <td className="py-1 pr-2 text-navy">{e.label}</td>
                  <td className="py-1 pr-2 text-muted">{e.value}</td>
                  <td className="py-1 text-right text-[10px] uppercase tracking-wider text-muted">{e.status.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isf.missing.length > 0 && <div className="mt-1.5 text-[11px] text-warn">Needs from supplier/forwarder: {isf.missing.join(", ")}</div>}
        </div>
      )}
      {open && entry && (
        <div className="border-t border-cardline bg-navy-50/40 px-4 py-3 text-[11px]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <span><span className="text-muted">Entry type:</span> <span className="text-navy">{entry.entry_type}</span></span>
            <span><span className="text-muted">Port:</span> <span className="text-navy">{entry.port_of_entry}</span></span>
            <span><span className="text-muted">IOR:</span> <span className="text-navy">{entry.ior_number}</span></span>
            <span><span className="text-muted">Origin:</span> <span className="text-navy">{entry.country_of_origin}</span></span>
          </div>
          <table className="mt-2 w-full">
            <thead><tr className="border-b border-cardline text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Line</th><th className="py-1">HTS</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Line duty</th></tr></thead>
            <tbody>
              {entry.lines.map((ln, i) => (
                <tr key={i} className="border-b border-cardline/40">
                  <td className="py-1 pr-2 text-navy">{ln.description}</td>
                  <td className="py-1 pr-2 font-mono text-muted">{ln.hts_code}</td>
                  <td className="py-1 text-right tabular-nums text-muted">{fmtMoney(ln.value_usd_cents)}</td>
                  <td className="py-1 text-right tabular-nums font-semibold text-navy">{fmtMoney(ln.line_duty_usd_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 flex flex-wrap justify-end gap-x-4 text-[10px] text-muted">
            <span>MPF {fmtMoney(entry.mpf_usd_cents)}</span><span>HMF {fmtMoney(entry.hmf_usd_cents)}</span>
            <span className="font-semibold text-navy">Total duty + fees {fmtMoney(entry.total_duty_usd_cents)}</span>
          </div>
          {entry.missing.length > 0 && <div className="mt-1.5 text-[11px] text-warn">Needs before filing: {entry.missing.join(", ")}</div>}
        </div>
      )}
    </div>
  );
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

function PillarLabel({ n, children }: { n: number | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-navy">
      {n !== null && (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
          {n}
        </span>
      )}
      {children}
    </div>
  );
}
