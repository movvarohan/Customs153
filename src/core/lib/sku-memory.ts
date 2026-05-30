// Per-customer SKU memory.
//
// When the classifier handles a line item, it can look up the customer's
// prior decisions for the same (or a materially identical) description.
// A broker-confirmed prior decision becomes a strong hint to the
// classifier — surfaced in the user message so the model can see the
// authoritative prior and reasoning. Agent-only priors (not yet broker
// confirmed) are also stored, but down-weighted.
//
// The demo uses a single "demo" customer for now; production will key
// on the importer of record.

import type { AppContext } from "@/core/app-context";
import { seedClassificationTraces } from "./seed-classification-traces";

const DEMO_CUSTOMER_ID = "demo-customer";
const DEMO_CUSTOMER_NAME = "Atlas Retail Holdings LLC";
const DEMO_CUSTOMER_EMAIL = "imports@atlasretail.com";

export type SkuMemorySource = "agent" | "broker";

export interface SkuMemoryRow {
  customer_id: string;
  sku: string;
  canonical_description: string;
  current_hts_code: string;
  /** Convenience: 8-digit prefix of current_hts_code. */
  current_hts_code_8: string;
  /** Distinguishes confirmed-by-broker entries from agent-only predictions. */
  source: SkuMemorySource;
  current_classification_id: string | null;
  last_classified_at: string;
}

/**
 * Idempotently insert a "demo" customer row. The customers schema requires
 * id/name/email/created_at; importer_number is nullable.
 */
export async function ensureDemoCustomer(ctx: AppContext): Promise<string> {
  const row = await ctx.db
    .prepare("SELECT id FROM customers WHERE id = ?")
    .bind(DEMO_CUSTOMER_ID)
    .first<{ id: string }>();
  if (row) return DEMO_CUSTOMER_ID;
  await ctx.db
    .prepare(
      "INSERT INTO customers (id, name, importer_number, email, created_at) VALUES (?, ?, NULL, ?, ?)",
    )
    .bind(DEMO_CUSTOMER_ID, DEMO_CUSTOMER_NAME, DEMO_CUSTOMER_EMAIL, new Date().toISOString())
    .run();
  return DEMO_CUSTOMER_ID;
}

/** A realistic starter catalog so the broker queue is never empty. */
const SEED_ROWS: Array<{ description: string; hts_code: string; source: SkuMemorySource }> = [
  { description: "Wireless Bluetooth over-ear headphones with rechargeable battery and active noise cancellation", hts_code: "8518.30.20.00", source: "broker" },
  { description: "USB-C to USB-C charging cable, 6 ft braided nylon, 100W power delivery", hts_code: "8544.42.90.90", source: "broker" },
  { description: "20W USB-C PD fast wall charger, compact dual-port", hts_code: "8504.40.95.40", source: "broker" },
  { description: "Stainless steel double-wall vacuum-insulated water bottle, 750 ml, leakproof lid", hts_code: "9617.00.10.00", source: "broker" },
  { description: "Silicone phone case for 6.1-inch smartphone, clear, raised camera bezel", hts_code: "3926.90.99.89", source: "agent" },
  { description: "LED desk lamp with adjustable arm, USB-powered, aluminum base", hts_code: "9405.21.60.00", source: "agent" },
  { description: "Polypropylene food storage container set with snap-on lids, 1 liter, microwave safe", hts_code: "3924.10.40.00", source: "agent" },
  { description: "Bamboo end-grain cutting board, 18 x 12 in, food-safe finish", hts_code: "4419.11.00.00", source: "agent" },
];

/**
 * Seed the starter catalog if the customer has no SKU memory yet. Idempotent
 * and safe to call on every request — it only writes when the table is empty
 * for this customer, so a fresh DB (or a wiped .data dir) self-populates.
 */
export async function seedSkuMemoryIfEmpty(ctx: AppContext, customerId: string): Promise<void> {
  const existing = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM sku_master WHERE customer_id = ?")
    .bind(customerId)
    .first<{ n: number }>();
  if (existing && Number(existing.n) > 0) {
    // SKUs already exist — but a fresh DB before this commit will have null
    // classification_id on every seed row. Backfill the hand-crafted traces
    // for any SKU that hasn't been wired up yet (idempotent).
    await seedClassificationTraces(ctx, customerId);
    return;
  }
  for (const r of SEED_ROWS) {
    await upsertSkuMemory(ctx, {
      customer_id: customerId,
      description: r.description,
      hts_code: r.hts_code,
      classification_id: null,
      source: r.source,
    });
  }
  await seedClassificationTraces(ctx, customerId);
}

/**
 * Look up a prior decision for this customer's description. Exact match
 * first (case-insensitive). If sku_master grows a "source" column later we
 * key on broker-confirmed first; for now any matching row counts.
 *
 * To keep the demo schema-compatible with the original sku_master, the
 * SOURCE field is encoded into the sku column as a prefix:
 *   "broker:<hash>"  — broker-confirmed
 *   "agent:<hash>"   — agent-only prediction
 * Looking up broker entries first means the broker correction beats the
 * agent's earlier prediction on the second run.
 */
export async function lookupSkuMemory(
  ctx: AppContext,
  customerId: string,
  description: string,
): Promise<SkuMemoryRow | null> {
  const canon = description.trim().toLowerCase();
  // Broker-confirmed first.
  for (const prefix of ["broker:", "agent:"]) {
    const r = await ctx.db
      .prepare(
        "SELECT customer_id, sku, canonical_description, current_hts_code, current_classification_id, last_classified_at FROM sku_master WHERE customer_id = ? AND lower(canonical_description) = ? AND sku LIKE ? ORDER BY last_classified_at DESC LIMIT 1",
      )
      .bind(customerId, canon, prefix + "%")
      .first<{
        customer_id: string;
        sku: string;
        canonical_description: string;
        current_hts_code: string;
        current_classification_id: string | null;
        last_classified_at: string;
      }>();
    if (r) {
      const code8 = stripDots(r.current_hts_code).slice(0, 8);
      return {
        customer_id: r.customer_id,
        sku: r.sku,
        canonical_description: r.canonical_description,
        current_hts_code: r.current_hts_code,
        current_hts_code_8: formatDotted(code8),
        source: prefix === "broker:" ? "broker" : "agent",
        current_classification_id: r.current_classification_id,
        last_classified_at: r.last_classified_at,
      };
    }
  }
  return null;
}

/**
 * Upsert a (customer_id, description, source) row.
 * sku is "<source>:<base36 hash>" of the canonical description.
 */
export async function upsertSkuMemory(
  ctx: AppContext,
  args: {
    customer_id: string;
    description: string;
    hts_code: string;
    classification_id: string | null;
    source: SkuMemorySource;
  },
): Promise<void> {
  const canon = args.description.trim().toLowerCase();
  const sku = `${args.source}:${hash36(canon)}`;
  const now = new Date().toISOString();
  await ctx.db
    .prepare(
      `INSERT INTO sku_master (customer_id, sku, canonical_description, current_hts_code, current_classification_id, last_classified_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(customer_id, sku) DO UPDATE SET
         canonical_description = excluded.canonical_description,
         current_hts_code = excluded.current_hts_code,
         current_classification_id = excluded.current_classification_id,
         last_classified_at = excluded.last_classified_at`,
    )
    .bind(args.customer_id, sku, args.description.trim(), args.hts_code, args.classification_id, now)
    .run();
}

/** List recent SKU memory rows (for the demo broker-copilot view). */
export async function listSkuMemory(
  ctx: AppContext,
  customerId: string,
  limit = 50,
): Promise<SkuMemoryRow[]> {
  const rows = await ctx.db
    .prepare(
      "SELECT customer_id, sku, canonical_description, current_hts_code, current_classification_id, last_classified_at FROM sku_master WHERE customer_id = ? ORDER BY last_classified_at DESC LIMIT ?",
    )
    .bind(customerId, limit)
    .all<{
      customer_id: string;
      sku: string;
      canonical_description: string;
      current_hts_code: string;
      current_classification_id: string | null;
      last_classified_at: string;
    }>();
  return rows.map((r) => ({
    customer_id: r.customer_id,
    sku: r.sku,
    canonical_description: r.canonical_description,
    current_hts_code: r.current_hts_code,
    current_hts_code_8: formatDotted(stripDots(r.current_hts_code).slice(0, 8)),
    source: r.sku.startsWith("broker:") ? "broker" : "agent",
    current_classification_id: r.current_classification_id,
    last_classified_at: r.last_classified_at,
  }));
}

function stripDots(s: string): string {
  return s.replace(/\D/g, "");
}

function formatDotted(digitsOnly: string): string {
  const d = digitsOnly.padEnd(8, "0").slice(0, 8);
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

function hash36(s: string): string {
  // Tiny non-cryptographic hash; demo-only. Stable across runs (deterministic
  // from the input), so upserts on the same description hit the same row.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
