// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Embed the query via ctx.embeddings, query ctx.crossIndex, return top-k binding
//   rulings with ruling number, classifying HTS code, and reasoning excerpt.

import type { AppContext } from "@/core/app-context";

export interface CrossRulingResult {
  rulingNumber: string; // e.g., "NY N123456" or "HQ H123456"
  htsCode: string;
  productDescription: string;
  reasoningExcerpt: string;
  score: number;
}

export async function retrieveCrossRulings(
  _ctx: AppContext,
  _query: string,
  _topK = 8,
): Promise<CrossRulingResult[]> {
  throw new Error("not implemented");
}
