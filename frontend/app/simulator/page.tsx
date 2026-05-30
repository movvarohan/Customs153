"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";
import { HubMap, type MapPoint } from "@/components/HubMap";
import { RichText } from "@/components/RichText";

interface RerouteHub {
  hub_city: string;
  hub_region: string;
  lat: number;
  lng: number;
  feasibility: "high" | "medium" | "low";
  example_suppliers: string[];
  note: string;
}
interface RerouteIntel {
  destination_iso2: string;
  destination_name: string;
  origin_hub: { city: string; region: string; lat: number; lng: number };
  destination_hubs: RerouteHub[];
  notable_factories: { name: string; city: string; makes: string; note: string }[];
  blended_unit_cost_index: number;
  unit_cost_premium_pct: number;
  avg_labor_cost_note: string;
  manufacturing_availability: "high" | "medium" | "low";
  lead_time_note: string;
  key_risks: string[];
  summary: string;
  sources: { title: string; url: string }[];
  research: { web_searches: number; world_bank_lookups: number };
}

interface Stack {
  base_usd_cents: number;
  section_301_usd_cents: number;
  section_232_usd_cents: number;
  reciprocal_usd_cents: number;
  mpf_usd_cents: number;
  hmf_usd_cents: number;
  total_usd_cents: number;
}
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
interface Reroute {
  active: boolean;
  to: string | null;
  unit_cost_premium_pct: number;
  annual_goods_premium_usd_cents: number;
  annual_duty_delta_usd_cents: number;
  net_annual_benefit_usd_cents: number;
  switching_cost_usd_cents: number;
  payback_months: number | null;
}
interface SimResult {
  baseline_value_usd_cents: number;
  scenario_value_usd_cents: number;
  baseline_stack: Stack;
  scenario_stack: Stack;
  delta_usd_cents: number;
  reroute: Reroute;
  rows: SimRow[];
}

interface Scenario {
  section_301_rate: number | null;
  reciprocal_rate: number;
  section_232_enabled: boolean;
  reroute_china_to: string | null;
  unit_cost_premium_pct: number;
  switching_cost_usd_cents: number;
  include_entry_fees: boolean;
}

const BASE: Scenario = {
  section_301_rate: null,
  reciprocal_rate: 0,
  section_232_enabled: true,
  reroute_china_to: null,
  unit_cost_premium_pct: 0,
  switching_cost_usd_cents: 0,
  include_entry_fees: true,
};

const REROUTE: Array<{ code: string | null; label: string; premium?: number }> = [
  { code: null, label: "Stay in China" },
  { code: "VN", label: "Vietnam", premium: 0.04 },
  { code: "MX", label: "Mexico (USMCA)", premium: 0.12 },
  { code: "IN", label: "India", premium: 0 },
];

// Named what-if scenarios a CFO would actually want to flip between.
const PRESETS: Array<{ key: string; label: string; note: string; scenario: Scenario }> = [
  { key: "today", label: "Today", note: "Current tariff table", scenario: { ...BASE } },
  { key: "301-60", label: "Section 301 → 60%", note: "Proposed escalation on China", scenario: { ...BASE, section_301_rate: 0.6 } },
  { key: "recip-10", label: "Universal 10% reciprocal", note: "2025 reciprocal framework, all origins", scenario: { ...BASE, reciprocal_rate: 0.1 } },
  { key: "stack", label: "301 + reciprocal stack", note: "60% 301 and 10% reciprocal together", scenario: { ...BASE, section_301_rate: 0.6, reciprocal_rate: 0.1 } },
  { key: "reshore-vn", label: "Reshore to Vietnam", note: "Move China sourcing, +4% goods", scenario: { ...BASE, reroute_china_to: "VN", unit_cost_premium_pct: 0.04, switching_cost_usd_cents: 25_000_00 } },
  { key: "301-off", label: "Section 301 removed", note: "China 301 goes to 0%", scenario: { ...BASE, section_301_rate: 0 } },
];

const COMPONENTS: Array<{ key: keyof Stack; label: string; color: string }> = [
  { key: "base_usd_cents", label: "Base ad valorem", color: "#2f5fd0" },
  { key: "section_301_usd_cents", label: "Section 301", color: "#d04f4f" },
  { key: "section_232_usd_cents", label: "Section 232", color: "#9a6dd0" },
  { key: "reciprocal_usd_cents", label: "Reciprocal", color: "#d08a2f" },
  { key: "mpf_usd_cents", label: "MPF", color: "#0ea672" },
  { key: "hmf_usd_cents", label: "HMF", color: "#14b8a6" },
];

export default function SimulatorPage() {
  const [sc, setSc] = useState<Scenario>({ ...BASE });
  const [data, setData] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string>("today");
  const [reIntel, setReIntel] = useState<RerouteIntel | null>(null);
  const [reLoading, setReLoading] = useState(false);
  const [reErr, setReErr] = useState<string | null>(null);

  const researchDestination = useCallback(async (iso: string) => {
    setReLoading(true);
    setReErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/reroute-intel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination_iso2: iso }),
      });
      const j = await r.json();
      if (!r.ok) { setReErr(j.error ? String(j.error).slice(0, 200) : `backend ${r.status}`); return; }
      setReIntel(j as RerouteIntel);
    } catch (e) {
      setReErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReLoading(false);
    }
  }, []);

  const run = useCallback(async (scenario: Scenario) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scenario),
      });
      if (!r.ok) { setErr(`backend ${r.status}`); return; }
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { run(sc); }, [sc, run]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setActivePreset(p.key);
    setSc({ ...p.scenario });
  };
  // Any manual edit detaches from the preset (becomes "custom").
  const edit = (patch: Partial<Scenario>) => {
    setActivePreset("custom");
    setSc((s) => ({ ...s, ...patch }));
  };

  const rerouting = sc.reroute_china_to !== null;
  const up = data ? data.delta_usd_cents > 0 : false;
  const effBaseline = data && data.baseline_value_usd_cents > 0
    ? (data.baseline_stack.total_usd_cents / data.baseline_value_usd_cents) * 100 : 0;
  const effScenario = data && data.scenario_value_usd_cents > 0
    ? (data.scenario_stack.total_usd_cents / data.scenario_value_usd_cents) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Policy lab
        </div>
        <h1 className="text-3xl font-bold text-navy">Tariff shock simulator</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Model any 2025–2026 policy move across this importer&apos;s entire catalog at once. Stack a
          Section 301 escalation, a universal reciprocal tariff, and a Section 232 carve-out — or reroute
          sourcing and let the lab weigh the duty saved against the goods-cost premium and tooling spend.
          Every figure is the same deterministic engine used to price live entries.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {/* Preset scenarios */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => applyPreset(p)} title={p.note}
            className={classNames(
              "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
              activePreset === p.key ? "border-navy bg-navy text-white" : "border-cardline bg-white text-navy hover:border-navy/40",
            )}>
            {p.label}
          </button>
        ))}
        {activePreset === "custom" && (
          <span className="rounded-md border border-dashed border-cardline px-3 py-1.5 text-xs font-semibold text-muted">Custom</span>
        )}
      </div>

      {/* Controls */}
      <div className="grid gap-5 rounded-card border border-cardline bg-white p-5 shadow-card md:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Section 301 rate on Chinese goods
            </label>
            <span className="font-mono text-lg font-bold text-navy">
              {sc.section_301_rate === null ? "table" : `${Math.round(sc.section_301_rate * 100)}%`}
            </span>
          </div>
          <input
            type="range" min={0} max={100} step={5}
            value={sc.section_301_rate === null ? 25 : Math.round(sc.section_301_rate * 100)}
            onChange={(e) => edit({ section_301_rate: Number(e.target.value) / 100 })}
            disabled={rerouting}
            className="mt-2 w-full accent-warn disabled:opacity-40"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button onClick={() => edit({ section_301_rate: null })} disabled={rerouting}
              className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-navy/40 hover:text-navy disabled:opacity-40">
              table rate
            </button>
            {[0, 25, 60, 100].map((p) => (
              <button key={p} onClick={() => edit({ section_301_rate: p / 100 })} disabled={rerouting}
                className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-navy/40 hover:text-navy disabled:opacity-40">
                {p === 0 ? "removed" : p === 60 ? "60% (proposed)" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Universal reciprocal tariff (all origins)
            </label>
            <span className="font-mono text-lg font-bold text-navy">{Math.round(sc.reciprocal_rate * 100)}%</span>
          </div>
          <input
            type="range" min={0} max={50} step={5}
            value={Math.round(sc.reciprocal_rate * 100)}
            onChange={(e) => edit({ reciprocal_rate: Number(e.target.value) / 100 })}
            className="mt-2 w-full accent-amber-500"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {[0, 10, 20].map((p) => (
              <button key={p} onClick={() => edit({ reciprocal_rate: p / 100 })}
                className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-navy/40 hover:text-navy">
                {p === 0 ? "none" : `${p}%`}
              </button>
            ))}
            <span className="text-[11px] text-muted">stacks on top of base + 301, even after rerouting</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Reroute China sourcing to</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {REROUTE.map((o) => (
              <button key={o.label}
                onClick={() => {
                  edit({ reroute_china_to: o.code, unit_cost_premium_pct: o.code ? Math.max(0, o.premium ?? 0) : 0 });
                  if (o.code !== reIntel?.destination_iso2) { setReIntel(null); setReErr(null); }
                }}
                className={classNames(
                  "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
                  sc.reroute_china_to === o.code ? "border-accent bg-accent text-white" : "border-cardline bg-white text-navy hover:border-accent/40",
                )}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Rerouting out of China drops Section 301 entirely (subject to the new country&apos;s own rules + any reciprocal tariff).</p>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-navy">
            <input type="checkbox" checked={sc.section_232_enabled} onChange={(e) => edit({ section_232_enabled: e.target.checked })} className="accent-navy" />
            Section 232 steel/aluminum add-on in effect
          </label>
          <label className="flex items-center gap-2 text-xs text-navy">
            <input type="checkbox" checked={sc.include_entry_fees} onChange={(e) => edit({ include_entry_fees: e.target.checked })} className="accent-navy" />
            Include CBP user fees (MPF + HMF), annualized
          </label>
          {rerouting && (
            <div className="rounded-md border border-cardline bg-navy-50/40 p-3">
              <div className="flex items-baseline justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Goods unit-cost change vs China</label>
                <span className="font-mono text-sm font-bold text-navy">{sc.unit_cost_premium_pct >= 0 ? "+" : ""}{Math.round(sc.unit_cost_premium_pct * 100)}%</span>
              </div>
              <input type="range" min={-10} max={40} step={1} value={Math.round(sc.unit_cost_premium_pct * 100)}
                onChange={(e) => edit({ unit_cost_premium_pct: Number(e.target.value) / 100 })}
                className="mt-1 w-full accent-accent" />
              <label className="mt-2 block text-[11px] font-semibold uppercase tracking-widest text-muted">One-time switching cost</label>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted">$</span>
                <input type="number" min={0} step={5000}
                  value={Math.round(sc.switching_cost_usd_cents / 100)}
                  onChange={(e) => edit({ switching_cost_usd_cents: Math.max(0, Math.round(Number(e.target.value))) * 100 })}
                  className="w-32 rounded-md border border-cardline px-2 py-1 text-sm tabular-nums" />
                <span className="text-[11px] text-muted">tooling, qualification, dual-running</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Headline */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
            <div className="text-[11px] uppercase tracking-wider text-muted">Today&apos;s annual duty</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-navy">{fmtMoney(data.baseline_stack.total_usd_cents)}</div>
            <div className="text-[11px] text-muted">{effBaseline.toFixed(1)}% effective on {fmtMoney(data.baseline_value_usd_cents)}</div>
          </div>
          <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
            <div className="text-[11px] uppercase tracking-wider text-muted">Under this scenario</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-navy">{fmtMoney(data.scenario_stack.total_usd_cents)}</div>
            <div className="text-[11px] text-muted">{effScenario.toFixed(1)}% effective{rerouting ? ` on ${fmtMoney(data.scenario_value_usd_cents)}` : ""}</div>
          </div>
          <div className={classNames("rounded-card border p-5 shadow-card", up ? "border-warn/50 bg-warn/5" : "border-accent bg-accent-50/50")}>
            <div className="text-[11px] uppercase tracking-wider text-muted">{up ? "Added duty / year" : "Duty saved / year"}</div>
            <div className={classNames("mt-1 text-3xl font-bold tabular-nums", up ? "text-warn" : "text-accent-700")}>
              {data.delta_usd_cents === 0 ? "—" : `${up ? "+" : "−"}${fmtMoney(Math.abs(data.delta_usd_cents))}`}
            </div>
            <div className="text-[11px] text-muted">across {data.rows.length} SKUs</div>
          </div>
        </div>
      )}

      {/* Duty composition (stacked) */}
      {data && (
        <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">Duty stack — how the bill is built</h2>
            <Legend />
          </div>
          <StackBar label="Today" stack={data.baseline_stack} max={Math.max(data.baseline_stack.total_usd_cents, data.scenario_stack.total_usd_cents)} />
          <StackBar label="Scenario" stack={data.scenario_stack} max={Math.max(data.baseline_stack.total_usd_cents, data.scenario_stack.total_usd_cents)} />
          <ComponentBridge baseline={data.baseline_stack} scenario={data.scenario_stack} />
        </div>
      )}

      {/* Reroute economics */}
      {data && data.reroute.active && (
        <div className="rounded-card border border-accent/40 bg-accent-50/30 p-5 shadow-card">
          <h2 className="mb-3 text-sm font-semibold text-navy">Reroute economics — does the move actually pay?</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <Econ label="Duty saved / year" value={fmtMoney(Math.max(0, -data.reroute.annual_duty_delta_usd_cents))} good={data.reroute.annual_duty_delta_usd_cents < 0} />
            <Econ label="Goods premium / year" value={`${data.reroute.annual_goods_premium_usd_cents > 0 ? "−" : data.reroute.annual_goods_premium_usd_cents < 0 ? "+" : ""}${fmtMoney(Math.abs(data.reroute.annual_goods_premium_usd_cents))}`} good={data.reroute.annual_goods_premium_usd_cents <= 0} />
            <Econ
              label="Net benefit / year"
              value={`${data.reroute.net_annual_benefit_usd_cents >= 0 ? "+" : "−"}${fmtMoney(Math.abs(data.reroute.net_annual_benefit_usd_cents))}`}
              good={data.reroute.net_annual_benefit_usd_cents >= 0}
              big
            />
            <Econ
              label="Switching-cost payback"
              value={data.reroute.payback_months === null ? "never" : data.reroute.payback_months < 0.1 ? "immediate" : `${data.reroute.payback_months} mo`}
              good={data.reroute.payback_months !== null}
            />
          </div>
          <p className="mt-3 text-[11px] text-muted">
            Net benefit = duty saved − the extra cost of goods at the new origin. Payback amortizes the one-time
            switching cost ({fmtMoney(data.reroute.switching_cost_usd_cents)}) against the net annual benefit.
            {data.reroute.net_annual_benefit_usd_cents < 0 && " Here the goods premium outweighs the duty saved — the move loses money before tooling is even counted."}
          </p>
        </div>
      )}

      {/* Destination intelligence (live research) */}
      {rerouting && (
        <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-navy">Destination intelligence</h2>
              <p className="text-[11px] text-muted">
                Live research on moving this catalog to {reIntel?.destination_name ?? destName(sc.reroute_china_to)} — named factories, labor &amp; capacity, freight, and a researched cost premium you can feed into the economics above.
              </p>
            </div>
            {!reIntel && (
              <button
                onClick={() => sc.reroute_china_to && researchDestination(sc.reroute_china_to)}
                disabled={reLoading}
                className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50">
                {reLoading ? "Researching…" : `Research ${destName(sc.reroute_china_to)} for this catalog`}
              </button>
            )}
          </div>

          {reErr && <div className="mt-3 rounded-md border border-warn/40 px-3 py-2 text-xs text-warn">{reErr}</div>}

          {reLoading && !reIntel && (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
              Searching the web for factories &amp; freight and pulling World Bank labor data…
            </div>
          )}

          {reIntel && <DestinationIntel intel={reIntel} appliedPct={sc.unit_cost_premium_pct}
            onApply={() => edit({ unit_cost_premium_pct: reIntel.unit_cost_premium_pct })} />}
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
        Annual import values are representative figures for the catalog; the duty math (base + Section 301 +
        Section 232 + reciprocal + CBP fees) is the same deterministic engine used to price live entries.
        Reciprocal and the flat 301 rate are hypothetical what-if overlays; the baseline reflects the current rate table.
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {COMPONENTS.map((c) => (
        <span key={c.key} className="flex items-center gap-1 text-[10px] text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} aria-hidden />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function StackBar({ label, stack, max }: { label: string; stack: Stack; max: number }) {
  const widthPct = max > 0 ? (stack.total_usd_cents / max) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className="font-mono text-sm font-bold tabular-nums text-navy">{fmtMoney(stack.total_usd_cents)}</span>
      </div>
      <div className="h-7 overflow-hidden rounded-md bg-navy-50" style={{ width: `${Math.max(widthPct, 4)}%`, minWidth: "2.5rem" }}>
        <div className="flex h-full">
          {COMPONENTS.map((c) => {
            const v = stack[c.key];
            if (!v) return null;
            const pct = stack.total_usd_cents > 0 ? (v / stack.total_usd_cents) * 100 : 0;
            return (
              <div key={c.key} title={`${c.label}: ${fmtMoney(v)}`} style={{ width: `${pct}%`, background: c.color }}
                className="h-full transition-all" />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ComponentBridge({ baseline, scenario }: { baseline: Stack; scenario: Stack }) {
  const deltas = COMPONENTS.map((c) => ({ ...c, delta: scenario[c.key] - baseline[c.key] })).filter((d) => d.delta !== 0);
  if (deltas.length === 0) return <p className="mt-2 text-[11px] text-muted">No change vs today — pick a scenario or move a lever.</p>;
  return (
    <div className="mt-3 border-t border-cardline pt-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Where the change comes from</div>
      <div className="flex flex-wrap gap-2">
        {deltas.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1.5 rounded-full border border-cardline bg-white px-2.5 py-1 text-[11px]">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: d.color }} aria-hidden />
            <span className="text-navy">{d.label}</span>
            <span className={classNames("font-semibold tabular-nums", d.delta > 0 ? "text-warn" : "text-accent-700")}>
              {d.delta > 0 ? "+" : "−"}{fmtMoney(Math.abs(d.delta))}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Econ({ label, value, good, big }: { label: string; value: string; good: boolean; big?: boolean }) {
  return (
    <div className="rounded-md border border-cardline bg-white p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames(big ? "text-2xl" : "text-lg", "mt-0.5 font-bold tabular-nums", good ? "text-accent-700" : "text-warn")}>{value}</div>
    </div>
  );
}

function destName(code: string | null): string {
  return REROUTE.find((r) => r.code === code)?.label.replace(/ \(.*\)$/, "") ?? code ?? "the destination";
}

function DestinationIntel({ intel, appliedPct, onApply }: { intel: RerouteIntel; appliedPct: number; onApply: () => void }) {
  const origin: MapPoint = { lat: intel.origin_hub.lat, lng: intel.origin_hub.lng, label: intel.origin_hub.city, sub: "China · current" };
  const hubs: MapPoint[] = intel.destination_hubs.map((h, i) => ({
    lat: h.lat, lng: h.lng, label: h.hub_city, sub: intel.destination_name, feasibility: h.feasibility, best: i === 0,
  }));
  const researchedPct = Math.round(intel.unit_cost_premium_pct * 1000) / 10;
  const applied = Math.abs(appliedPct - intel.unit_cost_premium_pct) < 0.005;

  return (
    <div className="mt-4 space-y-4 text-xs">
      <RichText text={intel.summary} className="text-sm text-navy" />

      {(intel.research.web_searches > 0 || intel.research.world_bank_lookups > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-50/30 px-3 py-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Live research</span>
          <span className="text-[11px] text-navy">{intel.research.web_searches} web searches · {intel.research.world_bank_lookups} World Bank lookups</span>
        </div>
      )}

      <HubMap origin={origin} hubs={hubs} height={320} />

      {/* Researched stats + apply */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-accent/40 bg-accent-50/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">Blended unit cost vs CN</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-navy">{intel.blended_unit_cost_index}</div>
          <div className="text-[10px] text-muted">{researchedPct >= 0 ? "+" : ""}{researchedPct}% on goods</div>
          <button onClick={onApply} disabled={applied}
            className={classNames("mt-1.5 w-full rounded-md px-2 py-1 text-[10px] font-semibold transition",
              applied ? "border border-cardline text-muted" : "bg-navy text-white hover:bg-navy/90")}>
            {applied ? "Applied to economics ✓" : "Apply premium to economics"}
          </button>
        </div>
        <Stat2 label="Labor cost" value={intel.avg_labor_cost_note} />
        <Stat2 label="Mfg availability" value={intel.manufacturing_availability} accent />
        <Stat2 label="Freight / lead time" value={intel.lead_time_note} />
      </div>

      {/* Clusters */}
      <div className="grid gap-2 md:grid-cols-3">
        {intel.destination_hubs.map((h, i) => (
          <div key={i} className={classNames("rounded-md border bg-white p-3", i === 0 ? "border-accent/50" : "border-cardline")}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-navy">{h.hub_city}</span>
              <span className={classNames("rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                h.feasibility === "high" && "bg-accent text-white",
                h.feasibility === "medium" && "bg-navy-100 text-navy",
                h.feasibility === "low" && "bg-amber-100 text-amber-800")}>{h.feasibility}</span>
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">{h.hub_region}</div>
            <RichText text={h.note} className="mt-1 text-muted" />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {h.example_suppliers.map((s, k) => (
                <span key={k} className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] text-navy">{s}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Specific factories researched */}
      {intel.notable_factories && intel.notable_factories.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
            Factories researched ({intel.notable_factories.length})
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {intel.notable_factories.map((f, i) => (
              <div key={i} className="rounded-md border border-cardline bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[13px] font-semibold text-navy">{f.name}</span>
                  <span className="text-[10px] text-muted">{f.city}</span>
                </div>
                <div className="mt-0.5 inline-block rounded bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">{f.makes}</div>
                <p className="mt-1 text-[11px] leading-snug text-muted">{f.note.replace(/\*+/g, "")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks + sources */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Key ramp risks</div>
          <ul className="space-y-1.5">
            {intel.key_risks.map((r, i) => (
              <li key={i} className="rounded-md border border-cardline bg-white p-2.5 text-muted">
                <RichText text={r} />
              </li>
            ))}
          </ul>
        </div>
        {intel.sources.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Sources ({intel.sources.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {intel.sources.map((s, i) => {
                let host = s.url;
                try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
                return (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
                    className="max-w-[14rem] truncate rounded-full border border-cardline bg-white px-2 py-0.5 text-[10px] text-accent-700 transition hover:border-accent/40 hover:bg-accent-50">
                    {host}
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat2({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-cardline bg-white p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-0.5 text-[11px]", accent ? "font-semibold capitalize text-accent-700" : "text-navy")}>{value.replace(/\*+/g, "")}</div>
    </div>
  );
}
