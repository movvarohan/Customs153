"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney, readNDJSON } from "@/lib/api";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";

interface LineClassification {
  hts_code: string;
  hts_code_8: string;
  reasoning: string;
  citations: string[];
  alternative_codes_considered: { hts_code: string; rejected_because: string }[];
  missing_inputs_for_precision: string[];
  confidence: "low" | "medium" | "high";
  gri_rule_applied: string;
  validation_warning: string | null;
}

interface DutyComponent {
  kind:
    | "base_ad_valorem"
    | "section_301"
    | "section_232"
    | "merchandise_processing_fee"
    | "harbor_maintenance_fee";
  rate: number | null;
  amount_usd_cents: number;
  source_citation: string;
}

interface DutyCalculation {
  hts_code: string;
  country_of_origin: string;
  customs_value_usd_cents: number;
  base_duty_rate: number;
  base_duty_usd_cents: number;
  section_301_rate: number | null;
  section_301_duty_usd_cents: number;
  section_232_rate: number | null;
  section_232_duty_usd_cents: number;
  merchandise_processing_fee_usd_cents: number;
  harbor_maintenance_fee_usd_cents: number;
  total_duty_usd_cents: number;
  tariff_rate_source: string;
  components: DutyComponent[];
  warnings: string[];
}

interface ExtractedShipment {
  document_kind: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  consignee: string | null;
  country_of_origin: string | null;
  currency: string;
  total_value: number;
  total_value_usd_cents: number | null;
  fx_rate_used: number | null;
  line_items: Array<{
    description: string;
    quantity: number;
    unit_value: number;
    total_value: number;
    country_of_origin: string | null;
    hts_code_from_invoice: string | null;
    material_composition: string | null;
    model_number: string | null;
  }>;
  requires_clarification: { line_index: number; reason: string }[];
  reconciliation_warning: string | null;
}

type LineState =
  | { status: "pending"; reasoning_so_far?: string }
  | { status: "classified"; classification: LineClassification; duty: DutyCalculation | null; dutyError: string | null; reasoning_so_far?: string }
  | { status: "failed"; error: string; reasoning_so_far?: string };

export default function ProcessInvoicePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [extraction, setExtraction] = useState<ExtractedShipment | null>(null);
  const [sourceFilenames, setSourceFilenames] = useState<string[]>([]);
  const [lineStates, setLineStates] = useState<LineState[]>([]);
  const [summary, setSummary] = useState<{
    total_documents: number;
    total_lines: number;
    classified_ok: number;
    failed: number;
    total_duty_usd_cents: number;
    currency: string;
    customs_value_usd_cents: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const additions = arr.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`));
      return [...prev, ...additions];
    });
    setExtraction(null);
    setLineStates([]);
    setSummary(null);
    setError(null);
    setStatusMessage("");
    setExpanded(new Set());
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const [loadingSample, setLoadingSample] = useState(false);
  const loadSample = useCallback(async () => {
    setLoadingSample(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/samples/invoice`, { cache: "no-store" });
      if (!r.ok) {
        setError(`could not load sample: ${r.status}`);
        return;
      }
      const blob = await r.blob();
      const file = new File([blob], "shenzhen-aurora-electronics.pdf", { type: "application/pdf" });
      addFiles([file]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSample(false);
    }
  }, [addFiles]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragActive(false);
      const fl = e.dataTransfer.files;
      if (fl) addFiles(fl);
    },
    [addFiles],
  );

  const toggleExpanded = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (files.length === 0) return;
    setRunning(true);
    setError(null);
    setExtraction(null);
    setLineStates([]);
    setSummary(null);
    const t0 = Date.now();
    try {
      const fd = new FormData();
      for (const f of files) fd.append("file", f);
      const res = await fetch(`${API_BASE_URL}/api/process-invoice`, { method: "POST", body: fd });
      if (!res.ok) {
        setError(`backend returned ${res.status}: ${await res.text()}`);
        return;
      }
      for await (const evt of readNDJSON<{ type: string; [k: string]: unknown }>(res)) {
        setElapsedMs(Date.now() - t0);
        if (evt.type === "status") {
          setStatusMessage(String(evt.message));
        } else if (evt.type === "extracted") {
          const ex = evt.extraction as ExtractedShipment;
          setExtraction(ex);
          setSourceFilenames((evt.source_filenames as string[]) ?? []);
          setLineStates(ex.line_items.map(() => ({ status: "pending" }) as LineState));
        } else if (evt.type === "reasoning_delta") {
          // Live token stream from the classifier as it reasons through GRI.
          const idx = evt.line_index as number;
          const delta = String(evt.delta ?? "");
          setLineStates((prev) => {
            const next = [...prev];
            const cur = next[idx];
            if (cur) next[idx] = { ...cur, reasoning_so_far: (cur.reasoning_so_far ?? "") + delta };
            return next;
          });
        } else if (evt.type === "line_classified") {
          const idx = evt.line_index as number;
          const cl = evt.classification as LineClassification;
          setStatusMessage(`Classified line ${idx + 1}…`);
          setLineStates((prev) => {
            const next = [...prev];
            const reasoning_so_far = next[idx]?.reasoning_so_far;
            next[idx] = {
              status: "classified",
              classification: cl,
              duty: null,
              dutyError: null,
              ...(reasoning_so_far ? { reasoning_so_far } : {}),
            };
            return next;
          });
        } else if (evt.type === "line_duty_calculated") {
          const idx = evt.line_index as number;
          const duty = evt.duty as DutyCalculation;
          setLineStates((prev) => {
            const next = [...prev];
            const cur = next[idx];
            if (cur && cur.status === "classified") {
              next[idx] = { ...cur, duty };
            }
            return next;
          });
        } else if (evt.type === "line_failed") {
          const idx = evt.line_index as number;
          setLineStates((prev) => {
            const next = [...prev];
            next[idx] = { status: "failed", error: String(evt.error) };
            return next;
          });
        } else if (evt.type === "done") {
          setSummary(
            evt.summary as {
              total_documents: number;
              total_lines: number;
              classified_ok: number;
              failed: number;
              total_duty_usd_cents: number;
              currency: string;
              customs_value_usd_cents: number | null;
            },
          );
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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-navy">Process a shipment</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Drag in every document for one shipment — commercial invoice, packing list, bill of lading, mill test certificate. We merge them
          into a single record, classify each line under the US Harmonized Tariff Schedule, and compute exactly what you owe in duty with a
          full per-component breakdown.
        </p>
      </header>

      {!extraction && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={classNames(
            "flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed bg-white p-10 text-center transition",
            dragActive ? "border-accent bg-accent-50" : "border-cardline hover:border-accent/40",
          )}
        >
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-navy-50 text-navy">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-navy">Drag PDFs here, or click to choose files</div>
          <div className="mt-1 max-w-md text-xs text-muted">
            Multiple documents for the same shipment are merged into one record. Invoice + packing list + BL together give the
            classifier the most context.
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
            {loadingSample ? "Loading…" : "Load a sample shipment"}
          </button>
        </label>
      )}

      {/* File list + action */}
      {files.length > 0 && !extraction && !running && (
        <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Ready · {files.length} file{files.length === 1 ? "" : "s"} · all merged into one shipment
            </div>
            <label className="cursor-pointer text-xs font-medium text-accent-700 transition hover:text-accent">
              + add more
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
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
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M14 3v5h5M5 21h14a2 2 0 002-2V8l-5-5H5a2 2 0 00-2 2v14a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
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
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              Process this shipment
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}

      {(running || extraction || error) && (
        <div className="rounded-card border border-cardline bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Status</div>
              <div className="mt-1 flex items-center gap-2 text-base text-navy">
                {running && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />}
                <span>{error ? `Error: ${error}` : statusMessage || "Starting…"}</span>
              </div>
            </div>
            <div className="text-right text-xs text-muted">
              {elapsedMs > 0 && <>Elapsed {(elapsedMs / 1000).toFixed(1)}s</>}
              {summary && (
                <div className="mt-1">
                  {summary.total_documents} doc{summary.total_documents === 1 ? "" : "s"} · {summary.total_lines} lines ·{" "}
                  {summary.classified_ok} classified · {summary.failed} failed
                </div>
              )}
            </div>
          </div>

          {extraction && (
            <>
              {/* Total duty headline */}
              {summary && summary.total_duty_usd_cents > 0 && (
                <div className="mb-6 rounded-md bg-navy-50 p-5 ring-1 ring-cardline">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Total duty owed</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <span className="text-4xl font-bold tabular-nums text-accent">
                      {fmtMoney(summary.total_duty_usd_cents)}
                    </span>
                    {summary.customs_value_usd_cents !== null && (
                      <span className="text-xs text-muted">
                        on a customs value of{" "}
                        <span className="text-navy">{fmtMoney(summary.customs_value_usd_cents)}</span>
                        {extraction.fx_rate_used !== null && extraction.currency !== "USD" && (
                          <> (FX {extraction.fx_rate_used.toFixed(4)} {extraction.currency}/USD)</>
                        )}
                        {" · "}
                        effective rate{" "}
                        <span className="text-navy">
                          {(
                            (summary.total_duty_usd_cents / summary.customs_value_usd_cents) *
                            100
                          ).toFixed(2)}
                          %
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">
                    Click any line below for the full per-component duty breakdown with rate citations.
                  </div>
                </div>
              )}

              {/* Shipment metadata */}
              <div className="mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <Metric label="Vendor" value={extraction.vendor} />
                <Metric label="Invoice" value={extraction.invoice_number} />
                <Metric label="Date" value={extraction.invoice_date} />
                <Metric
                  label="Total value"
                  value={`${fmtMoney(extraction.total_value, extraction.currency)}${extraction.total_value_usd_cents !== null && extraction.currency !== "USD" ? ` (${fmtMoney(extraction.total_value_usd_cents)} USD)` : ""}`}
                />
              </div>

              {sourceFilenames.length > 0 && (
                <div className="mb-4 text-[11px] text-muted">
                  Merged from: {sourceFilenames.join(", ")}
                </div>
              )}

              <div className="overflow-x-auto rounded-md border border-cardline">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="py-2.5 pl-4 pr-3">#</th>
                      <th className="py-2.5 pr-3">Description</th>
                      <th className="py-2.5 pr-3 text-right">Qty</th>
                      <th className="py-2.5 pr-3 text-right">Value ({extraction.currency})</th>
                      <th className="py-2.5 pr-3">HTS (8d)</th>
                      <th className="py-2.5 pr-3 text-right">Duty (USD)</th>
                      <th className="py-2.5 pr-4">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraction.line_items.map((li, i) => {
                      const st = lineStates[i] ?? { status: "pending" };
                      const isClassified = st.status === "classified";
                      const isFailed = st.status === "failed";
                      const missing = isClassified ? st.classification.missing_inputs_for_precision : [];
                      const isExpanded = expanded.has(i);
                      const canExpand = isClassified;
                      return (
                        <>
                          <tr
                            key={`row-${i}`}
                            className={classNames(
                              "align-top border-b border-cardline/60 transition-colors last:border-b-0",
                              i % 2 === 1 && "bg-navy-50/30",
                              canExpand && "cursor-pointer hover:bg-accent-50/40",
                            )}
                            onClick={canExpand ? () => toggleExpanded(i) : undefined}
                          >
                            <td className="py-3.5 pl-4 pr-3 tabular-nums text-muted">
                              {canExpand && (
                                <span aria-hidden className="mr-1 inline-block w-3 text-muted">
                                  {isExpanded ? "▾" : "▸"}
                                </span>
                              )}
                              {i + 1}
                            </td>
                            <td className="py-3.5 pr-3">
                              <div className="text-navy">{li.description}</div>
                              {li.material_composition && (
                                <div className="mt-0.5 text-[11px] text-muted">{li.material_composition}</div>
                              )}
                              {st.status === "pending" && st.reasoning_so_far && (
                                <ReasoningStream text={st.reasoning_so_far} live />
                              )}
                              {missing.length > 0 && (
                                <div className="mt-2 rounded-md border border-amber/30 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                                  <div className="font-semibold">
                                    Broker should confirm: {missing.length} missing input{missing.length === 1 ? "" : "s"}
                                  </div>
                                  <ul className="ml-3 mt-0.5 list-disc space-y-0.5">
                                    {missing.map((m, k) => (
                                      <li key={k}>{m}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {isFailed && (
                                <div className="mt-2 rounded-md border border-warn/40 bg-white px-2 py-1.5 text-[11px] text-warn">
                                  <div className="font-semibold">Classification failed after 3 retries</div>
                                  <div className="mt-0.5 italic text-muted">{st.error.slice(0, 160)}</div>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 pr-3 text-right tabular-nums text-navy">{li.quantity}</td>
                            <td className="py-3.5 pr-3 text-right tabular-nums text-navy">
                              {(li.total_value / 100).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-3.5 pr-3 font-mono text-navy">
                              {isClassified ? (
                                st.classification.hts_code_8
                              ) : isFailed ? (
                                <span className="text-warn">—</span>
                              ) : (
                                <span className="inline-block h-3 w-16 animate-pulse rounded bg-navy-100" />
                              )}
                            </td>
                            <td className="py-3.5 pr-3 text-right font-mono tabular-nums text-navy">
                              {isClassified && st.duty ? (
                                <span className="font-semibold">{fmtMoney(st.duty.total_duty_usd_cents)}</span>
                              ) : isClassified ? (
                                <span className="text-[11px] text-muted">computing…</span>
                              ) : isFailed ? (
                                <span className="text-warn">—</span>
                              ) : (
                                <span className="inline-block h-3 w-16 animate-pulse rounded bg-navy-100" />
                              )}
                            </td>
                            <td className="py-3.5 pr-4">
                              {isClassified ? (
                                <ConfidenceBadge value={st.classification.confidence} />
                              ) : isFailed ? (
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-warn">failed</span>
                              ) : (
                                <span className="text-[11px] text-muted">…</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && isClassified && (
                            <tr key={`detail-${i}`} className="border-b border-cardline bg-navy-50/40">
                              <td colSpan={7} className="px-4 py-5">
                                <LineDetail
                                  description={li.description}
                                  classification={st.classification}
                                  duty={st.duty}
                                  dutyError={st.dutyError}
                                  customsValueLabel={
                                    extraction.currency === "USD"
                                      ? `${fmtMoney(li.total_value)} (USD, from invoice)`
                                      : extraction.fx_rate_used !== null
                                        ? `${fmtMoney(Math.round(li.total_value * extraction.fx_rate_used))} (USD, converted from ${fmtMoney(li.total_value, extraction.currency)} at FX ${extraction.fx_rate_used.toFixed(4)})`
                                        : `${fmtMoney(li.total_value, extraction.currency)} — no FX rate available`
                                  }
                                  countryIso2={st.duty?.country_of_origin ?? null}
                                  lineUsdCents={
                                    extraction.currency === "USD"
                                      ? li.total_value
                                      : extraction.fx_rate_used !== null
                                        ? Math.round(li.total_value * extraction.fx_rate_used)
                                        : null
                                  }
                                />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {extraction.requires_clarification.length > 0 && (
                <div className="mt-4 rounded-md border border-amber/30 bg-amber-50 p-3 text-xs text-amber-700">
                  <strong>Vague descriptions flagged:</strong>{" "}
                  {extraction.requires_clarification.map((r) => `line ${r.line_index + 1}`).join(", ")} — broker should ask the importer
                  for product details before classifying.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LineDetail({
  description,
  classification,
  duty,
  dutyError,
  customsValueLabel,
  countryIso2,
  lineUsdCents,
}: {
  description: string;
  classification: LineClassification;
  duty: DutyCalculation | null;
  dutyError: string | null;
  customsValueLabel: string;
  countryIso2: string | null;
  lineUsdCents: number | null;
}) {
  return (
    <div className="space-y-5">
      {/* Classification reasoning */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Classification</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-base font-semibold text-navy">{classification.hts_code}</span>
          <span className="text-xs text-muted">
            GRI {classification.gri_rule_applied} applied · {classification.confidence} confidence
          </span>
        </div>
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">{classification.reasoning}</p>
        {classification.citations.length > 0 && (
          <div className="mt-2 text-[11px] text-muted">
            Citations:{" "}
            {classification.citations.map((c, i) => (
              <span key={i} className="mr-2 inline-block rounded bg-white px-2 py-0.5 font-mono">
                {c}
              </span>
            ))}
          </div>
        )}
        {classification.alternative_codes_considered.length > 0 && (
          <details className="mt-2 text-[11px] text-muted">
            <summary className="cursor-pointer">Alternatives ruled out</summary>
            <ul className="mt-1 ml-4 list-disc space-y-1">
              {classification.alternative_codes_considered.map((a, i) => (
                <li key={i}>
                  <span className="font-mono">{a.hts_code}</span> — {a.rejected_because}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Duty calculation */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Duty calculation</div>
        {dutyError ? (
          <div className="mt-2 rounded-md border border-warn/40 bg-white px-3 py-2 text-xs text-warn">
            {dutyError}
          </div>
        ) : !duty ? (
          <div className="mt-2 text-xs text-muted">computing…</div>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
              <DetailRow label="HTS" value={duty.hts_code} mono />
              <DetailRow label="Country of origin" value={duty.country_of_origin} />
              <DetailRow label="Customs value" value={customsValueLabel} />
            </div>

            <div className="overflow-x-auto rounded-md border border-cardline bg-white">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-cardline bg-navy-50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <th className="py-2 pl-3 pr-3">Component</th>
                    <th className="py-2 pr-3 text-right">Rate</th>
                    <th className="py-2 pr-3 text-right">Amount (USD)</th>
                    <th className="py-2 pr-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {duty.components.map((cmp, i) => (
                    <tr key={i} className="border-b border-cardline/60 last:border-b-0">
                      <td className="py-2 pl-3 pr-3 text-navy">{componentLabel(cmp.kind)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-navy">
                        {cmp.rate === null ? "—" : `${(cmp.rate * 100).toFixed(cmp.kind === "merchandise_processing_fee" || cmp.kind === "harbor_maintenance_fee" ? 4 : 2)}%`}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-navy">
                        {fmtMoney(cmp.amount_usd_cents)}
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-muted">{cmp.source_citation}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-cardline bg-navy-50/60">
                    <td colSpan={2} className="py-2 pl-3 pr-3 text-right font-semibold uppercase tracking-wider text-muted">
                      Total duty owed
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-base font-bold tabular-nums text-accent">
                      {fmtMoney(duty.total_duty_usd_cents)}
                    </td>
                    <td className="py-2 pr-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="text-[11px] italic text-muted">
              Calculation: customs value × component rate, deterministic. No LLM in the duty math itself. MPF clamped to its statutory
              min/max. HMF applied only for ocean transport.
            </div>

            {duty.warnings.length > 0 && (
              <div className="rounded-md border border-amber/30 bg-amber-50 p-2 text-[11px] text-amber-700">
                {duty.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {duty && countryIso2 && lineUsdCents !== null && (
        <CounterfactualPanel
          description={description}
          htsCode8={classification.hts_code_8}
          countryIso2={countryIso2}
          customsValueUsdCents={lineUsdCents}
          filedTotalDutyUsdCents={duty.total_duty_usd_cents}
        />
      )}

      <AuditDefensePanel
        description={description}
        classification={classification}
        countryIso2={countryIso2}
      />

      <CrossVerifyPanel description={description} classification={classification} />

      <DebatePanel description={description} classification={classification} />

      <div className="text-[10px] italic text-muted">
        Source line: <span className="text-navy">{description}</span>
      </div>
    </div>
  );
}

interface CounterfactualScenario {
  label: string;
  kind: "country_of_origin" | "material" | "structural" | "fta_preference" | "other";
  what_changes: string;
  alternative_hts_8: string | null;
  alternative_country_iso2: string | null;
  reasoning: string;
  operational_notes: string;
  scenario_total_duty_usd_cents: number;
  savings_usd_cents: number;
  savings_pct: number;
  warnings: string[];
}

function CounterfactualPanel({
  description,
  htsCode8,
  countryIso2,
  customsValueUsdCents,
  filedTotalDutyUsdCents,
}: {
  description: string;
  htsCode8: string;
  countryIso2: string;
  customsValueUsdCents: number;
  filedTotalDutyUsdCents: number;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<CounterfactualScenario[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/counterfactual`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          filed_hts_code_8: htsCode8,
          filed_country_iso2: countryIso2,
          customs_value_usd_cents: customsValueUsdCents,
          filed_total_duty_usd_cents: filedTotalDutyUsdCents,
        }),
      });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      const j = (await r.json()) as { scenarios: CounterfactualScenario[] };
      setScenarios(j.scenarios);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [description, htsCode8, countryIso2, customsValueUsdCents, filedTotalDutyUsdCents]);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
        Tariff engineering — what if?
      </div>
      {!scenarios && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Generating…" : "Show 3–5 alternative scenarios"}
          </button>
          <span className="text-[11px] text-muted">
            Country / material / structural changes the importer could make to reduce duty legally.
          </span>
        </div>
      )}
      {err && (
        <div className="mt-2 rounded-md border border-warn/40 bg-white px-3 py-2 text-xs text-warn">
          {err}
        </div>
      )}
      {open && scenarios && scenarios.length > 0 && (
        <div className="mt-2 space-y-2">
          {scenarios.map((s, i) => {
            const savings = s.savings_usd_cents;
            const positive = savings > 0;
            return (
              <div
                key={i}
                className={classNames(
                  "rounded-md border bg-white p-3 text-xs",
                  positive ? "border-accent/40" : "border-cardline",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span
                      className={classNames(
                        "mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        s.kind === "country_of_origin" && "bg-amber-100 text-amber-800",
                        s.kind === "material" && "bg-navy-100 text-navy",
                        s.kind === "structural" && "bg-accent-50 text-accent-700",
                        s.kind === "fta_preference" && "bg-accent text-white",
                        s.kind === "other" && "bg-cardline text-muted",
                      )}
                    >
                      {s.kind.replace("_", " ")}
                    </span>
                    <span className="font-semibold text-navy">{s.label}</span>
                  </div>
                  <div className="text-right">
                    <div
                      className={classNames(
                        "text-base font-bold tabular-nums",
                        positive ? "text-accent-700" : "text-muted",
                      )}
                    >
                      {positive ? "− " : ""}
                      {fmtMoney(Math.abs(savings))}
                    </div>
                    <div className="text-[10px] text-muted">
                      {positive ? "savings" : "no savings"} ({s.savings_pct.toFixed(0)}%)
                    </div>
                  </div>
                </div>
                <p className="mt-1.5 text-navy">{s.what_changes}</p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-3 text-[11px] text-muted">
                  <span>
                    HTS:{" "}
                    <span className="font-mono text-navy">
                      {s.alternative_hts_8 ?? htsCode8}
                      {!s.alternative_hts_8 && " (unchanged)"}
                    </span>
                  </span>
                  <span>
                    Country:{" "}
                    <span className="font-mono text-navy">
                      {s.alternative_country_iso2 ?? countryIso2}
                      {!s.alternative_country_iso2 && " (unchanged)"}
                    </span>
                  </span>
                  <span>
                    New duty:{" "}
                    <span className="font-mono text-navy">
                      {fmtMoney(s.scenario_total_duty_usd_cents)}
                    </span>
                  </span>
                </div>
                <p className="mt-1.5 italic text-muted">{s.reasoning}</p>
                <p className="mt-1 text-[11px] text-muted">
                  <span className="font-semibold text-navy">Operational:</span>{" "}
                  {s.operational_notes}
                </p>
                {s.warnings.length > 0 && (
                  <div className="mt-1.5 rounded border border-amber/30 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                    {s.warnings.join("; ")}
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

interface AuditQuestion {
  id: string;
  question: string;
  answer: string;
  citations: string[];
  strength: "strong" | "adequate" | "thin";
}

function AuditDefensePanel({
  description,
  classification,
  countryIso2,
}: {
  description: string;
  classification: LineClassification;
  countryIso2: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{
    overall_readiness: string;
    primary_risk: string;
    questions: AuditQuestion[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/audit-defense`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          hts_code: classification.hts_code,
          hts_code_8: classification.hts_code_8,
          gri_rule_applied: classification.gri_rule_applied,
          reasoning: classification.reasoning,
          citations: classification.citations,
          alternative_codes_considered: classification.alternative_codes_considered,
          missing_inputs_for_precision: classification.missing_inputs_for_precision,
          confidence: classification.confidence,
          ...(countryIso2 ? { country_of_origin: countryIso2 } : {}),
        }),
      });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      const j = (await r.json()) as { defense: typeof data };
      setData(j.defense);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [description, classification, countryIso2]);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
        CBP focused-assessment defense
      </div>
      {!data && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md border border-navy/30 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy shadow-sm transition hover:border-navy/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Simulating exchange…" : "Generate audit-readiness packet"}
          </button>
          <span className="text-[11px] text-muted">
            Simulate the CBP auditor's questions and the broker's grounded answers.
          </span>
        </div>
      )}
      {err && (
        <div className="mt-2 rounded-md border border-warn/40 bg-white px-3 py-2 text-xs text-warn">{err}</div>
      )}
      {data && (
        <div className="mt-2 space-y-3 rounded-md border border-cardline bg-white p-3">
          <div className="rounded-md bg-navy-50 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Overall readiness
            </div>
            <p className="mt-0.5 text-xs text-navy">{data.overall_readiness}</p>
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Primary risk
            </div>
            <p className="mt-0.5 text-xs text-warn">{data.primary_risk}</p>
          </div>
          {data.questions.map((q) => (
            <div key={q.id} className="rounded-md border border-cardline/60 bg-navy-50/40 p-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-semibold text-navy">
                  {q.id}. {q.question}
                </div>
                <span
                  className={classNames(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    q.strength === "strong" && "bg-accent text-white",
                    q.strength === "adequate" && "bg-navy-100 text-navy",
                    q.strength === "thin" && "bg-amber-100 text-amber-800",
                  )}
                >
                  {q.strength}
                </span>
              </div>
              <p className="mt-1 text-navy">{q.answer}</p>
              {q.citations.length > 0 && (
                <div className="mt-1 text-[11px] text-muted">
                  Cites:{" "}
                  {q.citations.map((c, i) => (
                    <span key={i} className="mr-1.5 inline-block rounded bg-white px-1.5 py-0.5 font-mono">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DebateData {
  advocate: { defended_hts_code: string; argument: string; strongest_pillar: string };
  challenger: { alternative_hts_code: string; attack: string; why_alternative_wins: string };
  judge: { winner: "advocate" | "challenger" | "split"; final_hts_code: string; final_confidence: "low" | "medium" | "high"; rationale: string; citations: string[] };
  revised: boolean;
}

function DebatePanel({
  description,
  classification,
}: {
  description: string;
  classification: LineClassification;
}) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<DebateData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/debate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          predicted_hts_code: classification.hts_code,
          predicted_hts_code_8: classification.hts_code_8,
          classifier_reasoning: classification.reasoning,
          classifier_citations: classification.citations,
          alternative_codes_considered: classification.alternative_codes_considered,
        }),
      });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      setData((await r.json()) as DebateData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [description, classification]);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
        Adversarial debate
      </div>
      {!data && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md border border-navy/30 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy shadow-sm transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Running debate…" : "Run advocate vs. challenger"}
          </button>
          <span className="text-[11px] text-muted">
            Two agents argue, a third judges. Transcript preserved.
          </span>
        </div>
      )}
      {err && (
        <div className="mt-2 rounded-md border border-warn/40 bg-white px-3 py-2 text-xs text-warn">{err}</div>
      )}
      {data && (
        <div className="mt-2 space-y-2 text-xs">
          <div className="rounded-md border border-accent/30 bg-accent-50/40 p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-accent-700">
                Advocate
              </div>
              <span className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-accent-700">
                {data.advocate.defended_hts_code}
              </span>
            </div>
            <p className="text-navy">{data.advocate.argument}</p>
            <p className="mt-1 text-[11px] italic text-muted">
              Strongest pillar: {data.advocate.strongest_pillar}
            </p>
          </div>
          <div className="rounded-md border border-amber/40 bg-amber-50/50 p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
                Challenger
              </div>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-800">
                {data.challenger.alternative_hts_code}
              </span>
            </div>
            <p className="text-navy">{data.challenger.attack}</p>
            <p className="mt-1 text-[11px] italic text-muted">
              Why alternative wins: {data.challenger.why_alternative_wins}
            </p>
          </div>
          <div className="rounded-md border border-cardline bg-navy-50 p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Judge ruling
              </div>
              <span
                className={classNames(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  data.judge.winner === "advocate" && "bg-accent text-white",
                  data.judge.winner === "challenger" && "bg-amber-200 text-amber-900",
                  data.judge.winner === "split" && "bg-cardline text-muted",
                )}
              >
                {data.judge.winner} wins
              </span>
            </div>
            <div className="mb-1 flex items-baseline gap-3">
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-navy">
                {data.judge.final_hts_code}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted">
                confidence: {data.judge.final_confidence}
              </span>
              {data.revised && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-warn">
                  classifier revised
                </span>
              )}
            </div>
            <p className="text-navy">{data.judge.rationale}</p>
            {data.judge.citations.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted">
                Cites:{" "}
                {data.judge.citations.map((c, i) => (
                  <span key={i} className="mr-1.5 inline-block rounded bg-white px-1.5 py-0.5 font-mono">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CrossVerifyData {
  defense: {
    agrees_with_predicted: boolean;
    suggested_hts_code: string | null;
    confidence: "low" | "medium" | "high";
    reasoning: string;
    evidence: Array<{ ruling_number: string; product: string; assigned_code: string; relevance: string }>;
  };
}

function CrossVerifyPanel({
  description,
  classification,
}: {
  description: string;
  classification: LineClassification;
}) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CrossVerifyData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/cross-verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          predicted_hts_code: classification.hts_code,
          predicted_hts_code_8: classification.hts_code_8,
        }),
      });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      setData((await r.json()) as CrossVerifyData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [description, classification]);

  const d = data?.defense;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
        CROSS rulings cross-check
      </div>
      {!data && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md border border-accent/40 bg-white px-3.5 py-1.5 text-xs font-semibold text-accent-700 shadow-sm transition hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Querying CBP CROSS…" : "Check against CBP binding rulings"}
          </button>
          <span className="text-[11px] text-muted">
            Fetches actual rulings from <code className="rounded bg-navy-50 px-1">rulings.cbp.gov</code> and asks Claude whether the
            prediction aligns with CBP practice.
          </span>
        </div>
      )}
      {err && (
        <div className="mt-2 rounded-md border border-warn/40 bg-white px-3 py-2 text-xs text-warn">{err}</div>
      )}
      {d && (
        <div className="mt-2 space-y-2 rounded-md border border-cardline bg-white p-3 text-xs">
          <div className="flex flex-wrap items-baseline gap-3">
            <span
              className={classNames(
                "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                d.agrees_with_predicted ? "bg-accent text-white" : "bg-warn/20 text-warn",
              )}
            >
              {d.agrees_with_predicted ? "Aligns with CBP practice" : "CBP practice disagrees"}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              confidence: {d.confidence}
            </span>
            {!d.agrees_with_predicted && d.suggested_hts_code && (
              <span className="text-[11px]">
                CROSS supports:{" "}
                <span className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-accent-700">
                  {d.suggested_hts_code}
                </span>
              </span>
            )}
          </div>
          <p className="text-navy">{d.reasoning}</p>
          {d.evidence.length > 0 && (
            <div className="mt-1 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Rulings relied on
              </div>
              {d.evidence.map((e, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[11px] text-muted">
                  <span className="font-mono text-navy">{e.ruling_number}</span>
                  <span className="font-mono text-accent-700">{e.assigned_code}</span>
                  <span className="truncate">{e.product}</span>
                  <span className="italic">— {e.relevance}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Live token-stream from the classifier. Auto-scrolls. Highlights HTS codes. */
function ReasoningStream({ text, live }: { text: string; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <div className="mt-2 rounded-md border border-accent/30 bg-accent-50/40 px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent-700">
        {live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
        Agent reasoning {live ? "(live)" : ""}
      </div>
      <div
        ref={ref}
        className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-navy"
      >
        {highlightHts(text)}
        {live && <span className="inline-block w-1.5 h-3 ml-px bg-accent/80 align-middle animate-pulse" aria-hidden />}
      </div>
    </div>
  );
}

/** Wrap HTS-code-shaped tokens (XXXX, XXXX.XX, XXXX.XX.XX, XXXX.XX.XX.XX) in a highlight. */
function highlightHts(text: string): React.ReactNode {
  const re = /\b(\d{4}(?:\.\d{2}){0,3})\b/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span
        key={`hts-${i++}`}
        className="rounded bg-accent/20 px-1 py-0.5 font-semibold text-accent-700"
      >
        {m[1]}
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function componentLabel(kind: DutyComponent["kind"]): string {
  switch (kind) {
    case "base_ad_valorem":
      return "Base ad valorem (HTS column 1)";
    case "section_301":
      return "Section 301 (China)";
    case "section_232":
      return "Section 232 (steel/aluminum)";
    case "merchandise_processing_fee":
      return "Merchandise Processing Fee (MPF)";
    case "harbor_maintenance_fee":
      return "Harbor Maintenance Fee (HMF)";
  }
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-0.5 text-navy", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 truncate font-semibold text-navy">{value}</div>
    </div>
  );
}
