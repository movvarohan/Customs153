// Coordination agent.
//
// Two jobs:
//  1. assembleIsf — deterministically build a draft ISF (10+2) from a shipment,
//     the importer profile, and SKU memory (HTS 6-digit), flagging the elements
//     that genuinely need the supplier/forwarder. No LLM.
//  2. draftOutreach — generate the outbound communication (email + call script +
//     SMS) to the responsible party for a shipment's pending action. The draft
//     is for HUMAN REVIEW — nothing is auto-sent.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppContext } from "@/core/app-context";
import { listSkuMemory } from "@/core/lib/sku-memory";
import { calculateDuty, calculateEntryFees } from "@/core/agents/duty-calculator";
import { loadTariffRates } from "@/core/lib/tariff-rates";
import type { Shipment } from "@/core/lib/coordination";

export const COORDINATOR_PROMPT_VERSION = "v1-2026-05-30";

// The demo importer of record. In production this comes from the customer record.
const IMPORTER = {
  name: "Atlas Retail Holdings LLC",
  ior_number: "27-1844501-00",
  address: "4400 Logistics Pkwy, Ontario, CA 91761",
  consignee_number: "27-1844501-00",
  ship_to: "Amazon FBA — ONT8, 24208 San Michele Rd, Moreno Valley, CA 92551",
};

function countryFromPort(port: string): { iso2: string; name: string } {
  const m = port.match(/,\s*([A-Z]{2})\s*$/);
  const iso2 = m?.[1] ?? "";
  const names: Record<string, string> = { CN: "China", VN: "Vietnam", IN: "India", MX: "Mexico", TH: "Thailand", MY: "Malaysia", ID: "Indonesia" };
  return { iso2, name: names[iso2] ?? iso2 };
}

export type IsfStatus = "filled" | "assumed" | "needs_supplier" | "to_confirm";
export interface IsfElement {
  n: number;
  label: string;
  value: string;
  status: IsfStatus;
}
export interface IsfDraft {
  shipment_ref: string;
  elements: IsfElement[];
  carrier_elements: string[];
  missing: string[];
  readiness_pct: number;
}

/** Loose token match tolerant of plurals/verb forms (cables↔cable, chargers↔charger). */
function matchScore(product: string, description: string): number {
  const d = description.toLowerCase();
  const tokens = product.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
  let score = 0;
  for (const t of tokens) {
    const stem = t.slice(0, Math.max(4, t.length - 1)); // drop trailing char for plurals
    if (d.includes(t) || d.includes(stem)) score++;
  }
  return score;
}

/** Try to find an HTS 6-digit for the shipment's product from SKU memory. */
async function htsForProduct(ctx: AppContext, product: string): Promise<string | null> {
  const rows = await listSkuMemory(ctx, "demo-customer", 100);
  let best: { score: number; code: string } | null = null;
  for (const r of rows) {
    const score = matchScore(product, r.canonical_description);
    if (score > 0 && (!best || score > best.score)) {
      best = { score, code: r.current_hts_code_8.replace(/\D/g, "").slice(0, 6) };
    }
  }
  return best ? `${best.code.slice(0, 4)}.${best.code.slice(4, 6)}` : null;
}

export async function assembleIsf(ctx: AppContext, shipment: Shipment): Promise<IsfDraft> {
  const origin = countryFromPort(shipment.origin_port);
  const hts6 = await htsForProduct(ctx, shipment.product);

  const elements: IsfElement[] = [
    { n: 1, label: "Seller", value: `${shipment.supplier}`, status: "filled" },
    { n: 2, label: "Buyer", value: IMPORTER.name, status: "filled" },
    { n: 3, label: "Importer of record number", value: IMPORTER.ior_number, status: "filled" },
    { n: 4, label: "Consignee number(s)", value: IMPORTER.consignee_number, status: "filled" },
    { n: 5, label: "Manufacturer / supplier", value: `${shipment.supplier} — confirm production address`, status: "to_confirm" },
    { n: 6, label: "Ship-to party", value: IMPORTER.ship_to, status: "assumed" },
    { n: 7, label: "Country of origin", value: origin.name || "—", status: origin.iso2 ? "filled" : "to_confirm" },
    { n: 8, label: "HTSUS number (6-digit)", value: hts6 ?? "—", status: hts6 ? "filled" : "to_confirm" },
    { n: 9, label: "Container stuffing location", value: "—", status: "needs_supplier" },
    { n: 10, label: "Consolidator (stuffer)", value: "—", status: "needs_supplier" },
  ];
  const missing = elements.filter((e) => e.status === "needs_supplier" || e.status === "to_confirm").map((e) => e.label);
  const filled = elements.filter((e) => e.status === "filled").length;
  return {
    shipment_ref: shipment.id,
    elements,
    carrier_elements: ["Vessel stow plan (carrier-filed)", "Container status messages (carrier-filed)"],
    missing,
    readiness_pct: Math.round((filled / elements.length) * 100),
  };
}

/** Best-match full 10-digit HTS for a product from SKU memory. */
async function hts10ForProduct(ctx: AppContext, product: string): Promise<string | null> {
  const rows = await listSkuMemory(ctx, "demo-customer", 100);
  let best: { score: number; code: string } | null = null;
  for (const r of rows) {
    const score = matchScore(product, r.canonical_description);
    if (score > 0 && (!best || score > best.score)) best = { score, code: r.current_hts_code };
  }
  return best ? best.code : null;
}

/** Deterministic representative entered value for a shipment ($40k–$220k). */
function enteredValueCents(s: Shipment): number {
  let h = 0;
  const key = s.id + s.product;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return (40_000 + (Math.abs(h) % 181) * 1000) * 100;
}

export interface EntryLine {
  description: string;
  hts_code: string;
  country_of_origin: string;
  value_usd_cents: number;
  base_duty_usd_cents: number;
  section_301_usd_cents: number;
  section_232_usd_cents: number;
  line_duty_usd_cents: number;
  hts_status: "filled" | "to_confirm";
}
export interface EntryDraft {
  shipment_ref: string;
  entry_type: string;
  port_of_entry: string;
  importer_of_record: string;
  ior_number: string;
  consignee_number: string;
  country_of_origin: string;
  lines: EntryLine[];
  mpf_usd_cents: number;
  hmf_usd_cents: number;
  total_entered_value_usd_cents: number;
  total_duty_usd_cents: number;
  missing: string[];
  readiness_pct: number;
}

/** Assemble a draft CBP 7501 entry summary deterministically from a shipment. */
export async function assembleEntry(ctx: AppContext, shipment: Shipment): Promise<EntryDraft> {
  const origin = countryFromPort(shipment.origin_port);
  const table = await loadTariffRates(ctx);
  const value = enteredValueCents(shipment);
  const hts10 = await hts10ForProduct(ctx, shipment.product);
  const htsForCalc = hts10 ?? "9999.99.99.99";

  const duty = await calculateDuty(ctx, {
    hts_code: htsForCalc,
    country_of_origin: origin.iso2 || "CN",
    customs_value_usd_cents: value,
    transport_mode: "ocean",
    include_entry_fees: false,
  });
  const line: EntryLine = {
    description: shipment.product,
    hts_code: hts10 ?? "— (classify before filing)",
    country_of_origin: origin.name || "—",
    value_usd_cents: value,
    base_duty_usd_cents: duty.base_duty_usd_cents,
    section_301_usd_cents: duty.section_301_duty_usd_cents,
    section_232_usd_cents: duty.section_232_duty_usd_cents,
    line_duty_usd_cents: duty.base_duty_usd_cents + duty.section_301_duty_usd_cents + duty.section_232_duty_usd_cents,
    hts_status: hts10 ? "filled" : "to_confirm",
  };

  const fees = calculateEntryFees(table, value, "ocean");
  const totalDuty = line.line_duty_usd_cents + fees.mpf_usd_cents + fees.hmf_usd_cents;

  const missing: string[] = ["Commercial invoice", "Packing list"];
  if (!hts10) missing.unshift("HTS classification (no SKU-memory match)");
  if (!origin.iso2) missing.push("Country of origin");
  // Filled: IOR, consignee, port, entry type, country, HTS (if matched), value.
  const filledCore = 5 + (hts10 ? 1 : 0) + (origin.iso2 ? 1 : 0);
  const readiness_pct = Math.round((filledCore / 7) * 100);

  return {
    shipment_ref: shipment.id,
    entry_type: "01 — Consumption",
    port_of_entry: shipment.dest_port,
    importer_of_record: IMPORTER.name,
    ior_number: IMPORTER.ior_number,
    consignee_number: IMPORTER.consignee_number,
    country_of_origin: origin.name || "—",
    lines: [line],
    mpf_usd_cents: fees.mpf_usd_cents,
    hmf_usd_cents: fees.hmf_usd_cents,
    total_entered_value_usd_cents: value,
    total_duty_usd_cents: totalDuty,
    missing,
    readiness_pct,
  };
}

// ── Outreach drafting (LLM) ──────────────────────────────────────────────
const OutreachOutput = z.object({
  recommended_channel: z.enum(["email", "call", "sms"]),
  urgency: z.enum(["high", "normal"]),
  email: z.object({ to_party: z.string(), subject: z.string().min(4), body: z.string().min(30) }),
  call_script: z.string().min(20),
  sms: z.string().min(10),
  summary: z.string().min(10),
});
export type OutreachOutputT = z.infer<typeof OutreachOutput>;

const TOOL = "draft_outreach";
const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    recommended_channel: { type: "string", enum: ["email", "call", "sms"], description: "Best channel given the urgency" },
    urgency: { type: "string", enum: ["high", "normal"] },
    email: {
      type: "object",
      properties: { to_party: { type: "string" }, subject: { type: "string" }, body: { type: "string", description: "Concise professional email. Use [Name]/[Company] placeholders. Plain text." } },
      required: ["to_party", "subject", "body"],
    },
    call_script: { type: "string", description: "A short phone-call script (what to say, what to confirm)" },
    sms: { type: "string", description: "A one-line SMS/WhatsApp version" },
    summary: { type: "string", description: "One sentence: who to contact and why" },
  },
  required: ["recommended_channel", "urgency", "email", "call_script", "sms", "summary"],
};

const SYSTEM = `You are a logistics coordinator for a US importer's customs operations. Draft outbound communication to the named party to move a shipment's pending action forward. Produce an email, a short phone-call script, and an SMS — the human coordinator reviews and sends; nothing is auto-sent. Be specific to the action and party, concise and professional. Use [placeholders] for contacts/figures you don't have. Plain text only — no markdown or asterisks. Call ${TOOL}.`;

export interface OutreachInput {
  shipment: Shipment;
  party: string;
  action: string;
  purpose: string;
}

export async function draftOutreach(ctx: AppContext, input: OutreachInput): Promise<OutreachOutputT> {
  const s = input.shipment;
  const user = `Shipment ${s.id}: ${s.product} from ${s.supplier}.
Route: ${s.origin_port} → ${s.dest_port} via ${s.carrier} ${s.vessel}. ETD ${s.etd}, ETA ${s.eta}. Container ${s.container}. Last free day ${s.last_free_day}.
Contact party: ${input.party}
Pending action: ${input.action}
Purpose of this outreach: ${input.purpose}

Draft the email, call script, and SMS to ${input.party}. Call ${TOOL}.`;

  const resp = await ctx.anthropic.messages.create({
    model: ctx.config.defaultModel,
    max_tokens: 1500,
    system: SYSTEM,
    tools: [{ name: TOOL, description: "Draft the outreach", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL },
    messages: [{ role: "user", content: user }],
  });
  const tu = resp.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
  if (!tu) throw new Error("coordinator: no tool_use");
  const parsed = OutreachOutput.safeParse(tu.input);
  if (!parsed.success) throw new Error(`coordinator: validation failed: ${parsed.error.message}`);
  return parsed.data;
}
