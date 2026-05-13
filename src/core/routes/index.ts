// The Hono app. Pure: takes an AppContext, returns a Hono instance.
// Entry points (cli.ts, future worker.ts) build the context, then serve this app.

import { Hono } from "hono";
import type { AppContext } from "@/core/app-context";
import type { HonoEnv } from "./types";
import { ingestRoute } from "./ingest";
import { classifyRoute } from "./classify";
import { auditRoute } from "./audit";
import { brokerReviewRoute } from "./broker-review";
import { webhooksRoute } from "./webhooks";

export function buildApp(ctx: AppContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "customs-agent",
      environment: c.var.ctx.config.environment,
      timestamp: new Date().toISOString(),
    }),
  );

  app.route("/ingest", ingestRoute);
  app.route("/classify", classifyRoute);
  app.route("/audit", auditRoute);
  app.route("/broker", brokerReviewRoute);
  app.route("/webhooks", webhooksRoute);

  return app;
}
