import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SqliteDatabase } from "@/adapters/local/sqlite-db";
import type { AppContext } from "@/core/app-context";
import { ensureDemoCustomer, seedSkuMemoryIfEmpty } from "@/core/lib/sku-memory";
import { runTariffSimulation, type SimScenario } from "@/core/lib/tariff-simulator";

// The simulator touches ctx.db (SKU memory) and ctx.cache (tariff table). A
// trivial Map-backed cache + in-memory SQLite covers it — no keys, no network.
async function makeCtx(): Promise<AppContext> {
  const db = await SqliteDatabase.open(":memory:");
  const sql = await fs.readFile(path.resolve("migrations/0001_initial.sql"), "utf8");
  await db.exec(sql);
  const store = new Map<string, unknown>();
  const cache = {
    get: async <T>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
    set: async (k: string, v: unknown) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
  return { db, cache } as unknown as AppContext;
}

const BASE: SimScenario = {
  section_301_rate: null,
  reciprocal_rate: 0,
  section_232_enabled: true,
  reroute_china_to: null,
  unit_cost_premium_pct: 0,
  switching_cost_usd_cents: 0,
  include_entry_fees: true,
};

describe("tariff policy simulator", () => {
  let ctx: AppContext;
  let cust: string;
  beforeEach(async () => {
    ctx = await makeCtx();
    cust = await ensureDemoCustomer(ctx);
    await seedSkuMemoryIfEmpty(ctx, cust);
  });

  it("baseline scenario has zero delta and a self-consistent stack", async () => {
    const r = await runTariffSimulation(ctx, cust, { ...BASE });
    expect(r.delta_usd_cents).toBe(0);
    const s = r.baseline_stack;
    expect(
      s.base_usd_cents + s.section_301_usd_cents + s.section_232_usd_cents +
      s.reciprocal_usd_cents + s.mpf_usd_cents + s.hmf_usd_cents,
    ).toBe(s.total_usd_cents);
    expect(r.reroute.active).toBe(false);
  });

  it("a flat 60% Section 301 raises only the 301 component", async () => {
    const base = await runTariffSimulation(ctx, cust, { ...BASE });
    const hi = await runTariffSimulation(ctx, cust, { ...BASE, section_301_rate: 0.6 });
    expect(hi.scenario_stack.section_301_usd_cents).toBeGreaterThan(base.baseline_stack.section_301_usd_cents);
    // Base ad valorem and fees are untouched by a 301 change.
    expect(hi.scenario_stack.base_usd_cents).toBe(base.baseline_stack.base_usd_cents);
    expect(hi.scenario_stack.mpf_usd_cents).toBe(base.baseline_stack.mpf_usd_cents);
    expect(hi.delta_usd_cents).toBeGreaterThan(0);
  });

  it("a universal reciprocal tariff applies to the full customs value", async () => {
    const r = await runTariffSimulation(ctx, cust, { ...BASE, reciprocal_rate: 0.1 });
    // 10% reciprocal on every SKU's value == 10% of total value, within rounding.
    const expected = Math.round(r.baseline_value_usd_cents * 0.1);
    expect(Math.abs(r.scenario_stack.reciprocal_usd_cents - expected)).toBeLessThanOrEqual(r.rows.length);
    expect(r.baseline_stack.reciprocal_usd_cents).toBe(0);
  });

  it("rerouting out of China zeroes Section 301 and computes reroute economics", async () => {
    const r = await runTariffSimulation(ctx, cust, {
      ...BASE,
      reroute_china_to: "VN",
      unit_cost_premium_pct: 0.04,
      switching_cost_usd_cents: 2_500_000,
    });
    expect(r.scenario_stack.section_301_usd_cents).toBe(0);
    expect(r.baseline_stack.section_301_usd_cents).toBeGreaterThan(0);
    // Goods cost 4% more.
    expect(r.scenario_value_usd_cents).toBe(Math.round(r.baseline_value_usd_cents * 1.04));
    expect(r.reroute.active).toBe(true);
    // Net benefit = duty saved − goods premium; identity must hold exactly.
    expect(r.reroute.net_annual_benefit_usd_cents).toBe(
      -r.reroute.annual_duty_delta_usd_cents - r.reroute.annual_goods_premium_usd_cents,
    );
    // For China FBA goods, dropping 301 outweighs a 4% premium → positive payback.
    expect(r.reroute.net_annual_benefit_usd_cents).toBeGreaterThan(0);
    expect(r.reroute.payback_months).not.toBeNull();
  });

  it("disabling Section 232 never increases duty", async () => {
    const on = await runTariffSimulation(ctx, cust, { ...BASE });
    const off = await runTariffSimulation(ctx, cust, { ...BASE, section_232_enabled: false });
    expect(off.scenario_stack.section_232_usd_cents).toBe(0);
    expect(off.scenario_stack.total_usd_cents).toBeLessThanOrEqual(on.baseline_stack.total_usd_cents);
  });
});
