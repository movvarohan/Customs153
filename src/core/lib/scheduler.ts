// Workflow auto-pilot — a background ticker that runs the pipeline on an
// interval so ISF/entry drafts fire on schedule with no human clicking.
//
// The tick logic and observable state live here (pure-ish: it calls runWorkflow
// and records results in memory). The actual timer is started from the entry
// point via startScheduler — on Cloudflare this becomes a cron trigger /
// Durable Object alarm calling the same runTick.

import type { AppContext } from "@/core/app-context";
import { runWorkflow } from "@/core/lib/workflow";

export interface RunRecord {
  at: string;
  fired: number;
  items: Array<{ shipment_ref: string; type: string }>;
}

interface SchedulerState {
  enabled: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  running: boolean;
  started: boolean;
  history: RunRecord[];
}

const state: SchedulerState = {
  enabled: true,
  intervalMs: 30_000,
  lastRunAt: null,
  running: false,
  started: false,
  history: [],
};

const MAX_HISTORY = 12;

/** One pipeline tick: auto-fire any due drafts and record the outcome. */
export async function runTick(ctx: AppContext): Promise<void> {
  if (!state.enabled || state.running) return;
  state.running = true;
  try {
    const { fired } = await runWorkflow(ctx);
    state.lastRunAt = new Date().toISOString();
    state.history.unshift({
      at: state.lastRunAt,
      fired: fired.length,
      items: fired.map((f) => ({ shipment_ref: f.shipment_ref, type: f.type })),
    });
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
  } catch {
    // Auto-pilot must never crash the process; swallow and try again next tick.
  } finally {
    state.running = false;
  }
}

export interface SchedulerStatus {
  enabled: boolean;
  interval_seconds: number;
  last_run_at: string | null;
  next_run_at: string | null;
  history: RunRecord[];
}

export function getSchedulerStatus(): SchedulerStatus {
  const next = state.enabled && state.lastRunAt
    ? new Date(new Date(state.lastRunAt).getTime() + state.intervalMs).toISOString()
    : state.enabled
      ? new Date(Date.now() + state.intervalMs).toISOString()
      : null;
  return {
    enabled: state.enabled,
    interval_seconds: Math.round(state.intervalMs / 1000),
    last_run_at: state.lastRunAt,
    next_run_at: next,
    history: state.history,
  };
}

export function setSchedulerEnabled(enabled: boolean): SchedulerStatus {
  state.enabled = enabled;
  return getSchedulerStatus();
}

/** Start the background ticker (call once, from the entry point). */
export function startScheduler(ctx: AppContext, opts?: { intervalMs?: number }): void {
  if (state.started) return;
  state.started = true;
  if (opts?.intervalMs) state.intervalMs = opts.intervalMs;
  // A quick first run shortly after boot, then on the interval.
  setTimeout(() => { void runTick(ctx); }, 6_000);
  setInterval(() => { void runTick(ctx); }, state.intervalMs);
}
