// TODO(CLAUDE.md §3 "Duty calculator"):
//   The duty calculator is deterministic, but we still validate the rate-table snapshot
//   we load from KV. If the snapshot is malformed we fail loudly rather than silently
//   producing wrong duty numbers (CBP penalty risk).

import { z } from "zod";

export const TariffRateEntry = z.object({
  htsCode: z.string(),
  baseAdValorem: z.number().nonnegative(),
  section301: z.number().nonnegative().nullable(),
  section232: z.number().nonnegative().nullable(),
  reciprocal: z.number().nonnegative().nullable(),
  antidumping: z.number().nonnegative().nullable(),
  countervailing: z.number().nonnegative().nullable(),
  ftaPreferences: z.record(z.string(), z.number()), // keyed by FTA code, e.g. { USMCA: 0 }
});

export const TariffRateTable = z.object({
  version: z.string(),
  effectiveDate: z.string(), // UTC ISO 8601
  entries: z.array(TariffRateEntry),
});

export type TariffRateEntryT = z.infer<typeof TariffRateEntry>;
export type TariffRateTableT = z.infer<typeof TariffRateTable>;
