import { describe, it, expect } from "vitest";
import { resolveRates } from "@/core/lib/tariff-rates";
import type { TariffRatesTableT } from "@/core/schemas/duty";

const table: TariffRatesTableT = {
  fees: { mpf_rate: 0.003464, mpf_min_usd_cents: 3358, mpf_max_usd_cents: 65150, hmf_rate: 0.00125 },
  section_301_china: { by_chapter: { "85": 0.25, "42": 0.075 } },
  section_232: { by_chapter: { "73": 0.25 } },
  ad_valorem: { "8518.30": 0.049, "8544.42": 0.026 },
  default_ad_valorem: 0.0274,
};

describe("resolveRates", () => {
  it("resolves base ad valorem by 6-digit prefix", () => {
    const r = resolveRates(table, "8518.30.20.00", "CN");
    expect(r.base_ad_valorem).toBe(0.049);
    expect(r.warnings).toHaveLength(0);
  });

  it("falls back to the default rate with a warning when the line is unknown", () => {
    const r = resolveRates(table, "9999.99.99.99", "CN");
    expect(r.base_ad_valorem).toBe(0.0274);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("applies Section 301 only for Chinese origin", () => {
    expect(resolveRates(table, "8518.30.20.00", "CN").section_301_rate).toBe(0.25);
    expect(resolveRates(table, "8518.30.20.00", "VN").section_301_rate).toBeNull();
    // chapter 42 is the lower List-4A rate
    expect(resolveRates(table, "4202.21.60.00", "CN").section_301_rate).toBe(0.075);
  });

  it("applies Section 232 by chapter regardless of country", () => {
    expect(resolveRates(table, "7323.93.00.00", "CN").section_232_rate).toBe(0.25);
    expect(resolveRates(table, "7323.93.00.00", "VN").section_232_rate).toBe(0.25);
    expect(resolveRates(table, "8518.30.20.00", "CN").section_232_rate).toBeNull();
  });
});
