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
// Audit-logs each line individually so a broker can trace every claim.

import { randomUUID } from "node:crypto";
import type { AppContext } from "@/core/app-context";
import {
  type HistoricalEntriesT,
  type HistoricalEntryT,
  type HistoricalLineItemT,
  type PSCFindingsT,
  type RefundOpportunityT,
  type UncertainCaseT,
} from "@/core/schemas/refund";
import { classify } from "./classifier";
import { calculateDuty } from "./duty-calculator";

/** Days in the PSC window (CBP rule of thumb — 314 days post-liquidation ≈ 1y from entry). */
const PSC_WINDOW_DAYS = 11 * 30;

function stripDots(code: string): string {
  return code.replace(/\D/g, "");
}

function toEightDigit(code: string): string {
  const digits = stripDots(code).slice(0, 8);
  if (digits.length < 8) return code; // can't normalize, return as-is
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export interface FindRefundsResult {
  findings: PSCFindingsT;
  /** Per-line audit-grade traces — same data as audit_log payloads for inspection. */
  perLineTraces: Array<{
    entry_number: string;
    line_index: number;
    classified_hts: string;
    classified_confidence: "low" | "medium" | "high";
    duty_filed_usd_cents: number;
    duty_predicted_usd_cents: number;
    is_agreement: boolean;
    is_opportunity: boolean;
  }>;
}

export async function findRefundOpportunities(
  ctx: AppContext,
  historical: HistoricalEntriesT,
  options: { asOf?: Date } = {},
): Promise<FindRefundsResult> {
  const asOf = options.asOf ?? new Date();
  const opportunities: RefundOpportunityT[] = [];
  const uncertain: UncertainCaseT[] = [];
  const traces: FindRefundsResult["perLineTraces"] = [];
  const notes: string[] = [];

  let agreements = 0;
  let disagreements = 0;
  let outsidePsc = 0;
  let totalLines = 0;

  for (const entry of historical.entries) {
    const entryDate = new Date(entry.entry_date);
    const ageDays = daysBetween(entryDate, asOf);
    const pscEligible = ageDays <= PSC_WINDOW_DAYS;
    if (!pscEligible) outsidePsc++;

    for (let i = 0; i < entry.line_items.length; i++) {
      const line = entry.line_items[i]!;
      totalLines++;

      // Re-classify. Pass description + quantity + unit value + country —
      // anything except hts_code_as_filed (the agent must not see that).
      const { result: predicted } = await classify(ctx, {
        description: line.description,
        quantity: line.quantity,
        unit_value_usd: line.unit_value_usd_cents / 100,
        country_of_origin: entry.country_of_origin,
      });

      const filed8 = toEightDigit(line.hts_code_as_filed);
      const predicted8 = predicted.hts_code_8;
      const isAgreement = stripDots(filed8) === stripDots(predicted8);

      // Compute duty under both codes — same value, same country, same mode.
      // Use the broker's reported duty_paid for "filed" rather than recomputing
      // (production reality: broker math may include things we don't model, so
      // we honor what was actually paid).
      const dutyFiledCents = line.duty_paid_usd_cents;
      const dutyPredictedCalc = await calculateDuty(ctx, {
        hts_code: predicted.hts_code,
        country_of_origin: entry.country_of_origin,
        customs_value_usd_cents: line.total_value_usd_cents,
        transport_mode: "ocean",
      });
      const dutyPredictedCents = dutyPredictedCalc.total_duty_usd_cents;
      const recoverable = dutyFiledCents - dutyPredictedCents;
      const isOpportunity = !isAgreement && recoverable > 0;

      if (isAgreement) agreements++;
      else disagreements++;

      traces.push({
        entry_number: entry.entry_number,
        line_index: i,
        classified_hts: predicted.hts_code,
        classified_confidence: predicted.confidence,
        duty_filed_usd_cents: dutyFiledCents,
        duty_predicted_usd_cents: dutyPredictedCents,
        is_agreement: isAgreement,
        is_opportunity: isOpportunity,
      });

      if (!isOpportunity) continue;

      const reasoningSummary = summarize(predicted.reasoning);

      if (predicted.confidence === "low") {
        uncertain.push({
          entry_number: entry.entry_number,
          entry_date: entry.entry_date,
          line_index: i,
          line_description: line.description,
          hts_filed: line.hts_code_as_filed,
          hts_predicted: predicted.hts_code,
          reason: `low-confidence disagreement; broker review recommended before action. Reasoning: ${reasoningSummary}`,
        });
        continue;
      }

      opportunities.push({
        entry_number: entry.entry_number,
        entry_date: entry.entry_date,
        line_index: i,
        line_description: line.description,
        hts_filed: line.hts_code_as_filed,
        hts_predicted: predicted.hts_code,
        hts_predicted_8: predicted8,
        hts_filed_8: filed8,
        duty_paid_usd_cents: dutyFiledCents,
        duty_predicted_usd_cents: dutyPredictedCents,
        recoverable_amount_usd_cents: recoverable,
        our_confidence: predicted.confidence,
        reasoning_summary: reasoningSummary,
        psc_eligible: pscEligible,
      });
    }
  }

  // ── Aggregates ─────────────────────────────────────────────────────────
  opportunities.sort((a, b) => b.recoverable_amount_usd_cents - a.recoverable_amount_usd_cents);

  const totalRecov = opportunities.reduce((s, o) => s + o.recoverable_amount_usd_cents, 0);
  const cb = { high_usd_cents: 0, medium_usd_cents: 0, low_usd_cents: 0 };
  for (const o of opportunities) {
    if (o.our_confidence === "high") cb.high_usd_cents += o.recoverable_amount_usd_cents;
    else if (o.our_confidence === "medium") cb.medium_usd_cents += o.recoverable_amount_usd_cents;
  }
  // (Low confidence is in uncertain_cases, not opportunities — by design.)

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
  notes.push(
    "Recoverable amounts assume CBP accepts the re-classification. Production filing should attach the agent's full reasoning trace from audit_log as the reasonable-care basis.",
  );

  const findings: PSCFindingsT = {
    importer: historical.importer,
    analyzed_at: asOf.toISOString(),
    total_entries_analyzed: historical.entries.length,
    total_line_items_analyzed: totalLines,
    agreements,
    disagreements,
    outside_psc_window: outsidePsc,
    refund_opportunities: opportunities,
    uncertain_cases: uncertain,
    total_recoverable_usd_cents: totalRecov,
    confidence_breakdown: cb,
    notes,
  };

  await persistAuditLog(ctx, historical.importer, findings, traces);

  return { findings, perLineTraces: traces };
}

function summarize(reasoning: string): string {
  // First two sentences. Keep it short for the broker table.
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

export type { HistoricalEntryT as HistoricalEntry, HistoricalLineItemT as HistoricalLineItem };
