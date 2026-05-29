import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SqliteDatabase } from "@/adapters/local/sqlite-db";
import type { AppContext } from "@/core/app-context";
import {
  ensureDemoCustomer,
  upsertSkuMemory,
  lookupSkuMemory,
  listSkuMemory,
  seedSkuMemoryIfEmpty,
} from "@/core/lib/sku-memory";

// sku-memory only touches ctx.db, so an in-memory SQLite DB with the schema
// applied is enough for a full integration test — no API keys, no network.
async function makeCtx(): Promise<AppContext> {
  const db = await SqliteDatabase.open(":memory:");
  const sql = await fs.readFile(path.resolve("migrations/0001_initial.sql"), "utf8");
  await db.exec(sql);
  return { db } as unknown as AppContext;
}

describe("SKU memory", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await makeCtx();
  });

  it("ensureDemoCustomer is idempotent", async () => {
    const a = await ensureDemoCustomer(ctx);
    const b = await ensureDemoCustomer(ctx);
    expect(a).toBe(b);
  });

  it("seeds a starter catalog only when empty", async () => {
    const cust = await ensureDemoCustomer(ctx);
    await seedSkuMemoryIfEmpty(ctx, cust);
    const first = await listSkuMemory(ctx, cust);
    expect(first.length).toBeGreaterThanOrEqual(8);
    await seedSkuMemoryIfEmpty(ctx, cust); // no-op the second time
    const second = await listSkuMemory(ctx, cust);
    expect(second.length).toBe(first.length);
  });

  it("a broker-confirmed decision beats an earlier agent prediction on lookup", async () => {
    const cust = await ensureDemoCustomer(ctx);
    const desc = "Wireless mouse, 2.4GHz USB receiver";
    await upsertSkuMemory(ctx, { customer_id: cust, description: desc, hts_code: "9017.20.80.40", classification_id: null, source: "agent" });
    const agentHit = await lookupSkuMemory(ctx, cust, desc);
    expect(agentHit?.source).toBe("agent");

    await upsertSkuMemory(ctx, { customer_id: cust, description: desc, hts_code: "8471.60.20.00", classification_id: null, source: "broker" });
    const brokerHit = await lookupSkuMemory(ctx, cust, desc);
    expect(brokerHit?.source).toBe("broker");
    expect(brokerHit?.current_hts_code).toBe("8471.60.20.00");
    expect(brokerHit?.current_hts_code_8).toBe("8471.60.20");
  });

  it("returns null for an unseen description", async () => {
    const cust = await ensureDemoCustomer(ctx);
    expect(await lookupSkuMemory(ctx, cust, "something never classified")).toBeNull();
  });
});
