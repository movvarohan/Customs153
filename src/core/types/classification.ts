// Domain type for a stored classification row (D1 / sqlite shape). The
// agent's wire output lives in src/core/schemas/classification.ts.

import type { ClassificationResultT } from "@/core/schemas/classification";

export interface Classification {
  id: string;
  lineItemId: string;
  /** Agent output (citations, alternatives, GRI rule, confidence, hts_code …). */
  output: ClassificationResultT;
  modelVersion: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
