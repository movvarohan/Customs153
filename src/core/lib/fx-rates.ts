// Fixed FX rates for the demo. Production reads these from a versioned
// KV table updated by scripts/seed-tariff-rates.ts (or its FX twin).
//
// Rate convention: USD per unit of foreign currency. E.g. CNY=0.14 means
// 1 CNY = $0.14, so CNY cents * 0.14 = USD cents.

import type { AppContext } from "@/core/app-context";

export const DEMO_FX_USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  CNY: 0.14,
  INR: 0.012,
  EUR: 1.07,
  GBP: 1.27,
  JPY: 0.0066,
  MXN: 0.058,
  CAD: 0.73,
  KRW: 0.00073,
  VND: 0.000041,
};

export async function seedDemoFxRates(ctx: AppContext): Promise<void> {
  for (const [ccy, rate] of Object.entries(DEMO_FX_USD_PER_UNIT)) {
    await ctx.cache.set(`fx:rate:${ccy}`, rate);
  }
}
