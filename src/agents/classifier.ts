// TODO(CLAUDE.md §2 "HTS classification agent"):
//   1. Retrieve top-k HTS headings + CROSS rulings via lib/hts-retrieval + lib/cross-retrieval
//   2. Build a prompt that walks GRI 1→6 in order
//   3. Call Anthropic (DEFAULT_MODEL); on hard cases escalate to HARD_MODEL
//   4. Validate output against schemas/classification.ts (citations required)
//   5. Validate every cited ruling number actually exists (lib/citations.ts)

import type { Env } from "@/types/env";
import type { LineItem } from "@/types/line-item";
import type { ClassificationOutputT } from "@/schemas/classification";

export async function classifyLineItem(
  _env: Env,
  _lineItem: LineItem,
): Promise<ClassificationOutputT> {
  throw new Error("not implemented");
}
