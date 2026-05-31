"use client";

import { useCallback, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney, readNDJSON } from "@/lib/api";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { RichText } from "@/components/RichText";
import { SavingsReport } from "@/components/SavingsReport";

interface PSCFindings {
  importer: string;
  analyzed_at: string;
  total_entries_analyzed: number;
  total_line_items_analyzed: number;
  classified_ok: number;
  classification_failed: number;
  agreements: number;
  disagreements: number;
  outside_psc_window: number;
  refund_opportunities: Array<{
    entry_number: string;
    entry_date: string;
    line_index: number;
    line_description: string;
    hts_filed: string;
    hts_predicted: string;
    hts_filed_8: string;
    hts_predicted_8: string;
    duty_paid_usd_cents: number;
    duty_predicted_usd_cents: number;
    recoverable_amount_usd_cents: number;
    our_confidence: "low" | "medium" | "high";
    reasoning_summary: string;
    reasoning_full?: string;
    psc_eligible: boolean;
  }>;
  uncertain_cases: Array<{
    entry_number: string;
    entry_date: string;
    line_index: number;
    line_description: string;
    hts_filed: string;
    hts_predicted: string;
    reason: string;
  }>;
  failures: Array<{ entry_number: string; line_index: number; line_description: string; error: string }>;
  total_recoverable_usd_cents: number;
  confidence_breakdown: { high_usd_cents: number; medium_usd_cents: number; low_usd_cents: number };
  notes: string[];
}

interface LiveCounters {
  total_lines: number;
  done: number;
  agreements: number;
  opportunities: number;
  uncertain: number;
  failures: number;
  recoverable_so_far_cents: number;
}

const ZERO_COUNTERS: LiveCounters = {
  total_lines: 0,
  done: 0,
  agreements: 0,
  opportunities: 0,
  uncertain: 0,
  failures: 0,
  recoverable_so_far_cents: 0,
};

interface HistoricalEntriesLike {
  importer?: string;
  period_start?: string;
  period_end?: string;
  entries: unknown[];
}

function mergeHistoricalEntries(parsed: HistoricalEntriesLike[]): {
  body: HistoricalEntriesLike;
  warnings: string[];
} {
  const warnings: string[] = [];
  const importers = Array.from(new Set(parsed.map((p) => p.importer).filter(Boolean) as string[]));
  if (importers.length > 1) {
    warnings.push(
      `Files name different importers (${importers.join(", ")}). Using "${importers[0]}" — verify the files belong to the same importer.`,
    );
  }
  const starts = parsed.map((p) => p.period_start).filter(Boolean) as string[];
  const ends = parsed.map((p) => p.period_end).filter(Boolean) as string[];
  const entries = parsed.flatMap((p) => p.entries);
  const startMin = starts.length > 0 ? starts.sort()[0]! : null;
  const endMax = ends.length > 0 ? ends.sort()[ends.length - 1]! : null;
  const body: HistoricalEntriesLike = {
    importer: importers[0] ?? "Unknown importer",
    entries,
    ...(startMin !== null ? { period_start: startMin } : {}),
    ...(endMax !== null ? { period_end: endMax } : {}),
  };
  return { body, warnings };
}

export default function FindRefundsPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [importer, setImporter] = useState<string | null>(null);
  const [counters, setCounters] = useState<LiveCounters>(ZERO_COUNTERS);
  const [findings, setFindings] = useState<PSCFindings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const additions = arr.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`));
      return [...prev, ...additions];
    });
    setFindings(null);
    setError(null);
    setStatusMessage("");
    setImporter(null);
    setCounters(ZERO_COUNTERS);
    setParseWarnings([]);
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setParseWarnings([]);
  }, []);

  const [loadingSample, setLoadingSample] = useState(false);
  const loadSample = useCallback(async () => {
    setLoadingSample(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/samples/entries`, { cache: "no-store" });
      if (!r.ok) {
        setError(`could not load sample: ${r.status}`);
        return;
      }
      const text = await r.text();
      const file = new File([text], "atlas-retail-entries.json", { type: "application/json" });
      addFiles([file]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSample(false);
    }
  }, [addFiles]);

  const start = useCallback(async () => {
    if (files.length === 0) return;
    setRunning(true);
    setError(null);
    setParseWarnings([]);
    const t0 = Date.now();
    try {
      // Split files by extension. JSON is parsed + merged client-side and
      // POSTed as JSON; PDFs are sent as multipart for the backend's entry-
      // summary parser to convert into HistoricalEntry records.
      const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
      const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      const otherFiles = files.filter(
        (f) => !f.name.toLowerCase().endsWith(".json") && !f.name.toLowerCase().endsWith(".pdf"),
      );
      if (otherFiles.length > 0) {
        setError(
          `Unsupported file type${otherFiles.length === 1 ? "" : "s"}: ${otherFiles
            .map((f) => f.name)
            .join(", ")}. Use JSON entry exports or CBP Form 7501 PDFs.`,
        );
        return;
      }
      if (jsonFiles.length > 0 && pdfFiles.length > 0) {
        setError(
          "Mixed inputs: upload JSON OR PDF entry summaries, not both in one analysis. Run them separately.",
        );
        return;
      }

      let res: Response;
      if (pdfFiles.length > 0) {
        // PDF path: multipart upload, backend parses each PDF into an entry.
        setStatusMessage(`Parsing ${pdfFiles.length} entry-summary PDF${pdfFiles.length === 1 ? "" : "s"}…`);
        const fd = new FormData();
        for (const f of pdfFiles) fd.append("file", f);
        res = await fetch(`${API_BASE_URL}/api/find-refunds`, { method: "POST", body: fd });
      } else {
        // JSON path: parse + merge client-side and POST a single body.
        const parsed: HistoricalEntriesLike[] = [];
        for (const f of jsonFiles) {
          try {
            const text = await f.text();
            const obj = JSON.parse(text) as HistoricalEntriesLike;
            if (!obj || !Array.isArray(obj.entries)) {
              setError(`${f.name}: missing "entries" array — not a valid HistoricalEntries export.`);
              return;
            }
            parsed.push(obj);
          } catch (e) {
            setError(`${f.name}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
            return;
          }
        }
        const { body, warnings } = mergeHistoricalEntries(parsed);
        setParseWarnings(warnings);
        res = await fetch(`${API_BASE_URL}/api/find-refunds`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        setError(`backend returned ${res.status}: ${await res.text()}`);
        return;
      }
      for await (const evt of readNDJSON<{ type: string; [k: string]: unknown }>(res)) {
        setElapsedMs(Date.now() - t0);
        if (evt.type === "status") {
          setStatusMessage(String(evt.message));
          if (typeof evt.importer === "string") setImporter(evt.importer);
          if (typeof evt.total_lines === "number") {
            setCounters((c) => ({ ...c, total_lines: evt.total_lines as number }));
          }
        } else if (evt.type === "entries_parsed_from_pdf") {
          const parsedEntries = (evt.entries as Array<{ entry_number: string; line_count: number }>) ?? [];
          const totalParsed = parsedEntries.reduce((a, e) => a + e.line_count, 0);
          setStatusMessage(
            `Parsed ${parsedEntries.length} entr${parsedEntries.length === 1 ? "y" : "ies"} from PDF (${totalParsed} line items). Beginning analysis…`,
          );
        } else if (evt.type === "line_analyzed") {
          const outcome = (evt.outcome as { kind: string; recoverable_usd_cents?: number }) ?? { kind: "agreement" };
          setCounters((c) => {
            const next = { ...c, done: c.done + 1 };
            if (outcome.kind === "agreement") next.agreements = c.agreements + 1;
            else if (outcome.kind === "opportunity") {
              next.opportunities = c.opportunities + 1;
              next.recoverable_so_far_cents = c.recoverable_so_far_cents + (outcome.recoverable_usd_cents ?? 0);
            } else if (outcome.kind === "uncertain") next.uncertain = c.uncertain + 1;
            else if (outcome.kind === "failure") next.failures = c.failures + 1;
            return next;
          });
          setStatusMessage(`Analyzing line ${(evt.line_global_index as number) + 1} of ${evt.total_lines}…`);
        } else if (evt.type === "done") {
          setFindings(evt.findings as PSCFindings);
          setStatusMessage("Done.");
        } else if (evt.type === "error") {
          setError(String(evt.message));
        }
      }
      setElapsedMs(Date.now() - t0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [files]);

  const downloadPdf = useCallback(async () => {
    if (!findings) return;
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/render-refund-pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(findings),
      });
      if (!res.ok) {
        setError(`PDF render failed: ${res.status} ${await res.text()}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customs-agent-refund-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [findings]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-navy">Find refund opportunities</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Upload an export of your historical entries (JSON, the format the PSC finder consumes). We re-classify every line and surface
          every Post Summary Correction with quantified savings, sorted by recoverable amount.
        </p>
      </header>

      {!findings && (
        <div className="space-y-4">
          <label
            className={classNames(
              "flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed bg-white p-12 text-center transition",
              "border-cardline hover:border-accent/40",
            )}
          >
            <input
              type="file"
              accept=".json,.pdf"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-navy-50 text-navy">
              {/* Spreadsheet / grid icon — visually distinct from the upload-cloud on /process-invoice */}
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                <path d="M3 9h18M3 14h18M9 4v16M15 4v16" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-navy">Upload your historical entries</div>
            <div className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              CBP Form 7501 entry-summary <strong className="text-navy">PDFs</strong>, or a JSON export from your
              broker's filing system / the CBP ACE Importer Portal. Either way we re-classify every line from
              scratch and surface duty overpayments. Multiple files are combined.
            </div>
            <div className="mt-3 text-[11px] text-muted">
              PDF: one CBP Form 7501 per file (continuation sheets included). JSON: your broker&apos;s standard
              entry export.
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void loadSample();
              }}
              disabled={loadingSample}
              className="mt-4 rounded-md border border-accent/40 bg-accent-50 px-3.5 py-1.5 text-xs font-semibold text-accent-700 transition hover:bg-accent-100 disabled:opacity-50"
            >
              {loadingSample ? "Loading…" : "Load a sample importer's 12 months of entries"}
            </button>
          </label>

          {/* File list + confirmation card */}
          {files.length > 0 && !running && (
            <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Ready to analyze · {files.length} file{files.length === 1 ? "" : "s"}
                </div>
                <label className="cursor-pointer text-xs font-medium text-accent-700 transition hover:text-accent">
                  + add more
                  <input
                    type="file"
                    accept=".json,.pdf"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <ul className="mb-4 divide-y divide-cardline/60">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <rect x="3" y="4" width="18" height="16" rx="1.5" />
                        <path d="M3 9h18M3 14h18M9 4v16M15 4v16" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-navy">{f.name}</div>
                      <div className="text-[11px] text-muted">{(f.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-xs text-muted transition hover:text-warn"
                      aria-label={`Remove ${f.name}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button
                  onClick={start}
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
                >
                  Run refund analysis
                  <span aria-hidden>→</span>
                </button>
              </div>
            </div>
          )}

          {parseWarnings.length > 0 && (
            <div className="rounded-md border border-amber/30 bg-amber-50 p-3 text-xs text-amber-700">
              {parseWarnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {(running || error || findings) && (
        <div className="rounded-card border border-cardline bg-white p-6 shadow-card">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                {findings ? "Analysis complete" : "In progress"}
              </div>
              <div className="mt-1 flex items-center gap-2 text-base text-navy">
                {running && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
                <span className="truncate">{error ? `Error: ${error}` : statusMessage || "Starting…"}</span>
              </div>
              {importer && (
                <div className="mt-1 text-xs text-muted">Importer: <span className="text-navy">{importer}</span></div>
              )}
            </div>
            {elapsedMs > 0 && (
              <div className="shrink-0 text-right text-xs text-muted">
                Elapsed {(elapsedMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>

          {counters.total_lines > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted">
                <span>Lines analyzed</span>
                <span>{counters.done} of {counters.total_lines}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.min(100, (counters.done / counters.total_lines) * 100)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <LiveStat label="Agreements" value={counters.agreements} />
                <LiveStat label="Opportunities" value={counters.opportunities} accent />
                <LiveStat label="Uncertain" value={counters.uncertain} />
                <LiveStat
                  label="Recoverable so far"
                  value={fmtMoney(counters.recoverable_so_far_cents)}
                  accent
                />
              </div>
            </div>
          )}
        </div>
      )}

      {findings && (
        <>
          {/* AT A GLANCE — mirrors the PDF cover, with total recoverable as the headline */}
          <div className="rounded-card border border-cardline bg-navy-50 p-6">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-navy">
              At a glance — {findings.importer}
            </div>
            <div className="mb-5 text-xs text-muted">
              Analysis date {new Date(findings.analyzed_at).toISOString().slice(0, 10)}
            </div>

            {/* Headline: total recoverable, full-width, dominant */}
            <div className="mb-6 rounded-md bg-white px-5 py-4 ring-1 ring-cardline">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Total recoverable
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-4">
                <span className="text-4xl font-bold tabular-nums text-accent">
                  {fmtMoney(findings.total_recoverable_usd_cents)}
                </span>
                <span className="text-xs text-muted">
                  across {findings.refund_opportunities.length}{" "}
                  refund {findings.refund_opportunities.length === 1 ? "opportunity" : "opportunities"}
                  {findings.confidence_breakdown.high_usd_cents > 0 && (
                    <>
                      {" · "}
                      <span className="text-navy">{fmtMoney(findings.confidence_breakdown.high_usd_cents)}</span>{" "}
                      high-confidence
                    </>
                  )}
                  {findings.confidence_breakdown.medium_usd_cents > 0 && (
                    <>
                      {" · "}
                      <span className="text-navy">{fmtMoney(findings.confidence_breakdown.medium_usd_cents)}</span>{" "}
                      medium
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Metric label="Entries analyzed" value={String(findings.total_entries_analyzed)} />
              <Metric label="Line items" value={String(findings.total_line_items_analyzed)} />
              <Metric
                label="Classified / failed"
                value={`${findings.classified_ok} / ${findings.classification_failed}`}
              />
              <Metric
                label="Outside PSC window"
                value={`${findings.outside_psc_window} entries`}
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowReport(true)}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
              >
                View savings report
              </button>
              <button
                onClick={downloadPdf}
                disabled={downloading}
                className="inline-flex items-center gap-2 rounded-md border border-cardline bg-white px-5 py-3 text-sm font-semibold text-navy shadow-sm hover:bg-navy-50 disabled:opacity-60"
              >
                {downloading ? "Rendering PDF…" : "Download full report (PDF)"}
              </button>
              <button
                onClick={() => {
                  setFiles([]);
                  setFindings(null);
                  setStatusMessage("");
                  setElapsedMs(0);
                }}
                className="text-sm text-muted hover:text-navy"
              >
                Start over with different files
              </button>
            </div>
          </div>

          {/* Opportunity cards */}
          <section>
            <h2 className="mb-4 text-xl font-bold text-navy">
              Refund opportunities ({findings.refund_opportunities.length})
            </h2>
            {findings.refund_opportunities.length === 0 ? (
              <div className="rounded-card border border-cardline bg-white p-6 text-sm text-muted">
                We agreed with the broker&apos;s filed classification on every line. No recoverable duties surfaced at sufficient
                confidence for filing.
              </div>
            ) : (
              <div className="space-y-4">
                {findings.refund_opportunities.map((opp, i) => (
                  <div key={i} className="rounded-card border border-cardline bg-white p-6 shadow-card">
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <span className="text-2xl font-bold text-navy">
                          {fmtMoney(opp.recoverable_amount_usd_cents)}
                        </span>
                        <span className="ml-2 text-sm text-muted">recoverable</span>
                      </div>
                      <ConfidenceBadge value={opp.our_confidence} />
                    </div>
                    <div className="mb-4 text-xs text-muted">
                      {opp.entry_number} · entry date {opp.entry_date} ·{" "}
                      {opp.psc_eligible ? "within PSC window" : (
                        <span className="text-warn">outside PSC window — protest required</span>
                      )}
                    </div>

                    <div className="mb-4">
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Product as filed</div>
                      <div className="mt-0.5 text-sm text-navy">{opp.line_description}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-md bg-navy-50 p-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted">Filed classification</div>
                        <div className="font-mono text-base font-semibold text-navy">{opp.hts_filed}</div>
                        <div className="text-xs text-muted">duty paid: {fmtMoney(opp.duty_paid_usd_cents)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted">Our proposed</div>
                        <div className="font-mono text-base font-semibold text-accent">{opp.hts_predicted}</div>
                        <div className="text-xs text-muted">duty under our code: {fmtMoney(opp.duty_predicted_usd_cents)}</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="text-sm font-semibold text-navy">Why we believe this is misclassified</div>
                      <RichText text={opp.reasoning_full ?? opp.reasoning_summary} className="mt-2 text-sm text-muted" />
                    </div>

                    <div className="mt-4 border-t border-cardline pt-3 text-[11px] italic text-muted">
                      This finding requires review by a licensed customs broker before filing a Post Summary Correction.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(findings.uncertain_cases.length > 0 || findings.failures.length > 0) && (
            <section>
              <h2 className="mb-3 text-xl font-bold text-navy">For broker review</h2>
              <div className="space-y-2">
                {findings.uncertain_cases.map((u, i) => (
                  <div key={"u" + i} className="rounded-md border border-amber/30 bg-amber-50 p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-navy">
                        {u.entry_number} · line {u.line_index + 1}
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-700">
                        Uncertain (low confidence)
                      </span>
                    </div>
                    <div className="mt-1 text-muted">{u.line_description}</div>
                    <div className="mt-1 text-xs text-muted">
                      filed <span className="font-mono">{u.hts_filed}</span> · agent predicted{" "}
                      <span className="font-mono">{u.hts_predicted}</span>
                    </div>
                  </div>
                ))}
                {findings.failures.map((f, i) => (
                  <div key={"f" + i} className="rounded-md border border-warn/40 bg-white p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-navy">
                        {f.entry_number} · line {f.line_index + 1}
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-warn">
                        Classification failed
                      </span>
                    </div>
                    <div className="mt-1 text-muted">{f.line_description}</div>
                    <div className="mt-1 text-xs italic text-muted">{f.error.slice(0, 200)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {showReport && findings && <SavingsReport findings={findings} onClose={() => setShowReport(false)} />}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-0.5 truncate font-semibold", accent ? "text-xl text-accent" : "text-navy")}>{value}</div>
    </div>
  );
}

function LiveStat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-cardline bg-navy-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div
        className={classNames(
          "mt-0.5 font-semibold tabular-nums",
          accent ? "text-accent" : "text-navy",
        )}
      >
        {value}
      </div>
    </div>
  );
}
