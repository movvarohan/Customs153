"use client";

import { fmtMoney } from "@/lib/api";

interface Opportunity {
  entry_number: string;
  entry_date: string;
  line_description: string;
  hts_filed_8: string;
  hts_predicted_8: string;
  duty_paid_usd_cents: number;
  duty_predicted_usd_cents: number;
  recoverable_amount_usd_cents: number;
  our_confidence: "low" | "medium" | "high";
  psc_eligible: boolean;
}
interface Findings {
  importer: string;
  analyzed_at: string;
  total_entries_analyzed: number;
  total_line_items_analyzed: number;
  refund_opportunities: Opportunity[];
  total_recoverable_usd_cents: number;
  confidence_breakdown: { high_usd_cents: number; medium_usd_cents: number; low_usd_cents: number };
}

// A polished, branded, print-ready one-page Savings Report — the artifact a
// prospect actually receives after the free audit. Rendered as a full-screen
// overlay; "Save as PDF" uses the browser's print path (print CSS prints only
// this report).
export function SavingsReport({ findings, onClose }: { findings: Findings; onClose: () => void }) {
  const cb = findings.confidence_breakdown;
  const total = findings.total_recoverable_usd_cents || 1;
  const opps = [...findings.refund_opportunities].sort((a, b) => b.recoverable_amount_usd_cents - a.recoverable_amount_usd_cents);
  const totalDutyPaid = opps.reduce((a, o) => a + o.duty_paid_usd_cents, 0);
  const savingsPct = totalDutyPaid > 0 ? (findings.total_recoverable_usd_cents / totalDutyPaid) * 100 : 0;
  const date = new Date(findings.analyzed_at);
  const dateStr = isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-navy/40 backdrop-blur-sm print:bg-white print:backdrop-blur-none">
      {/* Toolbar (hidden when printing) */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-cardline bg-white px-6 py-3 shadow-sm">
        <span className="text-sm font-semibold text-navy">Savings report preview</span>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-navy/90">
            Save as PDF / Print
          </button>
          <button onClick={onClose} className="rounded-md border border-cardline px-3 py-1.5 text-sm text-navy transition hover:bg-navy-50">Close</button>
        </div>
      </div>

      <div className="mx-auto my-6 max-w-3xl px-4 print:my-0 print:max-w-none print:px-0">
        <div className="print-area rounded-card border border-cardline bg-white p-10 shadow-card print:border-0 print:shadow-none">
          {/* Letterhead */}
          <div className="flex items-start justify-between border-b border-cardline pb-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-white">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5 2 4v4c0 3.4 2.5 5.6 6 6.5 3.5-.9 6-3.1 6-6.5V4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M5.5 8.2 7.2 10 10.5 6.3" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="leading-tight">
                <div className="text-[15px] font-bold text-navy">Customs Agent Suite</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Duty recovery audit</div>
              </div>
            </div>
            <div className="text-right text-[11px] text-muted">
              <div className="font-semibold text-navy">{findings.importer}</div>
              <div>Audit date {dateStr}</div>
              <div>{findings.total_entries_analyzed} entries · {findings.total_line_items_analyzed} line items reclassified</div>
            </div>
          </div>

          {/* Hero */}
          <div className="mt-6 rounded-card bg-accent-50/60 p-6 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-700">Estimated recoverable duty</div>
            <div className="mt-1 text-5xl font-extrabold tabular-nums text-accent-700">{fmtMoney(findings.total_recoverable_usd_cents)}</div>
            <div className="mt-1 text-sm text-navy">
              across {opps.length} {opps.length === 1 ? "opportunity" : "opportunities"}
              {savingsPct > 0 && <> · {savingsPct.toFixed(1)}% of duty paid on the affected lines</>}
            </div>
          </div>

          {/* Confidence split */}
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
              <span className="font-semibold uppercase tracking-widest">Recoverable by confidence</span>
              <span>{fmtMoney(findings.total_recoverable_usd_cents)} total</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-navy-50">
              <div style={{ width: `${(cb.high_usd_cents / total) * 100}%`, background: "#0ea672" }} title="High confidence" />
              <div style={{ width: `${(cb.medium_usd_cents / total) * 100}%`, background: "#3b82f6" }} title="Medium confidence" />
              <div style={{ width: `${(cb.low_usd_cents / total) * 100}%`, background: "#d08a2f" }} title="Low confidence" />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <Legend color="#0ea672" label="High" v={fmtMoney(cb.high_usd_cents)} />
              <Legend color="#3b82f6" label="Medium" v={fmtMoney(cb.medium_usd_cents)} />
              <Legend color="#d08a2f" label="Low" v={fmtMoney(cb.low_usd_cents)} />
            </div>
          </div>

          {/* Methodology */}
          <div className="mt-5 rounded-md border border-cardline bg-navy-50/40 p-4 text-[11px] leading-relaxed text-muted">
            <span className="font-semibold text-navy">How we found this: </span>
            We reclassified every line item from scratch using current methodology — General Rules of Interpretation
            1–6, the live HTS schedule, and CBP CROSS binding rulings — then compared each result against the code
            as filed. Where the filed code overstated duty (wrong subheading, a missed Section 301 exclusion, or an
            unclaimed FTA preference), the difference is recoverable via a Post Summary Correction while the entry is
            still within its window.
          </div>

          {/* Top opportunities */}
          <div className="mt-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">Top opportunities</div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-cardline text-left uppercase tracking-wider text-muted">
                  <th className="py-1.5">Entry</th>
                  <th className="py-1.5">Product</th>
                  <th className="py-1.5">Filed → Corrected</th>
                  <th className="py-1.5 text-center">Conf.</th>
                  <th className="py-1.5 text-right">Recoverable</th>
                </tr>
              </thead>
              <tbody>
                {opps.slice(0, 10).map((o, i) => (
                  <tr key={i} className="border-b border-cardline/50">
                    <td className="py-1.5 font-mono text-navy">{o.entry_number}</td>
                    <td className="max-w-[180px] truncate py-1.5 text-navy">{o.line_description}</td>
                    <td className="py-1.5 font-mono text-muted">{o.hts_filed_8} → <span className="text-navy">{o.hts_predicted_8}</span></td>
                    <td className="py-1.5 text-center">
                      <span className="capitalize" style={{ color: o.our_confidence === "high" ? "#0ea672" : o.our_confidence === "medium" ? "#3b82f6" : "#d08a2f" }}>{o.our_confidence}</span>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-accent-700">{fmtMoney(o.recoverable_amount_usd_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {opps.length > 10 && <div className="mt-1 text-[10px] text-muted">+ {opps.length - 10} more in the full report.</div>}
          </div>

          {/* Next steps */}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Step n={1} title="Confirm" body="Our licensed broker partner reviews each opportunity and signs off." />
            <Step n={2} title="File" body="We draft and file the Post Summary Corrections before each entry's window closes." />
            <Step n={3} title="Recover" body="CBP issues the refund; you keep the overpaid duty." />
          </div>

          {/* Footer / disclosure */}
          <div className="mt-6 border-t border-cardline pt-3 text-[9px] leading-relaxed text-muted">
            Estimates are AI-generated and subject to licensed-broker review before filing; final figures depend on
            CBP acceptance. Customs Agent Suite is not a licensed customs broker — all filings go through our broker
            partner under their license and ABI permit, with responsible supervision and control per 19 CFR Part 111.
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, v }: { color: string; label: string; v: string }) {
  return (
    <span className="flex items-center gap-1 text-muted">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label} <span className="font-semibold text-navy">{v}</span>
    </span>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-md border border-cardline p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white">{n}</span>
        <span className="text-[12px] font-semibold text-navy">{title}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-muted">{body}</p>
    </div>
  );
}
