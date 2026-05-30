// Liquidation / PSC / protest deadline tracking.
//
// Customs entries have a hard, time-boxed lifecycle and most importers miss
// the windows. From each entry's date we derive, deterministically:
//   - scheduled liquidation  = entry_date + 314 days (CBP's standard cycle)
//   - PSC window closes       = 15 days before liquidation (a Post Summary
//                               Correction must be filed up to 300 days after
//                               entry and no later than ~15 days pre-liquidation)
//   - protest window closes   = liquidation + 180 days (19 USC 1514)
//
// We then classify where each entry sits today and how long the actionable
// window has left, so the importer never lets recoverable duty expire.

const DAY_MS = 24 * 60 * 60 * 1000;
const LIQUIDATION_DAYS = 314;
const PSC_PRE_LIQ_DAYS = 15;
const PROTEST_DAYS = 180;

export type DeadlineStatus = "psc_open" | "pre_liquidation" | "protest_open" | "closed";
export type Urgency = "urgent" | "soon" | "ok" | "none";

export interface DeadlineEntry {
  entry_number: string;
  entry_date: string;
  port_of_entry: string;
  country_of_origin: string;
  line_count: number;
  value_usd_cents: number;
  duty_paid_usd_cents: number;
  liquidation_date: string;
  psc_deadline: string;
  protest_deadline: string;
  status: DeadlineStatus;
  /** The next actionable/structural deadline date and a human label. */
  next_deadline: string;
  next_label: string;
  days_left: number;
  /** Whether the importer can still act (file a PSC or a protest). */
  actionable: boolean;
  urgency: Urgency;
}

export interface DeadlineSummary {
  importer: string;
  as_of: string;
  total_entries: number;
  psc_open: number;
  protest_open: number;
  closed: number;
  urgent: number;
  /** Duty still inside an actionable (PSC or protest) window. */
  actionable_duty_usd_cents: number;
  total_duty_usd_cents: number;
}

interface RawEntry {
  entry_number: string;
  entry_date: string;
  port_of_entry?: string;
  country_of_origin?: string;
  line_items: Array<{ total_value_usd_cents?: number; duty_paid_usd_cents?: number }>;
}

function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * DAY_MS);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function computeDeadlines(
  importer: string,
  entries: RawEntry[],
  asOf: Date = new Date(),
): { summary: DeadlineSummary; entries: DeadlineEntry[] } {
  const rows: DeadlineEntry[] = entries.map((e) => {
    const liquidation = addDays(e.entry_date, LIQUIDATION_DAYS);
    const pscDeadline = addDays(e.entry_date, LIQUIDATION_DAYS - PSC_PRE_LIQ_DAYS);
    const protestDeadline = new Date(liquidation.getTime() + PROTEST_DAYS * DAY_MS);
    const value = e.line_items.reduce((a, li) => a + (li.total_value_usd_cents ?? 0), 0);
    const duty = e.line_items.reduce((a, li) => a + (li.duty_paid_usd_cents ?? 0), 0);

    let status: DeadlineStatus;
    let nextDeadline: Date;
    let nextLabel: string;
    if (asOf < pscDeadline) {
      status = "psc_open";
      nextDeadline = pscDeadline;
      nextLabel = "PSC window closes";
    } else if (asOf < liquidation) {
      status = "pre_liquidation";
      nextDeadline = liquidation;
      nextLabel = "Liquidates";
    } else if (asOf < protestDeadline) {
      status = "protest_open";
      nextDeadline = protestDeadline;
      nextLabel = "Protest window closes";
    } else {
      status = "closed";
      nextDeadline = protestDeadline;
      nextLabel = "Window closed";
    }
    const daysLeft = daysBetween(asOf, nextDeadline);
    const actionable = status === "psc_open" || status === "protest_open";
    let urgency: Urgency = "none";
    if (actionable) urgency = daysLeft <= 30 ? "urgent" : daysLeft <= 60 ? "soon" : "ok";

    return {
      entry_number: e.entry_number,
      entry_date: e.entry_date,
      port_of_entry: e.port_of_entry ?? "—",
      country_of_origin: e.country_of_origin ?? "—",
      line_count: e.line_items.length,
      value_usd_cents: value,
      duty_paid_usd_cents: duty,
      liquidation_date: fmt(liquidation),
      psc_deadline: fmt(pscDeadline),
      protest_deadline: fmt(protestDeadline),
      status,
      next_deadline: fmt(nextDeadline),
      next_label: nextLabel,
      days_left: daysLeft,
      actionable,
      urgency,
    };
  });

  // Sort: actionable first, soonest deadline first; then the rest by date.
  rows.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    if (a.actionable) return a.days_left - b.days_left;
    return new Date(a.next_deadline).getTime() - new Date(b.next_deadline).getTime();
  });

  const summary: DeadlineSummary = {
    importer,
    as_of: fmt(asOf),
    total_entries: rows.length,
    psc_open: rows.filter((r) => r.status === "psc_open").length,
    protest_open: rows.filter((r) => r.status === "protest_open").length,
    closed: rows.filter((r) => r.status === "closed").length,
    urgent: rows.filter((r) => r.urgency === "urgent").length,
    actionable_duty_usd_cents: rows.filter((r) => r.actionable).reduce((a, r) => a + r.duty_paid_usd_cents, 0),
    total_duty_usd_cents: rows.reduce((a, r) => a + r.duty_paid_usd_cents, 0),
  };

  return { summary, entries: rows };
}
