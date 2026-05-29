// Seed the broker queue with a realistic mix of per-importer SKU memory
// so the /broker surface is populated out of the box.
//
//   npm run seed:broker
//
// Idempotent: re-running upserts the same rows by description hash.

import { buildLocalContext } from "@/adapters/local";
import { ensureDemoCustomer, upsertSkuMemory } from "@/core/lib/sku-memory";

interface SeedRow {
  description: string;
  hts_code: string;
  source: "agent" | "broker";
}

// A working Amazon-FBA importer's recent catalog. Some lines are still
// pending broker review (source=agent); some have already been signed off
// (source=broker) and now act as priors on the next shipment.
const ROWS: SeedRow[] = [
  { description: "Wireless Bluetooth over-ear headphones with rechargeable battery and active noise cancellation", hts_code: "8518.30.20.00", source: "broker" },
  { description: "USB-C to USB-C charging cable, 6 ft braided nylon, 100W power delivery", hts_code: "8544.42.90.90", source: "broker" },
  { description: "20W USB-C PD fast wall charger, compact dual-port", hts_code: "8504.40.95.40", source: "broker" },
  { description: "Stainless steel double-wall vacuum-insulated water bottle, 750 ml, leakproof lid", hts_code: "9617.00.10.00", source: "broker" },
  { description: "Silicone phone case for 6.1-inch smartphone, clear, raised camera bezel", hts_code: "3926.90.99.89", source: "agent" },
  { description: "LED desk lamp with adjustable arm, USB-powered, aluminum base", hts_code: "9405.21.60.00", source: "agent" },
  { description: "Polypropylene food storage container set with snap-on lids, 1 liter, microwave safe", hts_code: "3924.10.40.00", source: "agent" },
  { description: "Bamboo end-grain cutting board, 18 x 12 in, food-safe finish", hts_code: "4419.11.00.00", source: "agent" },
];

async function main(): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "seed-only-no-llm";
  const voyageKey = process.env.VOYAGE_API_KEY ?? "seed-only-no-llm";
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

  const customerId = await ensureDemoCustomer(ctx);
  for (const r of ROWS) {
    await upsertSkuMemory(ctx, {
      customer_id: customerId,
      description: r.description,
      hts_code: r.hts_code,
      classification_id: null,
      source: r.source,
    });
  }
  console.log(`seeded ${ROWS.length} SKU memory rows for ${customerId}`);
  await ctx.db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
