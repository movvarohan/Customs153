// Local dev entry point. `tsx src/entry/cli.ts` or `npm run dev`.
// Wires the local adapter set into an AppContext and serves the Hono app
// over @hono/node-server. The future src/entry/worker.ts will do the same
// with Cloudflare adapters — the routes themselves do not change.

import { serve } from "@hono/node-server";
import { buildLocalContext } from "@/adapters/local";
import { buildApp } from "@/core/routes";
import { startScheduler } from "@/core/lib/scheduler";

async function main(): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY is required. Copy .env.example to .env and set it.");
    process.exit(1);
  }
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) {
    console.error("VOYAGE_API_KEY is required for HTS retrieval. See README \"Data setup\".");
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 8787);

  const ctx = await buildLocalContext({
    dataDir: process.env.DATA_DIR ?? ".data",
    anthropicApiKey: anthropicKey,
    voyageApiKey: voyageKey,
    config: {
      environment: "development",
      defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
      cheapModel: process.env.CHEAP_MODEL ?? "claude-haiku-4-5-20251001",
      hardModel: process.env.HARD_MODEL ?? "claude-opus-4-7",
    },
  });

  const app = buildApp(ctx);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`customs-agent listening on http://localhost:${info.port}`);
    console.log(`  GET  /health`);
  });

  // Workflow auto-pilot: fire due ISF/entry drafts on an interval.
  const schedulerMs = Number(process.env.WORKFLOW_INTERVAL_MS ?? 30_000);
  startScheduler(ctx, { intervalMs: schedulerMs });
  console.log(`  workflow auto-pilot every ${Math.round(schedulerMs / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
