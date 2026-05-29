"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

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
  feasibility: "high" | "medium" | "low";
  rationale: string;
  annual_duty_usd_cents: number;
  duty_delta_usd_cents: number;
}
interface Intel {
  current_annual_duty_usd_cents: number;
  relocation_options: Reloc[];
  relief_mechanisms: { mechanism: string; applicability: "likely" | "possible" | "unlikely"; how: string }[];
  second_order_effects: { factor: string; note: string }[];
  summary: string;
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
                            <IntelView intel={data} />
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

function IntelView({ intel }: { intel: Intel }) {
  return (
    <div className="space-y-4 text-xs">
      <p className="text-navy">{intel.summary}</p>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Where it could move (duty-priced)</div>
        <div className="space-y-1.5">
          {intel.relocation_options.map((o, i) => {
            const saves = o.duty_delta_usd_cents < 0;
            return (
              <div key={i} className="rounded-md border border-cardline bg-white p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className={classNames("mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      o.feasibility === "high" && "bg-accent text-white",
                      o.feasibility === "medium" && "bg-navy-100 text-navy",
                      o.feasibility === "low" && "bg-amber-100 text-amber-800")}>
                      {o.feasibility} feasibility
                    </span>
                    <span className="font-semibold text-navy">{o.country_name}</span>
                  </div>
                  <span className={classNames("font-bold tabular-nums", o.duty_delta_usd_cents === 0 ? "text-muted" : saves ? "text-accent-700" : "text-warn")}>
                    {o.duty_delta_usd_cents === 0 ? "no duty change" : `${saves ? "−" : "+"}${fmtMoney(Math.abs(o.duty_delta_usd_cents))}/yr`}
                  </span>
                </div>
                <p className="mt-1 text-muted">{o.rationale}</p>
              </div>
            );
          })}
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
                </div>
                <p className="mt-0.5 text-muted">{m.how}</p>
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
                <span className="text-muted">{e.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
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
