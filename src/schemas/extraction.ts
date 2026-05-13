// TODO(CLAUDE.md §1 "Document ingestion"):
//   Zod schemas for validating multimodal extraction output from the LLM.
//   Per CLAUDE.md conventions, retry with structured output enforcement on validation failure.

import { z } from "zod";

export const ExtractedLineItem = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitValueCents: z.number().int().nonnegative(),
  countryOfOrigin: z.string().length(2),
  manufacturer: z.string().nullable(),
  materialComposition: z.string().nullable(),
  intendedUse: z.string().nullable(),
});

export const ExtractedDocument = z.object({
  documentKind: z.enum([
    "commercial_invoice",
    "packing_list",
    "bill_of_lading",
    "mill_test_certificate",
    "isf_data",
    "unknown",
  ]),
  shipmentMetadata: z.object({
    portOfEntry: z.string().nullable(),
    estimatedArrival: z.string().nullable(),
    consignee: z.string().nullable(),
    shipper: z.string().nullable(),
  }),
  lineItems: z.array(ExtractedLineItem),
});

export type ExtractedLineItemT = z.infer<typeof ExtractedLineItem>;
export type ExtractedDocumentT = z.infer<typeof ExtractedDocument>;
