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

/** Try to find an HTS 6-digit for the shipment's product from SKU memory. */
async function htsForProduct(ctx: AppContext, product: string): Promise<string | null> {
  const rows = await listSkuMemory(ctx, "demo-customer", 100);
  const p = product.toLowerCase();
  const tokens = p.split(/[^a-z]+/).filter((t) => t.length > 3);
  let best: { score: number; code: string } | null = null;
  for (const r of rows) {
    const d = r.canonical_description.toLowerCase();
    let score = 0;
    for (const t of tokens) if (d.includes(t)) score++;
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
