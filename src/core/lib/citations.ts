// TODO(CLAUDE.md §2 + Eval methodology "100% citation grounding"):
//   Verifies that every citation in a classification points at a real ruling /
//   real HTS paragraph. Cross-references ctx.reference and ctx.crossIndex.
//   Returns the list of citations that did not ground — non-empty means we
//   reject the classification.

import type { AppContext } from "@/core/app-context";
import type { Citation } from "@/core/types/classification";

export async function verifyCitations(
  _ctx: AppContext,
  _citations: Citation[],
): Promise<{ ungrounded: Citation[] }> {
  throw new Error("not implemented");
}

export function formatCitation(c: Citation): string {
  return `[${c.kind}] ${c.reference}`;
}
