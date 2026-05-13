// TODO(CLAUDE.md §1 "Document ingestion" + §4 "Entry draft generation"):
//   Shipment is the unit of work that moves through the lifecycle workflow.

export type ShipmentStatus =
  | "ingested"
  | "extracting"
  | "classifying"
  | "duty_calculated"
  | "awaiting_broker_review"
  | "broker_approved"
  | "filed"
  | "liquidated";

export interface Shipment {
  id: string;
  customerId: string;
  status: ShipmentStatus;
  countryOfOrigin: string; // ISO 3166-1 alpha-2
  portOfEntry: string | null;
  estimatedArrival: string | null; // UTC ISO 8601
  createdAt: string;
  updatedAt: string;
}
