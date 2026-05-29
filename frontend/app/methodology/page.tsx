"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, classNames } from "@/lib/api";

interface Summary {
  gold_set: {
    total_cases: number;
    scored_cases: number;
    excluded_unverifiable: number;
    sourcing: string;
    verification_status: Record<string, number>;
  };
  headline: {
    model: string;
    prompt_version: string;
    gold: string;
    metrics: Array<{ label: string; value: number; n: string; target: number | null }>;
  };
  calibration: Array<{ bucket: string; n: number; top1_8: number; top3_8: number }>;
  prompt_evolution: Array<{ version: string; change: string; result: string }>;
  model_bakeoff: {
    summary: string;
    rows: Array<{ metric: string; sonnet: number; opus: number }>;
    decision: string;
  };
  retrieval_diagnostic: {
    summary: string;
    retrieval_surfaced_it: number;
    retrieval_missed_it: number;
    of_surfaced_in_top10: number;
    takeaway: string;
  };
  experiments: Array<{ name: string; outcome: string; detail: string }>;
}

const PIPELINE = [
  { n: "1", t: "Document ingestion", d: "Importer forwards the commercial invoice, packing list, BL, mill-test cert. We merge them into one structured shipment.", agent: "extractor" },
  { n: "2", t: "HTS classification", d: "Each line is classified against the full US tariff schedule with explicit GRI reasoning and at least one cited source.", agent: "classifier" },
  { n: "3", t: "Duty calculation", d: "Deterministic landed-duty math: base ad valorem + Section 301 + Section 232 + MPF + HMF, every component cited.", agent: "duty-calculator" },
  { n: "4", t: "Adversarial review", d: "Optional second pass — CROSS-grounded verifier, advocate/challenger/judge debate — pressure-tests the code.", agent: "verifier / debate" },
  { n: "5", t: "Broker review", d: "Licensed broker confirms or corrects. Corrections feed per-importer SKU memory so the same SKU is right next time.", agent: "sku-memory" },
  { n: "6", t: "Refund scan (PSC)", d: "Re-classify historical entries from scratch; quantify recoverable duty and draft Post Summary Corrections.", agent: "psc-finder" },
  { n: "7", t: "Proactive monitoring", d: "Watch the Federal Register / CBP / USTR; flag which of the importer's SKUs each change affects, with dollar impact.", agent: "tariff-monitor" },
];

const AGENTS = [
  { name: "extractor", role: "Reads PDFs/images into a structured shipment", model: "Sonnet 4.5 (native PDF)" },
  { name: "classifier", role: "Assigns the 10-digit HTS code via GRI 1-6 with citations", model: "Sonnet 4.5" },
  { name: "duty-calculator", role: "Deterministic landed-duty math — no LLM", model: "rule-based" },
  { name: "cross-verifier", role: "Checks the code against live CBP CROSS rulings", model: "Sonnet 4.5 + CROSS API" },
  { name: "debate", role: "Advocate / challenger / judge adversarial check", model: "Sonnet 4.5 ×3" },
  { name: "counterfactual", role: "Tariff-engineering alternatives with duty deltas", model: "Sonnet 4.5" },
  { name: "audit-defense", role: "Simulates a CBP focused-assessment Q&A packet", model: "Sonnet 4.5" },
  { name: "psc-finder", role: "Re-classifies historical entries, finds refunds", model: "Sonnet 4.5" },
  { name: "tariff-monitor", role: "Parses Federal Register docs, matches SKUs", model: "Sonnet 4.5 + FR API" },
  { name: "ace-browser", role: "Drives the ACE portal to pull entry summaries", model: "Playwright" },
];

export default function MethodologyPage() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/methodology`, { cache: "no-store" });
        if (!r.ok) { setErr(`backend ${r.status}`); return; }
        setS(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="space-y-12">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Measured, not asserted
        </div>
        <h1 className="text-3xl font-bold text-navy">Methodology &amp; results</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Every classification is scored against a gold set built from CBP CROSS binding rulings. The
          numbers below are measured on a held-out 97-case set — the same harness that gates every prompt
          change before it ships.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {s && (
        <>
          {/* Headline metrics */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
              Accuracy — {s.headline.model} · prompt {s.headline.prompt_version} · {s.headline.gold}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.headline.metrics.map((m) => (
                <div key={m.label} className="rounded-card border border-cardline bg-white p-5 shadow-card">
                  <div className="text-[11px] uppercase tracking-wider text-muted">{m.label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums text-navy">{m.value.toFixed(1)}%</span>
                    <span className="text-xs text-muted">{m.n}</span>
                  </div>
                  {m.target !== null && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50">
                        <div
                          className={classNames("h-full rounded-full", m.value >= m.target ? "bg-accent" : "bg-amber-400")}
                          style={{ width: `${Math.min(100, m.value)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-muted">MVP target {m.target}%</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Gold set */}
          <section className="rounded-card border border-cardline bg-navy-50 p-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-navy">The gold set</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted">{s.gold_set.sourcing}</p>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <Stat label="Total cases" value={String(s.gold_set.total_cases)} />
              <Stat label="Scored" value={String(s.gold_set.scored_cases)} />
              <Stat label="Held out (unverifiable)" value={String(s.gold_set.excluded_unverifiable)} />
              {Object.entries(s.gold_set.verification_status).map(([k, v]) => (
                <Stat key={k} label={k} value={String(v)} />
              ))}
            </div>
          </section>

          {/* Confidence calibration */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
              Confidence calibration
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-muted">
              The model&apos;s stated confidence tracks accuracy — a broker can triage on it. High-confidence
              classifications are right far more often than low.
            </p>
            <div className="overflow-hidden rounded-card border border-cardline bg-white shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="py-2.5 pl-4">Confidence</th>
                    <th className="py-2.5">Cases</th>
                    <th className="py-2.5">Top-1 @ 8-digit</th>
                    <th className="py-2.5 pr-4">Top-3 @ 8-digit</th>
                  </tr>
                </thead>
                <tbody>
                  {s.calibration.map((row) => (
                    <tr key={row.bucket} className="border-b border-cardline/60 last:border-b-0">
                      <td className="py-2.5 pl-4">
                        <span
                          className={classNames(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            row.bucket === "high" && "bg-accent text-white",
                            row.bucket === "medium" && "bg-navy-100 text-navy",
                            row.bucket === "low" && "bg-amber-100 text-amber-800",
                          )}
                        >
                          {row.bucket}
                        </span>
                      </td>
                      <td className="py-2.5 tabular-nums text-muted">{row.n}</td>
                      <td className="py-2.5 tabular-nums font-semibold text-navy">{row.top1_8}%</td>
                      <td className="py-2.5 pr-4 tabular-nums text-navy">{row.top3_8}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Prompt evolution */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
              Prompt evolution — every version measured before merge
            </h2>
            <ol className="relative space-y-4 border-l-2 border-cardline pl-6">
              {s.prompt_evolution.map((p, i) => (
                <li key={p.version} className="relative">
                  <span
                    className={classNames(
                      "absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white",
                      i === s.prompt_evolution.length - 1 ? "bg-accent" : "bg-navy",
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-navy">{p.version}</span>
                      {i === s.prompt_evolution.length - 1 && (
                        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-700">
                          current
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-navy">{p.change}</p>
                    <p className="mt-1 text-xs italic text-muted">{p.result}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Model bakeoff */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">Model bake-off</h2>
            <p className="mb-3 max-w-2xl text-sm text-muted">{s.model_bakeoff.summary}</p>
            <div className="overflow-hidden rounded-card border border-cardline bg-white shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="py-2.5 pl-4">Metric</th>
                    <th className="py-2.5">Sonnet 4.5 (shipped)</th>
                    <th className="py-2.5 pr-4">Opus 4.7</th>
                  </tr>
                </thead>
                <tbody>
                  {s.model_bakeoff.rows.map((r) => (
                    <tr key={r.metric} className="border-b border-cardline/60 last:border-b-0">
                      <td className="py-2.5 pl-4 text-navy">{r.metric}</td>
                      <td className="py-2.5 tabular-nums font-semibold text-accent-700">{r.sonnet}%</td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted">{r.opus}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs italic text-muted">{s.model_bakeoff.decision}</p>
          </section>

          {/* Retrieval diagnostic + experiments */}
          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold text-navy">Retrieval diagnostic</h3>
              <p className="mt-1 text-xs text-muted">{s.retrieval_diagnostic.summary}</p>
              <div className="mt-3 flex gap-4">
                <Stat label="Retrieved the answer" value={`${s.retrieval_diagnostic.retrieval_surfaced_it}/37`} />
                <Stat label="Missed entirely" value={`${s.retrieval_diagnostic.retrieval_missed_it}/37`} />
                <Stat label="In top-10" value={String(s.retrieval_diagnostic.of_surfaced_in_top10)} />
              </div>
              <p className="mt-3 text-xs italic text-muted">{s.retrieval_diagnostic.takeaway}</p>
            </div>
            <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold text-navy">Experiments run</h3>
              <div className="mt-2 space-y-3">
                {s.experiments.map((e) => (
                  <div key={e.name}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-navy">{e.name}</span>
                      <span
                        className={classNames(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          e.outcome.startsWith("Shipped") ? "bg-accent text-white" : "bg-amber-100 text-amber-800",
                        )}
                      >
                        {e.outcome}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{e.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Agent pipeline */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">The agent pipeline</h2>
        <div className="space-y-2">
          {PIPELINE.map((p, i) => (
            <div key={p.n} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
                  {p.n}
                </div>
                {i < PIPELINE.length - 1 && <div className="w-0.5 flex-1 bg-cardline" />}
              </div>
              <div className="mb-2 flex-1 rounded-card border border-cardline bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-navy">{p.t}</h3>
                  <span className="rounded bg-navy-50 px-2 py-0.5 font-mono text-[11px] text-accent-700">{p.agent}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{p.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Agent roster */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
          The agents ({AGENTS.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENTS.map((a) => (
            <div key={a.name} className="rounded-card border border-cardline bg-white p-4 shadow-card">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-navy">{a.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted">{a.model}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{a.role}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-navy">{value}</div>
    </div>
  );
}
