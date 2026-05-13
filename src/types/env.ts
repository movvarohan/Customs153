/**
 * Cloudflare Worker bindings. Mirrors wrangler.toml.
 * See CLAUDE.md → "Stack" for what each binding is for.
 */

import type { ShipmentSession } from "@/durable-objects/shipment-session";
import type { ShipmentLifecycleWorkflow } from "@/workflows/shipment-lifecycle";

export interface Env {
  // D1 — customers, shipments, line items, classifications, audit log, SKU master
  DB: D1Database;

  // R2 — DOCS holds customer uploads; REFERENCE holds HTS schedule + CROSS rulings cache
  DOCS: R2Bucket;
  REFERENCE: R2Bucket;

  // Vectorize — HTS index + CBP CROSS rulings index
  HTS_INDEX: VectorizeIndex;
  CROSS_INDEX: VectorizeIndex;

  // KV — tariff rates, exchange rates, FTA preference rules
  CACHE: KVNamespace;

  // Queues — fan out classification of N line items in parallel
  CLASSIFICATION_QUEUE: Queue<ClassificationJob>;

  // Durable Objects — per-shipment stateful agent session
  SHIPMENT_SESSION: DurableObjectNamespace<ShipmentSession>;

  // Workflows — multi-step shipment lifecycle
  SHIPMENT_WORKFLOW: Workflow<ShipmentLifecycleWorkflow>;

  // Workers AI — cheap embeddings and small-model OCR only
  AI: Ai;

  // Browser Rendering — scrape CBP CROSS, USTR exclusion pages
  BROWSER: Fetcher;

  // Secrets (via `wrangler secret put`)
  ANTHROPIC_API_KEY: string;
  CBP_CROSS_API_KEY?: string;

  // Vars (from wrangler.toml [vars])
  ENVIRONMENT: "development" | "staging" | "production";
  DEFAULT_MODEL: string;
  CHEAP_MODEL: string;
  HARD_MODEL: string;
}

export interface ClassificationJob {
  shipmentId: string;
  lineItemId: string;
}
