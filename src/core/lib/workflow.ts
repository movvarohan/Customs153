// Shipment lifecycle workflow — the conveyor.
//
// Turns the per-shipment coordination steps into a pipeline: ingest → ISF →
// entry (7501) → broker review → filed → in transit → arrival/release →
// delivered → liquidation/PSC. The orchestrator auto-fires the deterministic
// drafts (ISF/entry) the moment a milestone comes due and routes them to the
// broker filings queue; the only human steps are the broker approvals.

import type { AppContext } from "@/core/app-context";
import { computeCoordination, type Shipment } from "@/core/lib/coordination";
import { ensureDemoCustomer } from "@/core/lib/sku-memory";
import { listFilings, insertFiling, type Filing } from "@/core/lib/filings";
import { assembleIsf, assembleEntry } from "@/core/agents/coordinator";

export const WORKFLOW_STAGES = [
  { key: "ingest", label: "Ingest & classify" },
  { key: "isf", label: "ISF (10+2)" },
  { key: "entry", label: "Entry (7501)" },
  { key: "in_transit", label: "In transit" },
  { key: "arrival", label: "Arrival & release" },
  { key: "delivered", label: "Delivered" },
  { key: "liquidation", label: "Liquidation / PSC" },
] as const;
export type StageKey = (typeof WORKFLOW_STAGES)[number]["key"];

export type ActionType = "auto_fire" | "approval" | "passive";
export interface WorkflowAction {
  type: ActionType;
  label: string;
  owner: string;
  filing_type?: "isf" | "entry";
}

export interface WorkflowShipment {
  id: string;
  supplier: string;
  product: string;
  route: string;
  eta: string;
  stage_key: StageKey;
  action: WorkflowAction;
  isf_filing: { id: string; status: string } | null;
  entry_filing: { id: string; status: string } | null;
}

export interface WorkflowState {
  stages: typeof WORKFLOW_STAGES;
  stage_counts: Record<string, number>;
  shipments: WorkflowShipment[];
  summary: { auto_fireable: number; awaiting_approval: number; in_motion: number };
  pending_filings: Filing[];
}

// Entry is filed close to arrival, so only auto-fire it inside this window.
const ENTRY_FIRE_WINDOW_DAYS = 7;

function classify(s: Shipment, filings: Filing[]): { stage_key: StageKey; action: WorkflowAction; isf: Filing | undefined; entry: Filing | undefined } {
  const isf = filings.find((f) => f.shipment_ref === s.id && f.type === "isf");
  const entry = filings.find((f) => f.shipment_ref === s.id && f.type === "entry");
  const na = s.next_action;
  const done = (key: string) => s.milestones.find((m) => m.key === key)?.status === "done";

  // Broker approval gates take priority.
  if (isf && isf.status === "pending_review") return { stage_key: "isf", action: { type: "approval", label: "Broker approval — ISF (10+2)", owner: "Customs broker" }, isf, entry };
  if (entry && entry.status === "pending_review") return { stage_key: "entry", action: { type: "approval", label: "Broker approval — Entry (7501)", owner: "Customs broker" }, isf, entry };

  // Auto-fire deterministic drafts when their milestone is due and undrafted.
  if (!isf && na && /ISF/i.test(na.label)) return { stage_key: "isf", action: { type: "auto_fire", filing_type: "isf", label: "Draft & route ISF (10+2)", owner: "Coordinator agent" }, isf, entry };
  if (!entry && na && /entry/i.test(na.label) && na.days_left <= ENTRY_FIRE_WINDOW_DAYS) return { stage_key: "entry", action: { type: "auto_fire", filing_type: "entry", label: "Draft & route CBP 7501 entry", owner: "Coordinator agent" }, isf, entry };

  // Otherwise the shipment is moving physically.
  let stage_key: StageKey;
  if (done("delivered")) stage_key = "delivered";
  else if (done("eta")) stage_key = "arrival";
  else if (done("etd")) stage_key = "in_transit";
  else stage_key = "ingest";
  return { stage_key, action: { type: "passive", label: s.current_stage, owner: na?.party ?? "—" }, isf, entry };
}

export async function buildWorkflow(ctx: AppContext): Promise<WorkflowState> {
  const customerId = await ensureDemoCustomer(ctx);
  const coord = computeCoordination("Atlas Retail Holdings LLC", new Date());
  const filings = await listFilings(ctx, customerId);

  const shipments: WorkflowShipment[] = coord.shipments.map((s) => {
    const { stage_key, action, isf, entry } = classify(s, filings);
    return {
      id: s.id, supplier: s.supplier, product: s.product,
      route: `${s.origin_port} → ${s.dest_port}`, eta: s.eta,
      stage_key, action,
      isf_filing: isf ? { id: isf.id, status: isf.status } : null,
      entry_filing: entry ? { id: entry.id, status: entry.status } : null,
    };
  });

  const stage_counts: Record<string, number> = {};
  for (const st of WORKFLOW_STAGES) stage_counts[st.key] = 0;
  for (const s of shipments) stage_counts[s.stage_key] = (stage_counts[s.stage_key] ?? 0) + 1;

  return {
    stages: WORKFLOW_STAGES,
    stage_counts,
    shipments,
    summary: {
      auto_fireable: shipments.filter((s) => s.action.type === "auto_fire").length,
      awaiting_approval: shipments.filter((s) => s.action.type === "approval").length,
      in_motion: shipments.filter((s) => s.action.type === "passive").length,
    },
    pending_filings: filings.filter((f) => f.status === "pending_review"),
  };
}

export interface FiredItem { shipment_ref: string; type: "isf" | "entry"; title: string; readiness_pct: number }

/** Auto-fire every due draft: assemble + route to the broker filings queue. */
export async function runWorkflow(ctx: AppContext): Promise<{ fired: FiredItem[]; state: WorkflowState }> {
  const customerId = await ensureDemoCustomer(ctx);
  const coord = computeCoordination("Atlas Retail Holdings LLC", new Date());
  const filings = await listFilings(ctx, customerId);

  const fired: FiredItem[] = [];
  for (const s of coord.shipments) {
    const { action } = classify(s, filings);
    if (action.type !== "auto_fire") continue;
    if (action.filing_type === "isf") {
      const isf = await assembleIsf(ctx, s);
      await insertFiling(ctx, { customer_id: customerId, shipment_ref: s.id, type: "isf", title: `ISF 10+2 — ${s.id} (${s.supplier})`, payload: { isf } });
      fired.push({ shipment_ref: s.id, type: "isf", title: `ISF (10+2) — ${s.supplier}`, readiness_pct: isf.readiness_pct });
    } else if (action.filing_type === "entry") {
      const entry = await assembleEntry(ctx, s);
      await insertFiling(ctx, { customer_id: customerId, shipment_ref: s.id, type: "entry", title: `CBP 7501 — ${s.id} (${s.supplier})`, payload: { entry } });
      fired.push({ shipment_ref: s.id, type: "entry", title: `CBP 7501 — ${s.supplier}`, readiness_pct: entry.readiness_pct });
    }
  }
  const state = await buildWorkflow(ctx);
  return { fired, state };
}
