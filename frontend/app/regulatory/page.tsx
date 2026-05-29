"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames } from "@/lib/api";

interface ImpactDoc {
  document_number: string;
  title: string;
  abstract: string | null;
  publication_date: string;
  html_url: string;
  agencies: string[];
  impact: {
    category: string;
    direction: "duty_up" | "duty_down" | "neutral" | "uncertain";
    affected_hts_codes_8: string[];
    affected_countries_iso2: string[];
    effective_date: string | null;
    broker_summary: string;
  } | null;
  impact_error?: string;
  affected_skus: Array<{ description: string; hts_code: string; hts_code_8: string; source: "agent" | "broker" }>;
}

export default function RegulatoryPage() {
  const [data, setData] = useState<{ fetched_at: string; documents: ImpactDoc[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/regulatory-watch`, { cache: "no-store" });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="space-y-8">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Proactive watch
        </div>
        <h1 className="text-3xl font-bold text-navy">Federal Register — tariff impact</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Watches CBP, USTR, USITC, and Commerce. Each new document is parsed for HTS codes, countries
          affected, and financial direction; matches against this importer's per-customer SKU memory are
          flagged so the broker can reach out before the importer notices the change on their next entry.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md border border-accent/40 bg-white px-3.5 py-1.5 text-xs font-semibold text-accent-700 shadow-sm transition hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Polling Federal Register…" : "Refresh"}
          </button>
          {data && (
            <span className="text-[11px] text-muted">
              Last polled {new Date(data.fetched_at).toLocaleString()} · {data.documents.length} docs
            </span>
          )}
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>
      )}

      {data && (
        <div className="space-y-4">
          {data.documents.map((d) => {
            const i = d.impact;
            const flagged = d.affected_skus.length > 0;
            return (
              <div
                key={d.document_number}
                className={classNames(
                  "rounded-card border p-4 shadow-card",
                  flagged ? "border-accent bg-accent-50/40" : "border-cardline bg-white",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-widest text-muted">
                    {d.publication_date} · {d.agencies.join(" / ") || "—"} · {d.document_number}
                  </div>
                  {i && (
                    <span
                      className={classNames(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        i.direction === "duty_up" && "bg-warn/20 text-warn",
                        i.direction === "duty_down" && "bg-accent text-white",
                        i.direction === "neutral" && "bg-cardline text-muted",
                        i.direction === "uncertain" && "bg-amber-100 text-amber-800",
                      )}
                    >
                      {i.direction.replace("_", " ")}
                    </span>
                  )}
                </div>
                <a
                  href={d.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-sm font-semibold text-navy hover:text-accent-700"
                >
                  {d.title}
                </a>
                {i && (
                  <p className="mt-1.5 text-xs text-navy">{i.broker_summary}</p>
                )}
                {!i && d.impact_error && (
                  <p className="mt-1.5 text-[11px] italic text-warn">
                    parse failed: {d.impact_error.slice(0, 160)}
                  </p>
                )}
                {i && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="rounded bg-navy-50 px-1.5 py-0.5 font-mono">{i.category}</span>
                    {i.effective_date && (
                      <span>
                        effective <span className="text-navy">{i.effective_date}</span>
                      </span>
                    )}
                    {i.affected_countries_iso2.length > 0 && (
                      <span>
                        countries:{" "}
                        {i.affected_countries_iso2.map((c) => (
                          <span key={c} className="mr-1 rounded bg-white px-1 font-mono text-navy">
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                    {i.affected_hts_codes_8.length > 0 && (
                      <span>
                        HTS:{" "}
                        {i.affected_hts_codes_8.slice(0, 8).map((c) => (
                          <span key={c} className="mr-1 rounded bg-white px-1 font-mono text-navy">
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                {flagged && (
                  <div className="mt-2 rounded-md border border-accent/40 bg-white p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-accent-700">
                      Affects this importer ({d.affected_skus.length} SKU{d.affected_skus.length === 1 ? "" : "s"})
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {d.affected_skus.map((s, k) => (
                        <li key={k} className="text-[11px] text-navy">
                          <span className="mr-2 font-mono text-accent-700">{s.hts_code_8}</span>
                          {s.description}
                          {s.source === "broker" && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">
                              broker-confirmed
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
