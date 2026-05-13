// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Every classification must cite at least one HTS paragraph or CBP ruling.

export interface Citation {
  kind: "hts_paragraph" | "cbp_ruling" | "chapter_note" | "explanatory_note";
  reference: string; // e.g., "HTS 8518.30.20" or "NY N123456"
  excerpt: string;
}

export interface Classification {
  id: string;
  lineItemId: string;
  htsCode: string; // 10-digit
  description: string;
  griRuleApplied: 1 | 2 | 3 | 4 | 5 | 6;
  citations: Citation[];
  alternativesConsidered: { htsCode: string; rejectedBecause: string }[];
  confidence: number; // 0..1
  reasoningTrace: string;
  modelVersion: string;
  reviewedBy: string | null; // broker user id once reviewed
  reviewedAt: string | null;
  createdAt: string;
}
