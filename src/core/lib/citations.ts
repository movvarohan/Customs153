// TODO(CLAUDE.md §2 + Eval methodology "100% citation grounding"):
//   The classifier agent currently validates citations inline against the
//   retrieved candidate set (see src/core/agents/classifier.ts). This module
//   will eventually verify that every cited code maps to a real ruling or
//   HTS paragraph in the REFERENCE bucket — a stronger check than mere
//   "appeared in retrieval candidates."

import type { AppContext } from "@/core/app-context";

export interface CitationRef {
  kind: "hts_paragraph" | "cbp_ruling" | "chapter_note" | "explanatory_note";
  reference: string;
  excerpt: string;
}

export async function verifyCitations(
  _ctx: AppContext,
  _citations: CitationRef[],
): Promise<{ ungrounded: CitationRef[] }> {
  throw new Error("not implemented");
}

export function formatCitation(c: CitationRef): string {
  return `[${c.kind}] ${c.reference}`;
}
