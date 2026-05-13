// TODO(CLAUDE.md §5 "Licensed broker review interface"):
//   Backend for the broker queue UI. Lists pending entries, shows the agent's
//   reasoning trace per line item, supports approve / correct. Corrections feed
//   back into the per-customer SKU master (§9).

import { Hono } from "hono";
import type { Env } from "@/types/env";

export const brokerReviewRoute = new Hono<{ Bindings: Env }>();

brokerReviewRoute.get("/queue", (c) => c.json({ error: "not implemented" }, 501));
brokerReviewRoute.get("/entry/:shipmentId", (c) => c.json({ error: "not implemented" }, 501));
brokerReviewRoute.post("/entry/:shipmentId/approve", (c) => c.json({ error: "not implemented" }, 501));
brokerReviewRoute.post("/entry/:shipmentId/correct", (c) => c.json({ error: "not implemented" }, 501));
