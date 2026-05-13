// Background job payloads. The BackgroundQueue<T> is parameterized over these.

export interface ClassificationJob {
  shipmentId: string;
  lineItemId: string;
}
