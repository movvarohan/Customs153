// TODO(CLAUDE.md §3 "Duty calculator"):
//   Deterministic — no LLM calls. Pulls rate table from KV CACHE, applies
//   Section 301/232/reciprocal/AD/CVD, MPF, HMF, FTA preferences. Returns
//   DutyCalculation with every component itemized for audit trail.

import type { Env } from "@/types/env";
import type { LineItem } from "@/types/line-item";
import type { DutyCalculation } from "@/types/duty";

export async function calculateDuty(
  _env: Env,
  _lineItem: LineItem,
  _htsCode: string,
): Promise<DutyCalculation> {
  throw new Error("not implemented");
}
