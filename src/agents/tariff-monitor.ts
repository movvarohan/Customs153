// TODO(CLAUDE.md §8 "Proactive tariff monitoring"):
//   Cron-triggered. Pulls Federal Register, CBP CSMS, USTR exclusion publications,
//   FMC notices via Browser Rendering. For each change, fan out across customer
//   SKU masters to find affected SKUs, then draft customer outreach.

import type { Env } from "@/types/env";

export async function pollTariffSources(_env: Env): Promise<void> {
  throw new Error("not implemented");
}

export async function notifyAffectedCustomers(_env: Env, _changeId: string): Promise<void> {
  throw new Error("not implemented");
}
