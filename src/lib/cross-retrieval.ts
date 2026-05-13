// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Query CROSS_INDEX Vectorize with a line-item description; return top-k binding
//   rulings with ruling number, classifying HTS code, and reasoning excerpt.

import type { Env } from "@/types/env";

export interface CrossRulingResult {
  rulingNumber: string; // e.g., "NY N123456" or "HQ H123456"
  htsCode: string;
  productDescription: string;
  reasoningExcerpt: string;
  score: number;
}

export async function retrieveCrossRulings(
  _env: Env,
  _query: string,
  _topK = 8,
): Promise<CrossRulingResult[]> {
  throw new Error("not implemented");
}
