import { Hono } from "hono";
import type { Env } from "@/types/env";

import { ingestRoute } from "./ingest";
import { classifyRoute } from "./classify";
import { auditRoute } from "./audit";
import { brokerReviewRoute } from "./broker-review";
import { webhooksRoute } from "./webhooks";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "customs-agent",
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  }),
);

app.route("/ingest", ingestRoute);
app.route("/classify", classifyRoute);
app.route("/audit", auditRoute);
app.route("/broker", brokerReviewRoute);
app.route("/webhooks", webhooksRoute);

export default {
  fetch: app.fetch,

  // TODO(CLAUDE.md "Queues"): consume CLASSIFICATION_QUEUE batches, fan out to classifier agent.
  async queue(_batch: MessageBatch, _env: Env): Promise<void> {
    throw new Error("not implemented");
  },
} satisfies ExportedHandler<Env>;

// Re-exports required by wrangler.toml bindings.
export { ShipmentSession } from "@/durable-objects/shipment-session";
export { ShipmentLifecycleWorkflow } from "@/workflows/shipment-lifecycle";
