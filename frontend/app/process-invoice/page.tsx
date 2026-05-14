"use client";

import { useCallback, useState } from "react";
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
  | { status: "pending" }
  | { status: "classified"; classification: LineClassification }
  | { status: "failed"; error: string };

export default function ProcessInvoicePage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [extraction, setExtraction] = useState<ExtractedShipment | null>(null);
  const [lineStates, setLineStates] = useState<LineState[]>([]);
  const [summary, setSummary] = useState<{ total_lines: number; classified_ok: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setExtraction(null);
    setLineStates([]);
    setSummary(null);
    setError(null);
    setStatusMessage("");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const start = useCallback(async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    const t0 = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", file);
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
          setLineStates(ex.line_items.map(() => ({ status: "pending" }) as LineState));
        } else if (evt.type === "line_classified") {
          const idx = evt.index as number;
          const cl = evt.classification as LineClassification;
          setStatusMessage(`Classified line ${idx + 1}…`);
          setLineStates((prev) => {
            const next = [...prev];
            next[idx] = { status: "classified", classification: cl };
            return next;
          });
        } else if (evt.type === "line_failed") {
          const idx = evt.index as number;
          setLineStates((prev) => {
            const next = [...prev];
            next[idx] = { status: "failed", error: String(evt.error) };
            return next;
          });
        } else if (evt.type === "done") {
          setSummary(evt.summary as { total_lines: number; classified_ok: number; failed: number });
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
  }, [file]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-navy">Process an invoice</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Drag a commercial-invoice PDF to extract every line item and classify it under the US Harmonized Tariff Schedule. The extractor
          reads the seller&apos;s descriptions verbatim; the classifier applies GRI 1–6 with full citations.
        </p>
      </header>

      {!extraction && !file && (
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
            accept=".pdf,.png,.jpg,.jpeg"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-navy-50 text-navy">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-navy">Drag a PDF here, or click to choose a file</div>
          <div className="mt-1 text-xs text-muted">PDF up to 10 pages, or PNG / JPG.</div>
        </label>
      )}

      {/* File confirmation card with inline action */}
      {file && !extraction && !running && (
        <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M14 3v5h5M5 21h14a2 2 0 002-2V8l-5-5H5a2 2 0 00-2 2v14a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-navy">{file.name}</div>
              <div className="text-xs text-muted">
                {(file.size / 1024).toFixed(1)} KB · ready to process
              </div>
            </div>
            <button
              onClick={() => setFile(null)}
              className="text-xs text-muted transition hover:text-navy"
              aria-label="Choose a different file"
            >
              change
            </button>
            <button
              onClick={start}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              Process this invoice
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
                {running && (
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
                )}
                <span>{error ? `Error: ${error}` : statusMessage || "Starting…"}</span>
              </div>
            </div>
            <div className="text-right text-xs text-muted">
              {elapsedMs > 0 && <>Elapsed {(elapsedMs / 1000).toFixed(1)}s</>}
              {summary && (
                <div className="mt-1">
                  {summary.total_lines} lines · {summary.classified_ok} classified · {summary.failed} failed
                </div>
              )}
            </div>
          </div>

          {extraction && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <Metric label="Vendor" value={extraction.vendor} />
                <Metric label="Invoice" value={extraction.invoice_number} />
                <Metric label="Date" value={extraction.invoice_date} />
                <Metric
                  label="Total"
                  value={`${fmtMoney(extraction.total_value, extraction.currency)}${extraction.total_value_usd_cents !== null && extraction.currency !== "USD" ? ` (${fmtMoney(extraction.total_value_usd_cents)} USD)` : ""}`}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-cardline text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="py-2 pr-4">#</th>
                      <th className="py-2 pr-4">Description</th>
                      <th className="py-2 pr-4 text-right">Qty</th>
                      <th className="py-2 pr-4 text-right">Total ({extraction.currency})</th>
                      <th className="py-2 pr-4">HTS (8d)</th>
                      <th className="py-2 pr-4">Confidence</th>
                      <th className="py-2 pr-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraction.line_items.map((li, i) => {
                      const st = lineStates[i] ?? { status: "pending" };
                      return (
                        <tr key={i} className="border-b border-cardline/60 align-top">
                          <td className="py-3 pr-4 text-muted">{i + 1}</td>
                          <td className="py-3 pr-4">
                            <div className="text-navy">{li.description}</div>
                            {li.material_composition && (
                              <div className="mt-0.5 text-[11px] text-muted">{li.material_composition}</div>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-right text-navy">{li.quantity}</td>
                          <td className="py-3 pr-4 text-right text-navy">{(li.total_value / 100).toFixed(2)}</td>
                          <td className="py-3 pr-4 font-mono text-navy">
                            {st.status === "classified"
                              ? st.classification.hts_code_8
                              : st.status === "failed"
                                ? <span className="text-warn">FAILED</span>
                                : <span className="inline-block h-3 w-12 animate-pulse rounded bg-navy-100" />}
                          </td>
                          <td className="py-3 pr-4">
                            {st.status === "classified" ? (
                              <ConfidenceBadge value={st.classification.confidence} />
                            ) : st.status === "failed" ? (
                              <span className="text-[11px] text-warn">retry exhausted</span>
                            ) : (
                              <span className="text-[11px] text-muted">…</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {st.status === "classified" && st.classification.missing_inputs_for_precision.length > 0 && (
                              <details className="text-xs text-muted">
                                <summary className="cursor-pointer text-amber">
                                  {st.classification.missing_inputs_for_precision.length} missing input{st.classification.missing_inputs_for_precision.length === 1 ? "" : "s"}
                                </summary>
                                <ul className="ml-3 mt-1 list-disc space-y-0.5">
                                  {st.classification.missing_inputs_for_precision.map((m, k) => (
                                    <li key={k}>{m}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {st.status === "failed" && (
                              <span className="text-[11px] text-warn">{st.error.slice(0, 60)}…</span>
                            )}
                          </td>
                        </tr>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 truncate font-semibold text-navy">{value}</div>
    </div>
  );
}
