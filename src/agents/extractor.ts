// TODO(CLAUDE.md §1 "Document ingestion"):
//   Multimodal extraction agent. Takes a PDF/image from R2 DOCS, returns ExtractedDocument.
//   Validate against schemas/extraction.ts; retry on Zod failure.

import type { Env } from "@/types/env";
import type { ExtractedDocumentT } from "@/schemas/extraction";

export async function extractDocument(_env: Env, _r2Key: string): Promise<ExtractedDocumentT> {
  throw new Error("not implemented");
}
