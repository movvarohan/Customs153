// PSC / refund finder — the demo's hero feature.
//
// Composes the existing classifier with the deterministic duty calculator.
// For each historical line item:
//   1. Re-classify from the seller's description (no peeking at hts_code_as_filed)
//   2. Compute duty under both the filed and our predicted code
//   3. If our code differs at 8-digit AND results in lower duty, surface
//      as a refund opportunity (high/medium confidence only; low logged as
//      "broker review recommended")
//   4. Filter by PSC eligibility window: entries older than ~11 months are
//      outside the window — still counted, but flagged "protest required
//      instead" in notes.
//
// Classification runs with bounded concurrency (default 5). Each line's
// audit trace is persisted by classify() itself; this agent persists a
// single rollup row for the whole analysis.

import { randomUUID } from "node:crypto";
import type { AppContext } from "@/core/app-context";
import {
  type ClassificationFailureT,
  type HistoricalEntriesT,
  type PSCFindingsT,
  type RefundOpportunityT,
  type UncertainCaseT,
} from "@/core/schemas/refund";
import { classify } from "./classifier";
import { calculateDuty } from "./duty-calculator";
import type { ClassificationResultT } from "@/core/schemas/classification";
import { mapWithConcurrency } from "@/core/lib/concurrency";
import { withRetry } from "@/core/lib/retry";

/** Days in the PSC window (CBP rule of thumb — 314 days post-liquidation ≈ 1y from entry). */
const PSC_WINDOW_DAYS = 11 * 30;
/** Default concurrency for the classifier fan-out. Cap kept conservative
 *  to stay comfortably inside Anthropic rate limits. */
const DEFAULT_CONCURRENCY = 5;

function stripDots(code: string): string {
  return code.replace(/\D/g, "");
}

function toEightDigit(code: string): string {
  const digits = stripDots(code).slice(0, 8);
  if (digits.length < 8) return code;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export interface FindRefundsResult {
  findings: PSCFindingsT;
  /** Per-line audit-grade traces. */
  perLineTraces: Array<{
    entry_number: string;
    line_index: number;
    classified_hts: string;
    classified_confidence: "low" | "medium" | "high";
    duty_filed_usd_cents: number;
    duty_predicted_usd_cents: number;
    is_agreement: boolean;
    is_opportunity: boolean;
    error?: string;
  }>;
}

/**
 * Event the agent fires as each line completes (after classify + duty
 * calc + categorization). Used by the API route to stream a per-line
 * progress signal to the frontend so the UI feels alive instead of
 * frozen for 60-90s on the "Analyzing…" spinner.
 *
 * Event ordering is non-deterministic — lines complete in whatever
 * order the parallel fan-out produces. Caller can use line_global_index
 * (0-based, monotonically dense) to track progress, or entry_number +
 * line_index to identify the line.
 */
export interface LineAnalyzedEvent {
  line_global_index: number;
  total_lines: number;
  entry_number: string;
  entry_date: string;
  line_index: number;
  line_description: string;
  hts_filed: string;
  outcome:
    | { kind: "agreement"; hts_predicted: string; confidence: "low" | "medium" | "high" }
    | { kind: "opportunity"; hts_predicted: string; confidence: "low" | "medium" | "high"; recoverable_usd_cents: number }
    | { kind: "uncertain"; hts_predicted: string }
    | { kind: "failure"; error: string };
}

/** Flat tuple per line item — what we fan out over. */
interface LineTask {
  entry_number: string;
  entry_date: string;
  line_index: number;
  country_of_origin: string;
  description: string;
  quantity: number;
  unit_value_usd_cents: number;
  total_value_usd_cents: number;
  duty_paid_usd_cents: number;
  hts_code_as_filed: string;
  mode_of_transport?: "ocean" | "air" | "ground" | "other";
  psc_eligible: boolean;
}

export async function findRefundOpportunities(
  ctx: AppContext,
  historical: HistoricalEntriesT,
  options: {
    asOf?: Date;
    concurrency?: number;
    /**
     * Optional callback fired as each line finishes (after classify +
     * duty calc + categorization). Errors thrown from the callback are
     * caught and logged — they never abort the analysis.
     */
    onLineAnalyzed?: (event: LineAnalyzedEvent) => void | Promise<void>;
  } = {},
): Promise<FindRefundsResult> {
  const asOf = options.asOf ?? new Date();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const onLineAnalyzed = options.onLineAnalyzed;

  // ── Flatten ─────────────────────────────────────────────────────────────
  const tasks: LineTask[] = [];
  let outsidePsc = 0;
  for (const entry of historical.entries) {
    const ageDays = daysBetween(new Date(entry.entry_date), asOf);
    const pscEligible = ageDays <= PSC_WINDOW_DAYS;
    if (!pscEligible) outsidePsc++;
    entry.line_items.forEach((line, i) => {
      tasks.push({
        entry_number: entry.entry_number,
        entry_date: entry.entry_date,
        line_index: i,
        country_of_origin: entry.country_of_origin,
        description: line.description,
        quantity: line.quantity,
        unit_value_usd_cents: line.unit_value_usd_cents,
        total_value_usd_cents: line.total_value_usd_cents,
        duty_paid_usd_cents: line.duty_paid_usd_cents,
        hts_code_as_filed: line.hts_code_as_filed,
        ...(entry.mode_of_transport ? { mode_of_transport: entry.mode_of_transport } : {}),
        psc_eligible: pscEligible,
      });
    });
  }

  // ── Fan-out: classify + duty calc + categorize, in parallel. Each line's
  // ── full work is contained in this callback, so the optional onLineAnalyzed
  // ── callback fires the moment that line is done — not all-at-once at the
  // ── end. Earlier versions ran classify in parallel but then categorized
  // ── sequentially after the whole fan-out completed; the UI saw a frozen
  // ── "Analyzing…" for 60-90s. Per-line retry-with-backoff handles transient
  // ── Anthropic / Voyage 5xx without silently dropping a line.
  type LineOutcome =
    | { kind: "agreement"; trace: FindRefundsResult["perLineTraces"][number]; predicted: ClassificationResultT; predicted8: string; filed8: string; dutyPredictedCents: number }
    | { kind: "opportunity"; trace: FindRefundsResult["perLineTraces"][number]; opportunity: RefundOpportunityT }
    | { kind: "uncertain"; trace: FindRefundsResult["perLineTraces"][number]; uncertain: UncertainCaseT; predicted: ClassificationResultT }
    | { kind: "failure"; trace: FindRefundsResult["perLineTraces"][number]; failure: ClassificationFailureT };

  const totalLines = tasks.length;
  const settled = await mapWithConcurrency(tasks, concurrency, async (t, idx): Promise<LineOutcome> => {
    let outcome: LineOutcome;
    try {
      const { result: predicted } = await withRetry(
        () =>
          classify(ctx, {
            description: t.description,
            quantity: t.quantity,
            unit_value_usd: t.unit_value_usd_cents / 100,
            country_of_origin: t.country_of_origin,
          }),
        {
          attempts: 3,
          baseMs: 2000,
          onRetry: (err, attempt, sleepMs) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[psc-finder] classify retry ${attempt}/3 for ${t.entry_number}#${t.line_index} (sleep ${sleepMs}ms): ${msg.slice(0, 200)}`,
            );
          },
        },
      );

      const filed8 = toEightDigit(t.hts_code_as_filed);
      const predicted8 = predicted.hts_code_8;
      const isAgreement = stripDots(filed8) === stripDots(predicted8);

      // For PSC analysis we compare duty rates only — MPF and HMF are
      // entry-level value-based fees that are identical whether the line
      // is classified as filed or as predicted. They cancel mathematically
      // in (filed - predicted), so excluding them from BOTH sides keeps the
      // recoverable_amount equal to the duty-rate delta only.
      const dutyPredictedCalc = await calculateDuty(ctx, {
        hts_code: predicted.hts_code,
        country_of_origin: t.country_of_origin,
        customs_value_usd_cents: t.total_value_usd_cents,
        transport_mode: t.mode_of_transport ?? "ocean",
        include_entry_fees: false,
      });
      const dutyPredictedCents = dutyPredictedCalc.total_duty_usd_cents;
      const recoverable = t.duty_paid_usd_cents - dutyPredictedCents;
      const isOpportunity = !isAgreement && recoverable > 0;
      const trace: FindRefundsResult["perLineTraces"][number] = {
        entry_number: t.entry_number,
        line_index: t.line_index,
        classified_hts: predicted.hts_code,
        classified_confidence: predicted.confidence,
        duty_filed_usd_cents: t.duty_paid_usd_cents,
        duty_predicted_usd_cents: dutyPredictedCents,
        is_agreement: isAgreement,
        is_opportunity: isOpportunity,
      };

      if (isAgreement || !isOpportunity) {
        outcome = { kind: "agreement", trace, predicted, predicted8, filed8, dutyPredictedCents };
      } else if (predicted.confidence === "low") {
        const reasoningSummary = summarize(predicted.reasoning);
        outcome = {
          kind: "uncertain",
          trace,
          predicted,
          uncertain: {
            entry_number: t.entry_number,
            entry_date: t.entry_date,
            line_index: t.line_index,
            line_description: t.description,
            hts_filed: t.hts_code_as_filed,
            hts_predicted: predicted.hts_code,
            reason: `low-confidence disagreement; broker review recommended before action. Reasoning: ${reasoningSummary}`,
          },
        };
      } else {
        const reasoningSummary = summarize(predicted.reasoning);
        outcome = {
          kind: "opportunity",
          trace,
          opportunity: {
            entry_number: t.entry_number,
            entry_date: t.entry_date,
            line_index: t.line_index,
            line_description: t.description,
            hts_filed: t.hts_code_as_filed,
            hts_predicted: predicted.hts_code,
            hts_predicted_8: predicted8,
            hts_filed_8: filed8,
            duty_paid_usd_cents: t.duty_paid_usd_cents,
            duty_predicted_usd_cents: dutyPredictedCents,
            recoverable_amount_usd_cents: recoverable,
            our_confidence: predicted.confidence,
            reasoning_summary: reasoningSummary,
            psc_eligible: t.psc_eligible,
          },
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const trace: FindRefundsResult["perLineTraces"][number] = {
        entry_number: t.entry_number,
        line_index: t.line_index,
        classified_hts: "",
        classified_confidence: "low",
        duty_filed_usd_cents: t.duty_paid_usd_cents,
        duty_predicted_usd_cents: 0,
        is_agreement: false,
        is_opportunity: false,
        error: msg,
      };
      outcome = {
        kind: "failure",
        trace,
        failure: {
          entry_number: t.entry_number,
          line_index: t.line_index,
          line_description: t.description,
          error: msg,
        },
      };
    }

    // Fire the streaming callback. Errors are swallowed so a bad subscriber
    // can't abort the analysis.
    if (onLineAnalyzed) {
      try {
        const event: LineAnalyzedEvent = {
          line_global_index: idx,
          total_lines: totalLines,
          entry_number: t.entry_number,
          entry_date: t.entry_date,
          line_index: t.line_index,
          line_description: t.description,
          hts_filed: t.hts_code_as_filed,
          outcome:
            outcome.kind === "agreement"
              ? { kind: "agreement", hts_predicted: outcome.predicted.hts_code, confidence: outcome.predicted.confidence }
              : outcome.kind === "opportunity"
                ? {
                    kind: "opportunity",
                    hts_predicted: outcome.opportunity.hts_predicted,
                    confidence: outcome.opportunity.our_confidence,
                    recoverable_usd_cents: outcome.opportunity.recoverable_amount_usd_cents,
                  }
                : outcome.kind === "uncertain"
                  ? { kind: "uncertain", hts_predicted: outcome.predicted.hts_code }
                  : { kind: "failure", error: outcome.failure.error },
        };
        await onLineAnalyzed(event);
      } catch (cbErr) {
        console.warn(
          `[psc-finder] onLineAnalyzed callback threw (ignored): ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`,
        );
      }
    }
    return outcome;
  });

  // ── Aggregate per-line outcomes in input order ─────────────────────────
  const opportunities: RefundOpportunityT[] = [];
  const uncertain: UncertainCaseT[] = [];
  const failures: ClassificationFailureT[] = [];
  const traces: FindRefundsResult["perLineTraces"] = [];
  const notes: string[] = [];

  let agreements = 0;
  let disagreements = 0;
  let classifierErrors = 0;

  for (let idx = 0; idx < settled.length; idx++) {
    const r = settled[idx]!;
    if (r.status === "rejected") {
      // mapWithConcurrency only rejects if our outcome callback itself threw —
      // not the per-line classify, since we caught that above. Treat as failure.
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      classifierErrors++;
      const t = tasks[idx]!;
      failures.push({ entry_number: t.entry_number, line_index: t.line_index, line_description: t.description, error: msg });
      traces.push({
        entry_number: t.entry_number,
        line_index: t.line_index,
        classified_hts: "",
        classified_confidence: "low",
        duty_filed_usd_cents: t.duty_paid_usd_cents,
        duty_predicted_usd_cents: 0,
        is_agreement: false,
        is_opportunity: false,
        error: msg,
      });
      continue;
    }
    const o = r.value;
    traces.push(o.trace);
    if (o.kind === "failure") {
      classifierErrors++;
      failures.push(o.failure);
      continue;
    }
    if (o.kind === "agreement") {
      if (o.trace.is_agreement) agreements++;
      else disagreements++;
      continue;
    }
    disagreements++;
    if (o.kind === "uncertain") uncertain.push(o.uncertain);
    else opportunities.push(o.opportunity);
  }

  // ── Aggregates ──────────────────────────────────────────────────────────
  opportunities.sort((a, b) => b.recoverable_amount_usd_cents - a.recoverable_amount_usd_cents);

  const totalRecov = opportunities.reduce((s, o) => s + o.recoverable_amount_usd_cents, 0);
  const cb = { high_usd_cents: 0, medium_usd_cents: 0, low_usd_cents: 0 };
  for (const o of opportunities) {
    if (o.our_confidence === "high") cb.high_usd_cents += o.recoverable_amount_usd_cents;
    else if (o.our_confidence === "medium") cb.medium_usd_cents += o.recoverable_amount_usd_cents;
  }

  if (outsidePsc > 0) {
    notes.push(
      `${outsidePsc} entries are older than ${PSC_WINDOW_DAYS} days (outside the PSC filing window). Recoverable on those entries requires a protest (CBP Form 19) within 180 days of liquidation, not a PSC.`,
    );
  }
  if (uncertain.length > 0) {
    notes.push(
      `${uncertain.length} disagreements were low-confidence — listed in uncertain_cases for human review before any filing.`,
    );
  }
  if (classifierErrors > 0) {
    notes.push(
      `${classifierErrors} line items errored during classification (see perLineTraces[*].error). They are not counted in agreements/disagreements and require manual re-run.`,
    );
  }
  notes.push(
    "Recoverable amounts assume CBP accepts the re-classification. Production filing should attach the agent's full reasoning trace from audit_log as the reasonable-care basis.",
  );

  const findings: PSCFindingsT = {
    importer: historical.importer,
    analyzed_at: asOf.toISOString(),
    total_entries_analyzed: historical.entries.length,
    total_line_items_analyzed: tasks.length,
    classified_ok: tasks.length - classifierErrors,
    classification_failed: classifierErrors,
    agreements,
    disagreements,
    outside_psc_window: outsidePsc,
    refund_opportunities: opportunities,
    uncertain_cases: uncertain,
    failures,
    total_recoverable_usd_cents: totalRecov,
    confidence_breakdown: cb,
    notes,
  };

  await persistAuditLog(ctx, historical.importer, findings, traces);

  return { findings, perLineTraces: traces };
}

function summarize(reasoning: string): string {
  const sents = reasoning.split(/(?<=[.!?])\s+/);
  return sents.slice(0, 2).join(" ").slice(0, 280);
}

async function persistAuditLog(
  ctx: AppContext,
  importer: string,
  findings: PSCFindingsT,
  traces: FindRefundsResult["perLineTraces"],
): Promise<void> {
  const id = randomUUID();
  const payload = JSON.stringify({ findings, traces });
  await ctx.db
    .prepare(
      "INSERT INTO audit_log (id, occurred_at, actor, entity_kind, entity_id, action, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      new Date().toISOString(),
      `system:psc-finder@${ctx.config.defaultModel}`,
      "refund_analysis",
      importer,
      "find_refunds",
      payload,
    )
    .run();
}

export type { HistoricalEntryT as HistoricalEntry, HistoricalLineItemT as HistoricalLineItem } from "@/core/schemas/refund";
