// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Embed the query via ctx.embeddings, query ctx.htsIndex, return top-k chapter
//   notes + headings with HTS paragraph references for the classifier prompt.

import type { AppContext } from "@/core/app-context";

export interface HtsRetrievalResult {
  htsPrefix: string; // e.g., "8518.30"
  text: string;
  score: number;
}

export async function retrieveHtsCandidates(
  _ctx: AppContext,
  _query: string,
  _topK = 12,
): Promise<HtsRetrievalResult[]> {
  throw new Error("not implemented");
}
