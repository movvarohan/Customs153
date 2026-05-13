// TODO(CLAUDE.md "Stack" — Durable Objects):
//   One DO instance per shipment. Holds the in-progress agent state for that
//   shipment (extracted line items, in-flight classifications, broker review
//   notes). Lets the broker UI poll a single endpoint to see live progress.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "@/types/env";

export class ShipmentSession extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}
