"use client";

import { useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

interface DutyComponent { kind: string; rate: number | null; amount_usd_cents: number; source_citation: string }
interface Quote {
  classification: {
    hts_code: string;
    hts_code_8: string;
    confidence: string;
    precision_level: string;
    gri_rule_applied: string;
    citations: string[];
    reasoning: string;
    alternative_codes_considered: { hts_code: string; rejected_because: string }[];
  };
  country_of_origin: string;
  transport_mode: "ocean" | "air";
  customs_value_usd_cents: number;
  duty: { total_duty_usd_cents: number; components: DutyComponent[] };
  freight_estimate_usd_cents: number;
  landed_cost_usd_cents: number;
  effective_duty_rate: number;
}

const COUNTRIES = ["China", "Vietnam", "India", "Mexico", "Thailand", "Malaysia", "Indonesia", "Taiwan"];
const KIND_LABEL: Record<string, string> = {
  base_ad_valorem: "Base ad valorem",
  section_301: "Section 301 (China)",
  section_232: "Section 232 (steel/aluminum)",
  merchandise_processing_fee: "Merchandise Processing Fee",
  harbor_maintenance_fee: "Harbor Maintenance Fee",
};

export default function QuotePage() {
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("25000");
  const [country, setCountry] = useState("China");
  const [mode, setMode] = useState<"ocean" | "air">("ocean");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setBusy(true);
    setQuote(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          customs_value_usd_cents: Math.round(Number(value) * 100),
          country_of_origin: country,
          transport_mode: mode,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ? String(j.error).slice(0, 200) : `backend ${r.status}`); return; }
      setQuote(j as Quote);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const SAMPLES = [
    "Wireless Bluetooth earbuds with charging case",
    "Stainless steel insulated water bottle, 750 ml",
    "Cotton knit t-shirt, men's, short sleeve",
    "LED desk lamp with adjustable aluminum arm",
  ];

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Instant quote
        </div>
        <h1 className="text-3xl font-bold text-navy">Landed-cost quote</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Describe a product and we classify it, price the full duty stack (base + Section 301 + Section 232 +
          CBP fees), estimate freight, and return the total landed cost — the number you actually need to price
          a product or compare a supplier. A licensed broker confirms the classification before anything is filed.
        </p>
      </header>

      {/* Form */}
      <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
        <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Product description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Wireless Bluetooth earbuds with charging case, ABS plastic housing, lithium-ion battery"
          className="mt-1 h-20 w-full resize-none rounded-md border border-cardline bg-white px-3 py-2 text-sm"
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} onClick={() => setDescription(s)} className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-accent/40 hover:text-navy">
              {s.length > 38 ? s.slice(0, 38) + "…" : s}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Customs value (USD)</label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sm text-muted">$</span>
              <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border border-cardline px-2 py-1.5 text-sm tabular-nums" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Country of origin</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 w-full rounded-md border border-cardline bg-white px-2 py-1.5 text-sm">
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Transport</label>
            <div className="mt-1 flex gap-2">
              {(["ocean", "air"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={classNames("flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition",
                    mode === m ? "border-accent bg-accent text-white" : "border-cardline bg-white text-navy hover:border-accent/40")}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={run}
          disabled={busy || description.trim().length < 3}
          className={classNames("mt-4 rounded-md px-4 py-2 text-sm font-semibold transition",
            busy || description.trim().length < 3 ? "cursor-not-allowed bg-navy-100 text-muted" : "bg-navy text-white hover:bg-navy/90")}>
          {busy ? "Classifying & pricing…" : "Get landed-cost quote"}
        </button>
      </div>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {busy && (
        <div className="flex items-center gap-2 rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          Running the classification agent (GRI 1–6) and the deterministic duty engine…
        </div>
      )}

      {quote && <QuoteView q={quote} />}
    </div>
  );
}

function QuoteView({ q }: { q: Quote }) {
  const comps = q.duty.components.filter((c) => c.amount_usd_cents > 0);
  const goods = q.customs_value_usd_cents;
  return (
    <div className="space-y-4">
      {/* Headline landed cost */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
          <div className="text-[11px] uppercase tracking-wider text-muted">Classified as</div>
          <div className="mt-1 font-mono text-2xl font-bold text-navy">{q.classification.hts_code}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span>GRI {q.classification.gri_rule_applied}</span>
            <span className="rounded-full bg-accent-50 px-1.5 py-0.5 font-semibold text-accent-700">conf {q.classification.confidence}</span>
            {q.classification.precision_level !== "10" && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">{q.classification.precision_level}-digit</span>}
          </div>
        </div>
        <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
          <div className="text-[11px] uppercase tracking-wider text-muted">Total duty &amp; fees</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-navy">{fmtMoney(q.duty.total_duty_usd_cents)}</div>
          <div className="text-[11px] text-muted">{(q.effective_duty_rate * 100).toFixed(1)}% effective · {q.country_of_origin}</div>
        </div>
        <div className="rounded-card border border-accent bg-accent-50/50 p-5 shadow-card">
          <div className="text-[11px] uppercase tracking-wider text-muted">Total landed cost</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-accent-700">{fmtMoney(q.landed_cost_usd_cents)}</div>
          <div className="text-[11px] text-muted">goods + duty + est. freight</div>
        </div>
      </div>

      {/* Cost waterfall */}
      <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-navy">Landed-cost breakdown</h2>
        <table className="w-full text-sm">
          <tbody>
            <CostRow label="Customs value (goods)" value={goods} />
            {comps.map((c, i) => (
              <CostRow key={i} label={KIND_LABEL[c.kind] ?? c.kind} value={c.amount_usd_cents}
                {...(c.rate != null ? { rate: `${(c.rate * 100).toFixed(c.rate < 0.01 ? 3 : 1)}%` } : {})} indent />
            ))}
            <CostRow label="Estimated ocean/air freight" value={q.freight_estimate_usd_cents} muted note="estimate" />
            <tr className="border-t-2 border-navy/20">
              <td className="py-2.5 font-bold text-navy">Total landed cost</td>
              <td />
              <td className="py-2.5 text-right text-lg font-bold tabular-nums text-navy">{fmtMoney(q.landed_cost_usd_cents)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] italic text-muted">
          Freight is a rough estimate (real rate depends on lane, volume, and Incoterms). Duty is the deterministic
          engine; the classification is agent-generated and must be confirmed by a licensed broker before filing.
        </p>
      </div>

      {/* Classification detail */}
      <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-navy">Why this classification</h2>
        <p className="text-sm leading-relaxed text-muted">{q.classification.reasoning}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Cited authority</div>
            <ul className="mt-1 space-y-1">
              {q.classification.citations.map((c, i) => (
                <li key={i} className="rounded border border-cardline bg-navy-50/40 px-2 py-1 text-[11px] text-navy">{c}</li>
              ))}
            </ul>
          </div>
          {q.classification.alternative_codes_considered.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Alternatives ruled out</div>
              <ul className="mt-1 space-y-1">
                {q.classification.alternative_codes_considered.map((a, i) => (
                  <li key={i} className="text-[11px]">
                    <span className="font-mono text-navy">{a.hts_code}</span>
                    <span className="text-muted"> — {a.rejected_because}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CostRow({ label, value, rate, indent, muted, note }: { label: string; value: number; rate?: string; indent?: boolean; muted?: boolean; note?: string }) {
  return (
    <tr className="border-b border-cardline/50 last:border-b-0">
      <td className={classNames("py-2", indent ? "pl-4 text-muted" : "text-navy", muted && "text-muted")}>
        {label}
        {note && <span className="ml-1.5 rounded bg-navy-50 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted">{note}</span>}
      </td>
      <td className="py-2 text-right text-[11px] tabular-nums text-muted">{rate ?? ""}</td>
      <td className="py-2 text-right tabular-nums text-navy">{fmtMoney(value)}</td>
    </tr>
  );
}
