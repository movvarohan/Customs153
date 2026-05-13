// TODO(CLAUDE.md "Stack" — Workflows):
//   Multi-step lifecycle: ingest → extract → classify (parallel via queue) →
//   calc duty → await broker review → file → track liquidation → run PSC scan.
//   Each step is a separate workflow step so we can retry and observe.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "@/types/env";

export interface ShipmentLifecycleParams {
  shipmentId: string;
}

export class ShipmentLifecycleWorkflow extends WorkflowEntrypoint<Env, ShipmentLifecycleParams> {
  override async run(
    _event: WorkflowEvent<ShipmentLifecycleParams>,
    _step: WorkflowStep,
  ): Promise<void> {
    throw new Error("not implemented");
  }
}
