"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";
import { RichText } from "@/components/RichText";
import { HubMap, type MapPoint } from "@/components/HubMap";

interface CatRow {
  description: string;
  hts_code_8: string;
  chapter: string;
  origin: string;
  annual_value_usd_cents: number;
  annual_duty_usd_cents: number;
  effective_rate: number;
}
interface Catalog {
  total_value_usd_cents: number;
  total_duty_usd_cents: number;
  sku_count: number;
  rows: CatRow[];
}

interface Reloc {
  country_iso2: string;
  country_name: string;
  hub_city: string;
  hub_region: string;
  lat: number;
  lng: number;
  feasibility: "high" | "medium" | "low";
  rationale: string;
  example_suppliers: string[];
  unit_cost_index: number;
  avg_labor_cost_note: string;
  manufacturing_availability: "high" | "medium" | "low";
  ramp_time_months: number;
  lead_time_note: string;
  moq_note: string;
  annual_goods_usd_cents: number;
  annual_duty_usd_cents: number;
  total_landed_usd_cents: number;
  landed_delta_usd_cents: number;
  duty_delta_usd_cents: number;
}
interface Intel {
  current_hub: { city: string; region: string; lat: number; lng: number };
  current_annual_duty_usd_cents: number;
  current_total_landed_usd_cents: number;
  relocation_options: Reloc[];
  relief_mechanisms: { mechanism: string; applicability: "likely" | "possible" | "unlikely"; how: string; est_savings_pct: number | null }[];
  second_order_effects: { factor: string; note: string }[];
  summary: string;
  sources: { title: string; url: string }[];
  research: { web_searches: number; world_bank_lookups: number };
}

export default function CatalogPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [intel, setIntel] = useState<Record<string, Intel | "loading">>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/catalog`, { cache: "no-store" });
        if (!r.ok) { setErr(`backend ${r.status}`); return; }
        setCat(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const analyze = useCallback(
    async (row: CatRow) => {
      const key = row.hts_code_8 + row.description;
      if (openSku === key) { setOpenSku(null); return; }
      setOpenSku(key);
      if (intel[key]) return;
      setIntel((p) => ({ ...p, [key]: "loading" }));
      try {
        const r = await fetch(`${API_BASE_URL}/api/sourcing-intel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            description: row.description,
            hts_code_8: row.hts_code_8,
            current_country_iso2: row.origin,
            annual_value_usd_cents: row.annual_value_usd_cents,
          }),
        });
        if (!r.ok) {
          setErr(`intel ${r.status}`);
          setIntel((p) => { const n = { ...p }; delete n[key]; return n; });
          return;
        }
        const j = (await r.json()) as Intel;
        setIntel((p) => ({ ...p, [key]: j }));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setIntel((p) => { const n = { ...p }; delete n[key]; return n; });
      }
    },
    [openSku, intel],
  );

  const effRate = cat && cat.total_value_usd_cents > 0 ? (cat.total_duty_usd_cents / cat.total_value_usd_cents) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Catalog intelligence
        </div>
        <h1 className="text-3xl font-bold text-navy">Portfolio &amp; sourcing strategy</h1>
        <p className="mt-2 max-w-2xl text-muted">
          The whole importer catalog, classified and duty-priced. Open any SKU for the second-order play:
          where its manufacturing can realistically move (with the real duty delta of each move) and which
          customs-relief mechanisms — FTA preference, first-sale valuation, drawback, Foreign-Trade Zones,
          Section 301 exclusions — apply without moving at all.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {cat && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="SKUs in catalog" value={String(cat.sku_count)} />
          <Stat label="Annual import value" value={fmtMoney(cat.total_value_usd_cents)} />
          <Stat label="Annual duty exposure" value={fmtMoney(cat.total_duty_usd_cents)} sub={`${effRate.toFixed(1)}% effective`} accent />
        </div>
      )}

      {cat && (
        <div className="overflow-hidden rounded-card border border-cardline bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2.5 pl-4">SKU</th>
                <th className="py-2.5">HTS</th>
                <th className="py-2.5 text-right">Annual value</th>
                <th className="py-2.5 text-right">Annual duty</th>
                <th className="py-2.5 text-right">Rate</th>
                <th className="py-2.5 pr-4" />
              </tr>
            </thead>
            <tbody>
              {cat.rows.map((row, i) => {
                const key = row.hts_code_8 + row.description;
                const open = openSku === key;
                const data = intel[key];
                return (
                  <>
                    <tr key={key} className={classNames("border-b border-cardline/60 last:border-b-0", i % 2 === 1 && "bg-navy-50/30", open && "bg-accent-50/40")}>
                      <td className="py-2.5 pl-4 text-navy">{row.description}</td>
                      <td className="py-2.5 font-mono text-muted">{row.hts_code_8}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted">{fmtMoney(row.annual_value_usd_cents)}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold text-navy">{fmtMoney(row.annual_duty_usd_cents)}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted">{(row.effective_rate * 100).toFixed(1)}%</td>
                      <td className="py-2.5 pr-4 text-right">
                        <button onClick={() => analyze(row)} className="rounded-md border border-accent/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-accent-700 transition hover:bg-accent-50">
                          {open ? "Hide" : "Sourcing strategy"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={key + "-d"} className="border-b border-cardline bg-navy-50/40">
                        <td colSpan={6} className="px-4 py-4">
                          {data === "loading" || data === undefined ? (
                            <div className="flex items-center gap-2 text-xs text-muted">
                              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
                              Analyzing relocation options, relief mechanisms, and second-order effects…
                            </div>
                          ) : (
                            <IntelView intel={data} product={row.description} />
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IntelView({ intel, product }: { intel: Intel; product: string }) {
  const best = intel.relocation_options[0];
  return (
    <div className="space-y-5 text-xs">
      <RichText text={intel.summary} className="text-sm text-navy" />

      {/* Research provenance */}
      {intel.research && (intel.research.web_searches > 0 || intel.research.world_bank_lookups > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-50/30 px-3 py-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Live research</span>
          <span className="text-[11px] text-navy">
            {intel.research.web_searches} web search{intel.research.web_searches === 1 ? "" : "es"} · {intel.research.world_bank_lookups} World Bank lookup{intel.research.world_bank_lookups === 1 ? "" : "s"}
          </span>
          <span className="text-[11px] text-muted">— labor &amp; capacity figures pulled from World Bank; factories &amp; freight researched live and cited below.</span>
        </div>
      )}

      {/* Map */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Relocation map — researched manufacturing hubs</div>
        <SourcingMap intel={intel} />
      </div>

      {/* Landed-cost comparison */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Total landed cost / year (goods + duty)</div>
        <div className="overflow-x-auto rounded-md border border-cardline bg-white">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-cardline bg-navy-50 text-left uppercase tracking-wider text-muted">
                <th className="py-2 pl-3">Origin</th>
                <th className="py-2">Hub</th>
                <th className="py-2 text-right">Unit cost vs CN</th>
                <th className="py-2 text-right">Annual goods</th>
                <th className="py-2 text-right">Annual duty</th>
                <th className="py-2 text-right">Total landed</th>
                <th className="py-2 pr-3 text-right">Δ / yr</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-cardline/60 bg-navy-50/40">
                <td className="py-2 pl-3 font-semibold text-navy">Current (China)</td>
                <td className="py-2 text-muted">{intel.current_hub.city}</td>
                <td className="py-2 text-right tabular-nums text-muted">100</td>
                <td className="py-2 text-right tabular-nums text-muted">{fmtMoney(intel.current_total_landed_usd_cents - intel.current_annual_duty_usd_cents)}</td>
                <td className="py-2 text-right tabular-nums text-muted">{fmtMoney(intel.current_annual_duty_usd_cents)}</td>
                <td className="py-2 text-right tabular-nums font-semibold text-navy">{fmtMoney(intel.current_total_landed_usd_cents)}</td>
                <td className="py-2 pr-3 text-right text-muted">—</td>
              </tr>
              {intel.relocation_options.map((o, i) => {
                const saves = o.landed_delta_usd_cents < 0;
                return (
                  <tr key={i} className={classNames("border-b border-cardline/60 last:border-b-0", o === best && "bg-accent-50/40")}>
                    <td className="py-2 pl-3 font-semibold text-navy">{o.country_name}{o === best && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">best</span>}</td>
                    <td className="py-2 text-muted">{o.hub_city}</td>
                    <td className="py-2 text-right tabular-nums text-navy">{o.unit_cost_index}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{fmtMoney(o.annual_goods_usd_cents)}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{fmtMoney(o.annual_duty_usd_cents)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-navy">{fmtMoney(o.total_landed_usd_cents)}</td>
                    <td className={classNames("py-2 pr-3 text-right font-bold tabular-nums", saves ? "text-accent-700" : "text-warn")}>
                      {saves ? "−" : "+"}{fmtMoney(Math.abs(o.landed_delta_usd_cents))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] italic text-muted">Duty is the real deterministic calc on each option&apos;s customs value; unit-cost indices and lead times are researched estimates.</p>
      </div>

      {/* Hub detail cards */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Hub research</div>
        <div className="grid gap-2 md:grid-cols-2">
          {intel.relocation_options.map((o, i) => (
            <div key={i} className={classNames("rounded-md border bg-white p-3", o === best ? "border-accent/50" : "border-cardline")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold text-navy">{o.hub_city}, {o.country_name}</span>
                  <span className={classNames("ml-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    o.feasibility === "high" && "bg-accent text-white",
                    o.feasibility === "medium" && "bg-navy-100 text-navy",
                    o.feasibility === "low" && "bg-amber-100 text-amber-800")}>{o.feasibility}</span>
                </div>
                <span className="text-[10px] text-muted">ramp ~{o.ramp_time_months} mo</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
                <span>{o.hub_region}</span>
                <span className="normal-case tracking-normal">·</span>
                <span className="normal-case tracking-normal">
                  capacity:{" "}
                  <span className={classNames("font-semibold",
                    o.manufacturing_availability === "high" && "text-accent-700",
                    o.manufacturing_availability === "medium" && "text-navy",
                    o.manufacturing_availability === "low" && "text-amber-700")}>
                    {o.manufacturing_availability}
                  </span>
                </span>
              </div>
              <RichText text={o.rationale} className="mt-1 text-muted" />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {o.example_suppliers.map((sup, k) => (
                  <span key={k} className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] text-navy">{sup}</span>
                ))}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10px] text-muted">
                <div className="col-span-2"><span className="text-navy">Labor:</span> {o.avg_labor_cost_note.replace(/\*+/g, "")}</div>
                <div><span className="text-navy">Lead time:</span> {o.lead_time_note.replace(/\*+/g, "")}</div>
                <div><span className="text-navy">MOQ:</span> {o.moq_note.replace(/\*+/g, "")}</div>
              </div>
              <a
                href={`/factory-finder?product=${encodeURIComponent(product)}&country=${o.country_iso2}`}
                className="mt-2 inline-block rounded-md border border-accent/40 bg-white px-2 py-1 text-[10px] font-semibold text-accent-700 transition hover:bg-accent-50"
              >
                Vet specific factories in {o.country_name} →
              </a>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Customs relief (no move needed)</div>
          <div className="space-y-1.5">
            {intel.relief_mechanisms.map((m, i) => (
              <div key={i} className="rounded-md border border-cardline bg-white p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-navy">{m.mechanism}</span>
                  <span className={classNames("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    m.applicability === "likely" && "bg-accent text-white",
                    m.applicability === "possible" && "bg-navy-100 text-navy",
                    m.applicability === "unlikely" && "bg-cardline text-muted")}>
                    {m.applicability}
                  </span>
                  {m.est_savings_pct != null && (
                    <span className="ml-auto text-[10px] font-semibold text-accent-700">~{m.est_savings_pct}% of duty</span>
                  )}
                </div>
                <RichText text={m.how} className="mt-0.5 text-muted" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Second-order effects</div>
          <ul className="space-y-1.5">
            {intel.second_order_effects.map((e, i) => (
              <li key={i} className="rounded-md border border-cardline bg-white p-2.5">
                <span className="font-semibold text-navy">{e.factor}: </span>
                <span className="text-muted">{e.note.replace(/\*+/g, "")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Sources */}
      {intel.sources && intel.sources.length > 0 && (
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
  );
}

function SourcingMap({ intel }: { intel: Intel }) {
  const best = intel.relocation_options[0];
  const origin: MapPoint = { lat: intel.current_hub.lat, lng: intel.current_hub.lng, label: intel.current_hub.city, sub: "current origin" };
  const hubs: MapPoint[] = intel.relocation_options.map((o) => ({
    lat: o.lat,
    lng: o.lng,
    label: o.hub_city,
    sub: o.country_name,
    feasibility: o.feasibility,
    best: o === best,
  }));
  return <HubMap origin={origin} hubs={hubs} />;
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={classNames("rounded-card border bg-white p-5 shadow-card", accent ? "border-accent" : "border-cardline")}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-1 text-2xl font-bold tabular-nums", accent ? "text-accent" : "text-navy")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
