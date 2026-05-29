"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

interface SimRow {
  description: string;
  hts_code_8: string;
  chapter: string;
  origin: string;
  annual_value_usd_cents: number;
  baseline_duty_usd_cents: number;
  scenario_duty_usd_cents: number;
  delta_usd_cents: number;
}
interface SimResult {
  baseline_total_usd_cents: number;
  scenario_total_usd_cents: number;
  delta_usd_cents: number;
  baseline_value_usd_cents: number;
  rows: SimRow[];
}

const REROUTE = [
  { code: null as string | null, label: "Stay in China" },
  { code: "VN", label: "Vietnam" },
  { code: "MX", label: "Mexico (USMCA)" },
  { code: "IN", label: "India" },
];

export default function SimulatorPage() {
  const [rate, setRate] = useState(25); // % hypothetical Section 301
  const [reroute, setReroute] = useState<string | null>(null);
  const [data, setData] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (section_301_rate: number, reroute_china_to: string | null) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section_301_rate: section_301_rate / 100, reroute_china_to }),
      });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    run(rate, reroute);
  }, [rate, reroute, run]);

  const up = data ? data.delta_usd_cents > 0 : false;
  const effRateBaseline = data && data.baseline_value_usd_cents > 0
    ? (data.baseline_total_usd_cents / data.baseline_value_usd_cents) * 100 : 0;
  const effRateScenario = data && data.baseline_value_usd_cents > 0
    ? (data.scenario_total_usd_cents / data.baseline_value_usd_cents) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Policy lab
        </div>
        <h1 className="text-3xl font-bold text-navy">Tariff shock simulator</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Model a policy change across this importer&apos;s entire catalog at once. Move the Section 301
          rate or reroute sourcing and watch the annual duty exposure recompute, per SKU — the
          trade-strategy view a CFO actually wants before the next tariff headline lands.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {/* Controls */}
      <div className="grid gap-4 rounded-card border border-cardline bg-white p-5 shadow-card md:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Hypothetical Section 301 rate on Chinese goods
            </label>
            <span className="font-mono text-lg font-bold text-navy">{rate}%</span>
          </div>
          <input
            type="range" min={0} max={100} step={5} value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            disabled={reroute !== null}
            className="mt-2 w-full accent-accent disabled:opacity-40"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[0, 25, 60, 100].map((p) => (
              <button key={p} onClick={() => setRate(p)} disabled={reroute !== null}
                className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-accent/40 hover:text-navy disabled:opacity-40">
                {p === 0 ? "removed" : p === 60 ? "60% (proposed)" : `${p}%`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Reroute China sourcing to
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {REROUTE.map((o) => (
              <button key={o.label} onClick={() => setReroute(o.code)}
                className={classNames(
                  "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
                  reroute === o.code ? "border-accent bg-accent text-white" : "border-cardline bg-white text-navy hover:border-accent/40",
                )}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Rerouting out of China drops Section 301 entirely (subject to the new country&apos;s own rules).</p>
        </div>
      </div>

      {/* Headline */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
            <div className="text-[11px] uppercase tracking-wider text-muted">Today&apos;s annual duty</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-navy">{fmtMoney(data.baseline_total_usd_cents)}</div>
            <div className="text-[11px] text-muted">{effRateBaseline.toFixed(1)}% effective on {fmtMoney(data.baseline_value_usd_cents)}</div>
          </div>
          <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
            <div className="text-[11px] uppercase tracking-wider text-muted">Under this scenario</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-navy">{fmtMoney(data.scenario_total_usd_cents)}</div>
            <div className="text-[11px] text-muted">{effRateScenario.toFixed(1)}% effective</div>
          </div>
          <div className={classNames("rounded-card border p-5 shadow-card", up ? "border-warn/50 bg-warn/5" : "border-accent bg-accent-50/50")}>
            <div className="text-[11px] uppercase tracking-wider text-muted">{up ? "Added cost / year" : "Saved / year"}</div>
            <div className={classNames("mt-1 text-3xl font-bold tabular-nums", up ? "text-warn" : "text-accent-700")}>
              {up ? "+" : "−"}{fmtMoney(Math.abs(data.delta_usd_cents))}
            </div>
            <div className="text-[11px] text-muted">across {data.rows.length} SKUs</div>
          </div>
        </div>
      )}

      {/* Per-SKU */}
      {data && (
        <div className="overflow-x-auto rounded-card border border-cardline bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2.5 pl-4">SKU</th>
                <th className="py-2.5">HTS</th>
                <th className="py-2.5 text-right">Annual value</th>
                <th className="py-2.5 text-right">Today</th>
                <th className="py-2.5 text-right">Scenario</th>
                <th className="py-2.5 pr-4 text-right">Δ / year</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const rUp = r.delta_usd_cents > 0;
                const flat = r.delta_usd_cents === 0;
                return (
                  <tr key={i} className={classNames("border-b border-cardline/60 last:border-b-0", i % 2 === 1 && "bg-navy-50/30")}>
                    <td className="py-2.5 pl-4 text-navy">{r.description}</td>
                    <td className="py-2.5 font-mono text-muted">{r.hts_code_8}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted">{fmtMoney(r.annual_value_usd_cents)}</td>
                    <td className="py-2.5 text-right tabular-nums text-navy">{fmtMoney(r.baseline_duty_usd_cents)}</td>
                    <td className="py-2.5 text-right tabular-nums text-navy">{fmtMoney(r.scenario_duty_usd_cents)}</td>
                    <td className={classNames("py-2.5 pr-4 text-right font-semibold tabular-nums", flat ? "text-muted" : rUp ? "text-warn" : "text-accent-700")}>
                      {flat ? "—" : `${rUp ? "+" : "−"}${fmtMoney(Math.abs(r.delta_usd_cents))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] italic text-muted">
        Annual import values are representative figures for the demo catalog; duty math is the same
        deterministic engine used everywhere else (base + Section 301 + Section 232).
      </p>
    </div>
  );
}
