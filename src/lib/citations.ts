// TODO(CLAUDE.md §2 "HTS classification agent" + Eval methodology "100% citation grounding"):
//   Verifies that every citation in a classification points at a real ruling /
//   real HTS paragraph. Cross-references against the REFERENCE R2 bucket and
//   the CROSS_INDEX Vectorize ids. Returns the list of citations that did not
//   ground — non-empty means we reject the classification.

import type { Env } from "@/types/env";
import type { Citation } from "@/types/classification";

export async function verifyCitations(
  _env: Env,
  _citations: Citation[],
): Promise<{ ungrounded: Citation[] }> {
  throw new Error("not implemented");
}

export function formatCitation(c: Citation): string {
  return `[${c.kind}] ${c.reference}`;
}
