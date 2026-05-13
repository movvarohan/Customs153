// TODO(CLAUDE.md §9 "Per-customer SKU master database"):
//   Customer entity tied to its SKU master and historical entries.

export interface Customer {
  id: string;
  name: string;
  importerNumber: string | null; // CBP-assigned IOR number
  email: string;
  createdAt: string; // UTC ISO 8601
}
