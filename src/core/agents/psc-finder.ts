// TODO(CLAUDE.md §7 "Duty refund / PSC finder — HERO FEATURE"):
//   For each historical entry: re-classify from scratch, compare to filed classification,
//   detect (a) misclassification, (b) missed FTA preference, (c) missed §301 exclusion,
//   (d) wrong valuation method. Quantify recoverable duty. Draft PSC / protest.

import type { AppContext } from "@/core/app-context";

export interface HistoricalEntry {
  entryNumber: string;
  filedHtsCode: string;
  description: string;
  countryOfOrigin: string;
  customsValueCents: number;
  dutyPaidCents: number;
  entryDate: string;
}

export interface RefundFinding {
  entryNumber: string;
  proposedHtsCode: string;
  reason: "misclassification" | "missed_fta" | "missed_301_exclusion" | "valuation_error";
  recoverableCents: number;
  reasoning: string;
}

export async function findRefunds(
  _ctx: AppContext,
  _customerId: string,
  _entries: HistoricalEntry[],
): Promise<RefundFinding[]> {
  throw new Error("not implemented");
}
