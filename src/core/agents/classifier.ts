// TODO(CLAUDE.md §2 "HTS classification agent"):
//   1. Retrieve top-k HTS headings + CROSS rulings via lib/hts-retrieval + lib/cross-retrieval
//   2. Build a prompt that walks GRI 1→6 in order
//   3. Call Anthropic (DEFAULT_MODEL); on hard cases escalate to HARD_MODEL
//   4. Validate output against schemas/classification.ts (citations required)
//   5. Validate every cited ruling number actually exists (lib/citations.ts)

import type { AppContext } from "@/core/app-context";
import type { LineItem } from "@/core/types/line-item";
import type { ClassificationOutputT } from "@/core/schemas/classification";

export async function classifyLineItem(
  _ctx: AppContext,
  _lineItem: LineItem,
): Promise<ClassificationOutputT> {
  throw new Error("not implemented");
}
