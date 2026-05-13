// TODO(CLAUDE.md §3 "Duty calculator"):
//   Deterministic — no LLM calls. Pulls rate table from ctx.cache, applies
//   Section 301/232/reciprocal/AD/CVD, MPF, HMF, FTA preferences. Returns
//   DutyCalculation with every component itemized for audit trail.

import type { AppContext } from "@/core/app-context";
import type { LineItem } from "@/core/types/line-item";
import type { DutyCalculation } from "@/core/types/duty";

export async function calculateDuty(
  _ctx: AppContext,
  _lineItem: LineItem,
  _htsCode: string,
): Promise<DutyCalculation> {
  throw new Error("not implemented");
}
