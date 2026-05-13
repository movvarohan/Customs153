// TODO(CLAUDE.md §1 "Document ingestion"):
//   Line item extracted from a commercial invoice / packing list.

export interface LineItem {
  id: string;
  shipmentId: string;
  description: string;
  quantity: number;
  unitValueCents: number; // monetary values always in integer cents
  countryOfOrigin: string; // ISO 3166-1 alpha-2
  manufacturer: string | null;
  materialComposition: string | null;
  intendedUse: string | null;
}
