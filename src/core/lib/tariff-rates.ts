// TODO(CLAUDE.md "Out of scope for MVP" — "Real-time tariff rate API"):
//   We maintain a versioned, weekly-refreshed rate table in ctx.cache. This
//   module is the only place that resolves HTS code + country → rate components.
//   Always return the version string so duty calcs are reproducible from audit logs.

import type { AppContext } from "@/core/app-context";
import type { TariffRateEntryT } from "@/core/schemas/duty";

export async function getRateForHts(
  _ctx: AppContext,
  _htsCode: string,
  _countryOfOrigin: string,
): Promise<{ entry: TariffRateEntryT; version: string } | null> {
  throw new Error("not implemented");
}
