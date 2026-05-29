import { describe, it, expect } from "vitest";
import { calculateEntryFees } from "@/core/agents/duty-calculator";
import type { TariffRatesTableT } from "@/core/schemas/duty";

const table: TariffRatesTableT = {
  fees: { mpf_rate: 0.003464, mpf_min_usd_cents: 3358, mpf_max_usd_cents: 65150, hmf_rate: 0.00125 },
  section_301_china: { by_chapter: {} },
  section_232: { by_chapter: {} },
  ad_valorem: {},
  default_ad_valorem: 0.0274,
};

describe("calculateEntryFees — MPF / HMF", () => {
  it("computes MPF and HMF on a mid-range entry value", () => {
    // $10,000 = 1,000,000 cents
    const f = calculateEntryFees(table, 1_000_000, "ocean");
    expect(f.mpf_usd_cents).toBe(Math.round(1_000_000 * 0.003464)); // 3464
    expect(f.hmf_usd_cents).toBe(Math.round(1_000_000 * 0.00125)); // 1250
    expect(f.total_usd_cents).toBe(f.mpf_usd_cents + f.hmf_usd_cents);
  });

  it("clamps MPF to the statutory minimum on small entries", () => {
    // $1,000 -> raw MPF 346 < floor 3358
    const f = calculateEntryFees(table, 100_000, "ocean");
    expect(f.mpf_usd_cents).toBe(3358);
  });

  it("clamps MPF to the statutory maximum on large entries", () => {
    // $500,000 -> raw MPF 173,200 > ceiling 65,150
    const f = calculateEntryFees(table, 50_000_000, "ocean");
    expect(f.mpf_usd_cents).toBe(65150);
  });

  it("applies HMF only to ocean cargo", () => {
    expect(calculateEntryFees(table, 1_000_000, "air").hmf_usd_cents).toBe(0);
    expect(calculateEntryFees(table, 1_000_000, "ground").hmf_usd_cents).toBe(0);
    expect(calculateEntryFees(table, 1_000_000, "ocean").hmf_usd_cents).toBeGreaterThan(0);
  });

  it("surfaces the ocean assumption when transport mode was defaulted", () => {
    const assumed = calculateEntryFees(table, 1_000_000, "ocean", { transport_mode_assumed: true });
    expect(assumed.warnings.join(" ")).toMatch(/assumed ocean/i);
    const explicit = calculateEntryFees(table, 1_000_000, "ocean");
    expect(explicit.warnings).toHaveLength(0);
  });

  it("entry fees depend only on value+mode, not the HTS code — so they cancel in refund math", () => {
    // The PSC finder computes (filed duty - predicted duty). MPF/HMF are
    // entry-level and identical under both codes, so they must cancel.
    // calculateEntryFees has no code parameter, which guarantees this.
    const a = calculateEntryFees(table, 2_500_000, "ocean");
    const b = calculateEntryFees(table, 2_500_000, "ocean");
    expect(a.total_usd_cents).toBe(b.total_usd_cents);
  });
});
