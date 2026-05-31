"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, classNames, readNDJSON } from "@/lib/api";
import { RichText } from "@/components/RichText";

type Fit = "high" | "medium" | "low";
interface Factory {
  name: string;
  city: string;
  region: string;
  website: string | null;
  product_lines: string[];
  certifications: string[];
  scale_note: string;
  accepting_new_clients: "yes" | "likely" | "unknown" | "no";
  available_capacity: "open" | "moderate" | "tight" | "unknown";
  onboarding_lead_time: string;
  moq_note: string;
  key_customers: string[];
  tactical_bridge_fit: Fit;
  strategic_partner_fit: Fit;
  recommendation: "temporary" | "long_term" | "both" | "neither";
  horizon_rationale: string;
  risk_note: string;
}
interface Result {
  search_summary: string;
  country_labor_note: string;
  factories: Factory[];
  sources: { title: string; url: string }[];
  research: { web_searches: number; world_bank_lookups: number };
}

const COUNTRIES: Array<{ name: string; iso2: string }> = [
  { name: "Vietnam", iso2: "VN" }, { name: "India", iso2: "IN" }, { name: "Mexico", iso2: "MX" },
  { name: "Thailand", iso2: "TH" }, { name: "Malaysia", iso2: "MY" }, { name: "Indonesia", iso2: "ID" },
  { name: "Bangladesh", iso2: "BD" }, { name: "Cambodia", iso2: "KH" }, { name: "Taiwan", iso2: "TW" },
];
const SAMPLES = [
  "Wireless Bluetooth earbuds with charging case",
  "Stainless steel insulated water bottle, 750 ml",
  "Injection-molded polypropylene food storage containers",
  "LED desk lamp with aluminum arm",
];

export default function FactoryFinderPage() {
  const [product, setProduct] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0]!);
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // The product/country the current results were researched for (deep-dive uses these).
  const [searched, setSearched] = useState<{ product: string; country: string } | null>(null);

  // Prefill from ?product=&country= (wired from Catalog / Policy Lab).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pq = q.get("product");
    const cq = q.get("country");
    if (pq) setProduct(pq);
    if (cq) {
      const m = COUNTRIES.find((c) => c.iso2 === cq.toUpperCase() || c.name.toLowerCase() === cq.toLowerCase());
      if (m) setCountry(m);
    }
  }, []);

  const run = async () => {
    setErr(null); setBusy(true); setData(null); setStatus("Starting research…");
    setSearched({ product, country: country.name });
    try {
      const r = await fetch(`${API_BASE_URL}/api/factory-finder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_description: product, country_iso2: country.iso2, country_name: country.name }),
      });
      if (!r.ok || !r.body) { setErr(`backend ${r.status}`); return; }
      for await (const evt of readNDJSON(r)) {
        const e = evt as { type: string; message?: string; result?: Result };
        if (e.type === "status" && e.message) setStatus(e.message);
        else if (e.type === "done" && e.result) setData(e.result);
        else if (e.type === "error") setErr(cleanErr(e.message ?? "research failed"));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Factory finder
        </div>
        <h1 className="text-3xl font-bold text-navy">Find &amp; vet specific factories</h1>
        <p className="mt-2 max-w-2xl text-muted">
          The agent researches named contract manufacturers for your product in a target country — their
          capabilities and certifications, whether they&apos;re taking new clients and how much capacity is open,
          and an explicit read on each as a fast <span className="font-semibold text-navy">temporary bridge</span> vs
          a <span className="font-semibold text-navy">long-term partner</span>. Every profile is researched live and cited.
        </p>
      </header>

      {/* Form */}
      <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
        <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Product</label>
        <textarea value={product} onChange={(e) => setProduct(e.target.value)}
          placeholder="e.g. Wireless Bluetooth earbuds with charging case"
          className="mt-1 h-16 w-full resize-none rounded-md border border-cardline bg-white px-3 py-2 text-sm" />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} onClick={() => setProduct(s)} className="rounded-full border border-cardline px-2 py-0.5 text-[11px] text-muted transition hover:border-accent/40 hover:text-navy">
              {s.length > 36 ? s.slice(0, 36) + "…" : s}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted">Country</label>
            <select value={country.iso2} onChange={(e) => setCountry(COUNTRIES.find((c) => c.iso2 === e.target.value)!)}
              className="mt-1 block rounded-md border border-cardline bg-white px-3 py-1.5 text-sm">
              {COUNTRIES.map((c) => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={run} disabled={busy || product.trim().length < 3}
            className={classNames("rounded-md px-4 py-2 text-sm font-semibold transition",
              busy || product.trim().length < 3 ? "cursor-not-allowed bg-navy-100 text-muted" : "bg-navy text-white hover:bg-navy/90")}>
            {busy ? "Researching factories…" : "Find factories"}
          </button>
        </div>
      </div>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {busy && (
        <div className="flex items-center gap-2 rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {status || "Searching the web for named factories, certifications, capacity signals, and customers…"}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-card border border-cardline bg-white p-5 shadow-card">
            <RichText text={data.search_summary} className="text-sm text-navy" />
            <RichText text={data.country_labor_note} className="mt-2 text-[11px] text-muted" />
            {(data.research.web_searches > 0 || data.research.world_bank_lookups > 0) && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent-50/30 px-2.5 py-1">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Live research</span>
                <span className="text-[11px] text-navy">{data.research.web_searches} web searches · {data.research.world_bank_lookups} World Bank lookups · {data.sources.length} sources</span>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.factories.map((f, i) => (
              <FactoryCard key={i} f={f} product={searched?.product ?? product} country={searched?.country ?? country.name} />
            ))}
          </div>

          {data.sources.length > 0 && (
            <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Sources ({data.sources.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {data.sources.map((s, i) => {
                  let host = s.url; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                  return <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
                    className="max-w-[14rem] truncate rounded-full border border-cardline bg-white px-2 py-0.5 text-[10px] text-accent-700 transition hover:border-accent/40 hover:bg-accent-50">{host}</a>;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FactoryCard({ f, product, country }: { f: Factory; product: string; country: string }) {
  const rec = {
    temporary: { label: "Temporary bridge", tone: "bg-amber-100 text-amber-800" },
    long_term: { label: "Long-term partner", tone: "bg-accent text-white" },
    both: { label: "Bridge + long-term", tone: "bg-navy text-white" },
    neither: { label: "Not recommended", tone: "bg-cardline text-muted" },
  }[f.recommendation];

  return (
    <div className="flex flex-col rounded-card border border-cardline bg-white p-4 shadow-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-navy">{f.name}</div>
          <div className="text-[11px] text-muted">{f.city} · {f.region}</div>
        </div>
        <span className={classNames("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", rec.tone)}>{rec.label}</span>
      </div>

      {/* Capabilities */}
      <div className="mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Capabilities</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {f.product_lines.map((p, i) => <span key={i} className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] text-navy">{p}</span>)}
        </div>
        {f.certifications.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {f.certifications.map((c, i) => <span key={i} className="rounded border border-accent/30 bg-accent-50/40 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">{c}</span>)}
          </div>
        )}
        <RichText text={f.scale_note} className="mt-1.5 text-[11px] text-muted" />
      </div>

      {/* Openings */}
      <div className="mt-3 rounded-md border border-cardline bg-navy-50/40 p-2.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Openings</div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Signal label="New clients" value={f.accepting_new_clients} />
          <Signal label="Open capacity" value={f.available_capacity} />
          <div><span className="text-muted">Onboarding:</span> <span className="text-navy">{f.onboarding_lead_time}</span></div>
          <div><span className="text-muted">MOQ:</span> <span className="text-navy">{f.moq_note}</span></div>
        </div>
      </div>

      {/* Horizon */}
      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Temporary vs long-term</div>
        <div className="grid grid-cols-2 gap-3">
          <FitMeter label="Tactical bridge" fit={f.tactical_bridge_fit} />
          <FitMeter label="Long-term partner" fit={f.strategic_partner_fit} />
        </div>
        <RichText text={f.horizon_rationale} className="mt-1.5 text-[11px] text-muted" />
      </div>

      {/* Customers + risk */}
      <div className="mt-3 space-y-1.5 border-t border-cardline pt-2 text-[11px]">
        {f.key_customers.length > 0 && (
          <div><span className="text-muted">Known customers:</span> <span className="text-navy">{f.key_customers.join(", ")}</span></div>
        )}
        <div><span className="font-semibold text-warn">Risk:</span> <RichText text={f.risk_note} className="text-muted" inline /></div>
        {f.website && (
          <a href={f.website.startsWith("http") ? f.website : `https://${f.website}`} target="_blank" rel="noopener noreferrer"
            className="inline-block text-[11px] font-semibold text-accent-700 hover:underline">{f.website.replace(/^https?:\/\//, "")} →</a>
        )}
      </div>

      <DeepDive factory={f} product={product} country={country} />
    </div>
  );
}

interface DeepDiveResult {
  profile: {
    overview: string;
    founded: string | null;
    ownership: string;
    workforce_scale: string;
    facilities: string;
    product_capabilities: string[];
    certifications: string[];
    notable_customers: string[];
    recent_developments: { period: string; note: string }[];
    diligence_flags: { kind: "positive" | "watch" | "risk"; note: string }[];
    engagement_fit: string;
    draft_outreach: { subject: string; body: string };
    confidence_note: string;
  };
  sources: { title: string; url: string }[];
  research: { web_searches: number; world_bank_lookups: number };
}

function DeepDive({ factory, product, country }: { factory: Factory; product: string; country: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<null | "loading" | DeepDiveResult>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setOpen(true);
    if (state && state !== "loading") return; // already loaded
    setState("loading"); setErr(null); setStatus("Starting deep dive…");
    try {
      const r = await fetch(`${API_BASE_URL}/api/factory-deepdive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factory_name: factory.name, city: factory.city, country_name: country, product_description: product }),
      });
      if (!r.ok || !r.body) { setErr(`backend ${r.status}`); setState(null); return; }
      for await (const evt of readNDJSON(r)) {
        const e = evt as { type: string; message?: string; result?: DeepDiveResult };
        if (e.type === "status" && e.message) setStatus(e.message);
        else if (e.type === "done" && e.result) setState(e.result);
        else if (e.type === "error") { setErr(cleanErr(e.message ?? "deep dive failed")); setState(null); }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setState(null);
    }
  };

  const res = state && state !== "loading" ? state : null;
  const p = res ? res.profile : null;
  const copyEmail = () => {
    if (!p) return;
    navigator.clipboard?.writeText(`Subject: ${p.draft_outreach.subject}\n\n${p.draft_outreach.body}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-3 border-t border-cardline pt-2">
      <button onClick={() => (open ? setOpen(false) : run())}
        className="flex w-full items-center justify-between text-[11px] font-semibold text-accent-700 transition hover:text-accent">
        <span>{open ? "Hide deep dive" : "Deep dive — diligence + draft RFQ email"}</span>
        <span className={classNames("transition", open && "rotate-90")}>›</span>
      </button>

      {open && (
        <div className="mt-2">
          {err && <div className="rounded-md border border-warn/40 px-2 py-1 text-[11px] text-warn">{err}</div>}
          {state === "loading" && (
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />{status}
            </div>
          )}
          {p && (
            <div className="space-y-3 text-[11px]">
              <RichText text={p.overview} className="text-navy" />

              <div className="grid grid-cols-2 gap-1.5 rounded-md bg-navy-50/40 p-2.5">
                <KVm k="Founded" v={p.founded ?? "—"} />
                <KVm k="Ownership" v={p.ownership} />
                <KVm k="Workforce" v={p.workforce_scale} />
                <KVm k="Facilities" v={p.facilities} />
              </div>

              {p.recent_developments.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Recent developments</div>
                  <ul className="mt-1 space-y-1">
                    {p.recent_developments.map((d, i) => (
                      <li key={i}><span className="font-medium text-navy">{d.period}:</span> <RichText text={d.note} className="text-muted" inline /></li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Due-diligence flags</div>
                <ul className="mt-1 space-y-1">
                  {p.diligence_flags.map((d, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className={classNames("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", d.kind === "risk" ? "bg-warn" : d.kind === "watch" ? "bg-amber-500" : "bg-accent")} />
                      <span className="text-muted"><span className="font-medium capitalize text-navy">{d.kind}:</span> <RichText text={d.note} className="text-muted" inline /></span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md bg-navy-50/40 p-2.5">
                <span className="font-semibold text-navy">How to engage: </span>
                <RichText text={p.engagement_fit} className="text-muted" inline />
              </div>

              {/* Draft outreach email */}
              <div className="rounded-md border border-accent/40 bg-white p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-700">Draft outreach email</span>
                  <button onClick={copyEmail} className="rounded border border-accent/40 px-2 py-0.5 text-[10px] font-semibold text-accent-700 hover:bg-accent-50">
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div className="text-navy"><span className="text-muted">Subject:</span> {p.draft_outreach.subject}</div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-snug text-muted">{p.draft_outreach.body}</pre>
              </div>

              <RichText text={p.confidence_note} className="text-[10px] italic text-muted" />

              {res && res.sources.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {res.sources.slice(0, 8).map((s, i) => {
                    let host = s.url; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                    return <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
                      className="max-w-[12rem] truncate rounded-full border border-cardline px-1.5 py-0.5 text-[9px] text-accent-700 hover:bg-accent-50">{host}</a>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KVm({ k, v }: { k: string; v: string }) {
  return <div><span className="text-muted">{k}:</span> <RichText text={v} className="text-navy" inline /></div>;
}

function Signal({ label, value }: { label: string; value: string }) {
  const tone =
    value === "yes" || value === "open" ? "text-accent-700"
      : value === "likely" || value === "moderate" ? "text-navy"
        : value === "no" || value === "tight" ? "text-warn"
          : "text-muted";
  return <div><span className="text-muted">{label}:</span> <span className={classNames("font-semibold capitalize", tone)}>{value}</span></div>;
}

function FitMeter({ label, fit }: { label: string; fit: Fit }) {
  const segs = 3;
  const filled = fit === "high" ? 3 : fit === "medium" ? 2 : 1;
  const color = fit === "high" ? "#0ea672" : fit === "medium" ? "#3b82f6" : "#d08a2f";
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted">{label}</span>
        <span className="text-[10px] font-semibold capitalize" style={{ color }}>{fit}</span>
      </div>
      <div className="mt-1 flex gap-1">
        {Array.from({ length: segs }).map((_, i) => (
          <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < filled ? color : "#e6ecf3" }} />
        ))}
      </div>
    </div>
  );
}

function cleanErr(raw: string): string {
  if (/credit balance is too low/i.test(raw)) return "Anthropic API credits exhausted — add credits to run the factory research.";
  return raw.slice(0, 200);
}
