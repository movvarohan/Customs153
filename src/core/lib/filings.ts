// Filings store — drafts routed to the broker for review (e.g. an ISF 10+2
// assembled from a shipment). Closes the loop between the coordination view and
// the broker queue. The table is created lazily so no migration runner is
// needed; on Cloudflare this becomes a D1 migration with the same shape.

import type { AppContext } from "@/core/app-context";

export type FilingStatus = "pending_review" | "approved";

export interface Filing {
  id: string;
  customer_id: string;
  shipment_ref: string;
  type: string; // "isf"
  status: FilingStatus;
  title: string;
  payload: unknown;
  created_at: string;
  reviewed_at: string | null;
}

let ensured = false;
async function ensureTable(ctx: AppContext): Promise<void> {
  if (ensured) return;
  await ctx.db.exec(
    `CREATE TABLE IF NOT EXISTS filings (
       id TEXT PRIMARY KEY,
       customer_id TEXT NOT NULL,
       shipment_ref TEXT NOT NULL,
       type TEXT NOT NULL,
       status TEXT NOT NULL,
       title TEXT NOT NULL,
       payload TEXT NOT NULL,
       created_at TEXT NOT NULL,
       reviewed_at TEXT
     )`,
  );
  ensured = true;
}

export async function insertFiling(
  ctx: AppContext,
  args: { customer_id: string; shipment_ref: string; type: string; title: string; payload: unknown },
): Promise<Filing> {
  await ensureTable(ctx);
  const id = `FIL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created_at = new Date().toISOString();
  await ctx.db
    .prepare(
      "INSERT INTO filings (id, customer_id, shipment_ref, type, status, title, payload, created_at, reviewed_at) VALUES (?, ?, ?, ?, 'pending_review', ?, ?, ?, NULL)",
    )
    .bind(id, args.customer_id, args.shipment_ref, args.type, args.title, JSON.stringify(args.payload), created_at)
    .run();
  return { id, customer_id: args.customer_id, shipment_ref: args.shipment_ref, type: args.type, status: "pending_review", title: args.title, payload: args.payload, created_at, reviewed_at: null };
}

export async function listFilings(ctx: AppContext, customerId: string): Promise<Filing[]> {
  await ensureTable(ctx);
  const rows = await ctx.db
    .prepare("SELECT id, customer_id, shipment_ref, type, status, title, payload, created_at, reviewed_at FROM filings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(customerId)
    .all<{ id: string; customer_id: string; shipment_ref: string; type: string; status: FilingStatus; title: string; payload: string; created_at: string; reviewed_at: string | null }>();
  return rows.map((r) => ({ ...r, payload: safeParse(r.payload) }));
}

export async function approveFiling(ctx: AppContext, id: string): Promise<boolean> {
  await ensureTable(ctx);
  const r = await ctx.db
    .prepare("UPDATE filings SET status = 'approved', reviewed_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
  return r.rowsAffected > 0;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
