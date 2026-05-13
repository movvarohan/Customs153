// TODO(CLAUDE.md §1 "Document ingestion"):
//   Multimodal extraction agent. Pulls the document from ctx.docs by key,
//   sends it to Anthropic, returns ExtractedDocument. Validates with
//   schemas/extraction.ts and retries on Zod failure.

import type { AppContext } from "@/core/app-context";
import type { ExtractedDocumentT } from "@/core/schemas/extraction";

export async function extractDocument(_ctx: AppContext, _blobKey: string): Promise<ExtractedDocumentT> {
  throw new Error("not implemented");
}
