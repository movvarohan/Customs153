// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Validates LLM classifier output. Citations are required — if the model returns
//   an empty array, reject and retry with stricter system prompt.

import { z } from "zod";

export const ClassificationCitation = z.object({
  kind: z.enum(["hts_paragraph", "cbp_ruling", "chapter_note", "explanatory_note"]),
  reference: z.string().min(1),
  excerpt: z.string().min(1),
});

export const ClassificationOutput = z.object({
  htsCode: z.string().regex(/^\d{10}$/, "must be 10-digit HTS code"),
  description: z.string().min(1),
  griRuleApplied: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  citations: z.array(ClassificationCitation).min(1, "every classification must cite at least one source"),
  alternativesConsidered: z.array(
    z.object({
      htsCode: z.string(),
      rejectedBecause: z.string(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  reasoningTrace: z.string().min(1),
});

export type ClassificationOutputT = z.infer<typeof ClassificationOutput>;
