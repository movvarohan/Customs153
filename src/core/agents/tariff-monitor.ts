// TODO(CLAUDE.md §8 "Proactive tariff monitoring"):
//   Cron-triggered. Pulls Federal Register, CBP CSMS, USTR exclusion publications,
//   FMC notices via ctx.browser. For each change, fan out across customer SKU
//   masters to find affected SKUs, then draft customer outreach.

import type { AppContext } from "@/core/app-context";

export async function pollTariffSources(_ctx: AppContext): Promise<void> {
  throw new Error("not implemented");
}

export async function notifyAffectedCustomers(_ctx: AppContext, _changeId: string): Promise<void> {
  throw new Error("not implemented");
}
