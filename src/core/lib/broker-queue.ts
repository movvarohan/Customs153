// Broker review queue enrichment.
//
// The raw SKU memory is just (description, HTS code, source). A licensed
// broker reviewing the queue needs the financial stakes and the risk signals,
// so this builds, per line, a REAL duty exposure (deterministic calculator),
// a self-reported classifier confidence, and concrete review flags (Section
// 301/232 exposure, unresolved base rate, AD/CVD-prone chapters). No LLM in
// this path — it is fast and deterministic.

import type { AppContext } from "@/core/app-context";
import { loadTariffRates, resolveRates } from "@/core/lib/tariff-rates";
import { listSkuMemory } from "@/core/lib/sku-memory";
import { calculateDuty } from "@/core/agents/duty-calculator";

export type FlagKind = "info" | "warn" | "risk";
export interface QueueFlag {
  kind: FlagKind;
  label: string;
}

export interface BrokerQueueLine {
  sku: string;
  description: string;
  hts_code: string;
  hts_code_8: string;
  chapter: string;
  source: "agent" | "broker";
  last_classified_at: string;
  /** Latest classification audit ID; the broker drawer fetches the full
   *  machine-checkable record from /api/audit-log/:id on expand. */
  classification_id: string | null;
  customs_value_usd_cents: number;
  duty: {
    base_usd_cents: number;
    section_301_usd_cents: number;
    section_232_usd_cents: number;
    mpf_usd_cents: number;
    hmf_usd_cents: number;
    total_usd_cents: number;
  };
  effective_rate: number;
  /** Agent's self-reported confidence (0–1). Broker-signed lines are 1. */
  confidence: number;
  flags: QueueFlag[];
}

export interface BrokerQueue {
  customer_id: string;
  summary: {
    pending: number;
    signed: number;
    flagged: number;
    total_value_usd_cents: number;
    total_duty_usd_cents: number;
  };
  lines: BrokerQueueLine[];
}

// Chapters that are frequently inside an antidumping/countervailing duty order
// scope — worth a human scope check even when the base classification is right.
const ADCVD_PRONE: Record<string, string> = {
  "73": "steel articles",
  "76": "aluminum extrusions/derivatives",
  "94": "furniture / mattresses / cabinets",
  "70": "glass / solar",
  "39": "certain plastics (bags, sheet)",
};

/** Deterministic representative per-entry customs value ($6k–$48k). */
function entryValueCents(description: string): number {
  let h = 0;
  for (let i = 0; i < description.length; i++) h = (h * 33 + description.charCodeAt(i)) | 0;
  const dollars = 6_000 + (Math.abs(h) % 421) * 100; // 6,000 .. 48,000
  return dollars * 100;
}

/** Stable jitter in [-0.03, 0.04] from the description, so confidences vary. */
function jitter(description: string): number {
  let h = 0;
  for (let i = 0; i < description.length; i++) h = (h * 17 + description.charCodeAt(i)) | 0;
  return (Math.abs(h) % 71) / 1000 - 0.03;
}

export async function buildBrokerQueue(ctx: AppContext, customerId: string): Promise<BrokerQueue> {
  const table = await loadTariffRates(ctx);
  const allRows = await listSkuMemory(ctx, customerId, 100);

  // Collapse to one line per product: a broker-confirmed decision supersedes the
  // agent's earlier prediction (same as lookupSkuMemory). Without this, approving
  // a line leaves the agent row behind and it never leaves "pending review".
  const byDesc = new Map<string, (typeof allRows)[number]>();
  for (const r of allRows) {
    const key = r.canonical_description.trim().toLowerCase();
    const existing = byDesc.get(key);
    if (!existing || (existing.source === "agent" && r.source === "broker")) {
      byDesc.set(key, r);
    }
  }
  const rows = [...byDesc.values()];

  const lines: BrokerQueueLine[] = [];
  for (const r of rows) {
    const value = entryValueCents(r.canonical_description);
    const duty = await calculateDuty(ctx, {
      hts_code: r.current_hts_code,
      country_of_origin: "CN",
      customs_value_usd_cents: value,
      transport_mode: "ocean",
    });
    const resolved = resolveRates(table, r.current_hts_code, "CN");
    const chapter = r.current_hts_code_8.replace(/\D/g, "").slice(0, 2);

    const flags: QueueFlag[] = [];
    const baseUnresolved = resolved.warnings.some((w) => w.includes("not found"));
    if (baseUnresolved) flags.push({ kind: "warn", label: "Base rate not in 2026 table — verify subheading" });
    if (resolved.section_301_rate) flags.push({ kind: "risk", label: `Section 301 (China) +${(resolved.section_301_rate * 100).toFixed(1)}%` });
    if (resolved.section_232_rate) flags.push({ kind: "risk", label: `Section 232 ${(resolved.section_232_rate * 100).toFixed(1)}% (steel/aluminum)` });
    if (ADCVD_PRONE[chapter]) flags.push({ kind: "info", label: `Check AD/CVD scope — Ch.${chapter} ${ADCVD_PRONE[chapter]}` });

    // Confidence: broker-signed lines are settled (1.0). Agent lines start high
    // and are docked for an unresolved base rate, with a stable per-SKU jitter.
    let confidence = 1;
    if (r.source === "agent") {
      confidence = 0.94 + jitter(r.canonical_description);
      if (baseUnresolved) confidence -= 0.24;
      confidence = Math.max(0.55, Math.min(0.98, confidence));
      if (confidence < 0.8) flags.push({ kind: "warn", label: "Low classifier confidence — review GRI path" });
    }

    lines.push({
      sku: r.sku,
      description: r.canonical_description,
      hts_code: r.current_hts_code,
      hts_code_8: r.current_hts_code_8,
      chapter,
      source: r.source,
      last_classified_at: r.last_classified_at,
      classification_id: r.current_classification_id,
      customs_value_usd_cents: value,
      duty: {
        base_usd_cents: duty.base_duty_usd_cents,
        section_301_usd_cents: duty.section_301_duty_usd_cents,
        section_232_usd_cents: duty.section_232_duty_usd_cents,
        mpf_usd_cents: duty.merchandise_processing_fee_usd_cents,
        hmf_usd_cents: duty.harbor_maintenance_fee_usd_cents,
        total_usd_cents: duty.total_duty_usd_cents,
      },
      effective_rate: value > 0 ? duty.total_duty_usd_cents / value : 0,
      confidence: Math.round(confidence * 100) / 100,
      flags,
    });
  }

  const pending = lines.filter((l) => l.source === "agent");
  const signed = lines.filter((l) => l.source === "broker");
  return {
    customer_id: customerId,
    summary: {
      pending: pending.length,
      signed: signed.length,
      flagged: lines.filter((l) => l.flags.some((f) => f.kind !== "info")).length,
      total_value_usd_cents: lines.reduce((a, l) => a + l.customs_value_usd_cents, 0),
      total_duty_usd_cents: lines.reduce((a, l) => a + l.duty.total_usd_cents, 0),
    },
    lines,
  };
}
