// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Query HTS_INDEX Vectorize with a line-item description; return top-k chapter
//   notes + headings with HTS paragraph references for the classifier prompt.

import type { Env } from "@/types/env";

export interface HtsRetrievalResult {
  htsPrefix: string; // e.g., "8518.30"
  text: string;
  score: number;
}

export async function retrieveHtsCandidates(
  _env: Env,
  _query: string,
  _topK = 12,
): Promise<HtsRetrievalResult[]> {
  throw new Error("not implemented");
}
