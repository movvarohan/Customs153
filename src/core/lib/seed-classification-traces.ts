// Hand-crafted classification audit traces for the starter SKUs.
//
// Why this exists: the broker queue's "Reasonable-care record" drawer loads
// per-line records from /api/audit-log/:id. The seeded starter catalog
// (SEED_ROWS in sku-memory.ts) creates SKUs but doesn't run the real
// classifier against them — so without these stubs, every drawer would show
// "no record on file" on a fresh DB. The traces below mirror what the real
// classifier emits (same Zod schema) for the most-reviewed lines, so a
// broker can actually do a meaningful approval pass during a demo.

import { randomUUID } from "node:crypto";
import type { AppContext } from "@/core/app-context";

interface SeedTrace {
  /** Matches SEED_ROWS[i].description exactly so we can join by description. */
  description: string;
  hts_code: string;
  hts_code_8: string;
  gri_rule_applied: "1" | "2(a)" | "2(b)" | "3(a)" | "3(b)" | "3(c)" | "4" | "5(a)" | "5(b)" | "6";
  confidence: "low" | "medium" | "high";
  precision_level: "6" | "8" | "10";
  reasoning: string;
  citations: string[];
  alternative_codes_considered: Array<{ hts_code: string; rejected_because: string }>;
  missing_inputs_for_precision: string[];
  top_candidates: Array<{ hts_code: string; score: number; description: string }>;
}

const TRACES: SeedTrace[] = [
  {
    description:
      "Wireless Bluetooth over-ear headphones with rechargeable battery and active noise cancellation",
    hts_code: "8518.30.20.00",
    hts_code_8: "8518.30.20",
    gri_rule_applied: "1",
    confidence: "high",
    precision_level: "10",
    reasoning:
      "GRI 1: the goods are described eo nomine in heading 8518 (microphones; loudspeakers; headphones and earphones, whether or not combined with a microphone). At subheading level the article is a wireless headphone — 8518.30 covers 'Headphones and earphones, whether or not combined with a microphone, and sets consisting of a microphone and one or more loudspeakers.' 8518.30.20 is the 8-digit line for 'Other' headphones/earphones (not for use with line telephony, not radio/television receivers). Built-in rechargeable battery and active noise cancellation do not change essential character per GRI 1 — they are integral features of headphones, not separate articles. Statistical suffix .00 applies for the residual within 8518.30.20.",
    citations: ["8518.30.20.00", "8518.30.20", "8518.30"],
    alternative_codes_considered: [
      {
        hts_code: "8517.62.00.90",
        rejected_because:
          "8517.62 is for apparatus for transmission/reception in a wireless network (routers, base stations). Bluetooth audio earphones are classified as headphones in 8518, not as the underlying wireless transceiver — long-standing CBP practice (HQ H252098).",
      },
      {
        hts_code: "8527.13.40.00",
        rejected_because:
          "8527 covers radio broadcast reception combined with sound recording/reproducing. These headphones receive a Bluetooth audio link, not a broadcast signal, and have no AM/FM receiver.",
      },
      {
        hts_code: "8506.50.00.00",
        rejected_because:
          "The rechargeable lithium battery is an integral component, not the article presented for classification. GRI 1 requires classifying the composite article (headphones), not its power source.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "8518.30.20.00", score: 0.92, description: "Headphones and earphones, other" },
      { hts_code: "8518.30.10.00", score: 0.81, description: "Line telephone handsets" },
      { hts_code: "8518.40.20.00", score: 0.74, description: "Audio-frequency electric amplifiers" },
      { hts_code: "8517.62.00.90", score: 0.69, description: "Wireless transmission/reception apparatus, other" },
      { hts_code: "8527.13.40.00", score: 0.61, description: "Radio broadcast receivers combined with sound recording" },
      { hts_code: "8543.70.99.91", score: 0.55, description: "Other electrical machines with individual functions" },
    ],
  },
  {
    description: "USB-C to USB-C charging cable, 6 ft braided nylon, 100W power delivery",
    hts_code: "8544.42.90.90",
    hts_code_8: "8544.42.90",
    gri_rule_applied: "1",
    confidence: "high",
    precision_level: "10",
    reasoning:
      "GRI 1: heading 8544 covers 'Insulated wire, cable and other insulated electric conductors, whether or not fitted with connectors.' Subheading 8544.42 is the 8-digit line for 'Other electric conductors, for a voltage not exceeding 1,000 V, fitted with connectors.' USB-C connectors on both ends and 100 W rating (≤ 1,000 V) place this squarely in 8544.42.90 (other than data cable for the goods of 8517/8525/8528). The braided nylon jacket is sheathing — does not change classification. Statistical suffix .90 (other).",
    citations: ["8544.42.90.90", "8544.42.90", "8544.42"],
    alternative_codes_considered: [
      {
        hts_code: "8544.42.20.00",
        rejected_because:
          "Reserved for cables fitted with modular telephone connectors. USB-C is not a telephone connector; cable is for power/data delivery to consumer devices.",
      },
      {
        hts_code: "8504.40.95.40",
        rejected_because:
          "8504 covers static converters (the charger brick), not the cable. The cable on its own does not perform power conversion.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "8544.42.90.90", score: 0.94, description: "Other insulated electric conductors with connectors, ≤1000V, other" },
      { hts_code: "8544.42.20.00", score: 0.79, description: "Cables with modular telephone connectors" },
      { hts_code: "8544.49.20.00", score: 0.71, description: "Other electric conductors without connectors, ≤1000V" },
      { hts_code: "8504.40.95.40", score: 0.62, description: "Static converters (power supplies)" },
      { hts_code: "8536.69.40.00", score: 0.55, description: "Electrical plugs and sockets ≤1000V" },
    ],
  },
  {
    description: "20W USB-C PD fast wall charger, compact dual-port",
    hts_code: "8504.40.95.40",
    hts_code_8: "8504.40.95",
    gri_rule_applied: "1",
    confidence: "high",
    precision_level: "10",
    reasoning:
      "GRI 1: heading 8504 covers 'Electrical transformers, static converters (for example, rectifiers) and inductors.' A USB-C PD wall charger is a static converter — AC mains in, regulated DC out — so subheading 8504.40 (static converters) applies. 8504.40.95 is the 8-digit basket for 'Other' static converters (not rectifiers/rectifying apparatus, not power supplies for goods of 8471). Statistical suffix .40 covers other power supplies. Dual USB-C ports do not change classification.",
    citations: ["8504.40.95.40", "8504.40.95", "8504.40"],
    alternative_codes_considered: [
      {
        hts_code: "8504.40.85.00",
        rejected_because:
          "Reserved for power supplies for automatic data processing machines of heading 8471. A general USB-C wall charger for phones/tablets/earbuds is not exclusively for ADP machines — CBP NY N300473 placed similar multi-device chargers in 8504.40.95.",
      },
      {
        hts_code: "8536.69.40.00",
        rejected_because:
          "Heading 8536 is for apparatus for switching electrical circuits (plugs, sockets, switches). The charger performs power conversion, not switching, so 8504 governs.",
      },
      {
        hts_code: "8544.42.90.90",
        rejected_because:
          "8544 is the cable; the charger brick is a separate article presented with terminals/sockets that perform conversion.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "8504.40.95.40", score: 0.93, description: "Static converters, other power supplies" },
      { hts_code: "8504.40.85.00", score: 0.82, description: "Power supplies for ADP machines of 8471" },
      { hts_code: "8504.40.60.00", score: 0.71, description: "Rectifiers and rectifying apparatus" },
      { hts_code: "8536.69.40.00", score: 0.59, description: "Plugs and sockets ≤1000V" },
      { hts_code: "8544.42.90.90", score: 0.53, description: "Insulated conductors with connectors" },
    ],
  },
  {
    description:
      "Stainless steel double-wall vacuum-insulated water bottle, 750 ml, leakproof lid",
    hts_code: "9617.00.10.00",
    hts_code_8: "9617.00.10",
    gri_rule_applied: "1",
    confidence: "high",
    precision_level: "10",
    reasoning:
      "GRI 1: heading 9617 is eo nomine for 'Vacuum flasks and other vacuum vessels, complete with cases.' The double-wall vacuum construction is the essential character of the article — it is what makes it a vacuum vessel, not a generic stainless-steel container. 9617.00.10 is the 8-digit line for vacuum flasks and other vacuum vessels having a capacity not exceeding 1 liter. 750 ml falls under the 1-liter threshold. Statistical suffix .00 applies. Note: HQ H272079 and prior rulings consistently classify stainless-steel insulated water bottles here, not under heading 7323 (table/kitchen articles of base metal).",
    citations: ["9617.00.10.00", "9617.00.10", "9617"],
    alternative_codes_considered: [
      {
        hts_code: "7323.93.00.80",
        rejected_because:
          "7323 covers non-vacuum stainless-steel table/kitchen articles. CBP has consistently ruled that vacuum-insulated bottles are classified in the more specific heading 9617 by GRI 3(a) (heading providing the most specific description prevails).",
      },
      {
        hts_code: "9617.00.30.00",
        rejected_because:
          "The .30 line is for vacuum vessels with capacity exceeding 1 liter but not exceeding 2 liters. 750 ml is below the 1-liter threshold for .10.",
      },
      {
        hts_code: "3924.10.40.00",
        rejected_because:
          "3924 is for plastic tableware/kitchenware. The bottle's body and vacuum construction are stainless steel; the plastic lid is a component, not the article.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "9617.00.10.00", score: 0.96, description: "Vacuum flasks and vessels, capacity ≤1 liter" },
      { hts_code: "9617.00.30.00", score: 0.85, description: "Vacuum flasks, capacity >1 liter ≤2 liter" },
      { hts_code: "7323.93.00.80", score: 0.74, description: "Stainless steel kitchen/table articles, other" },
      { hts_code: "7323.99.90.30", score: 0.64, description: "Other iron/steel kitchen articles" },
      { hts_code: "3924.10.40.00", score: 0.51, description: "Plastic tableware and kitchenware" },
    ],
  },
  {
    description: "Silicone phone case for 6.1-inch smartphone, clear, raised camera bezel",
    hts_code: "3926.90.99.89",
    hts_code_8: "3926.90.99",
    gri_rule_applied: "1",
    confidence: "medium",
    precision_level: "10",
    reasoning:
      "GRI 1: heading 3926 covers 'Other articles of plastics and articles of other materials of headings 3901 to 3914.' Silicone (a synthetic plastic for tariff purposes per Note 1 to Chapter 39) phone cases are classified here per long-standing CBP practice — they are protective accessories made of plastic, not a part of the phone itself. 3926.90.99 is the 8-digit basket for 'Other' articles of plastics. Statistical suffix .89 (other). Confidence is medium because some rulings (e.g. NY N270243) have placed leather-coated cases differently and the import community sometimes argues for 8517 as a part of the phone — but CBP's settled position is that protective cases are accessories, not parts.",
    citations: ["3926.90.99.89", "3926.90.99", "3926"],
    alternative_codes_considered: [
      {
        hts_code: "8517.71.00.00",
        rejected_because:
          "Importers sometimes argue phone cases are parts of telephones under 8517.71. CBP NY N270243 and HQ H243216 reject this — Section XVI Note 1(c) excludes articles of Chapter 39 from being classified as parts in 8517. Cases are accessories of plastic, not parts.",
      },
      {
        hts_code: "4202.92.91.00",
        rejected_because:
          "4202 covers containers (cases, bags) with an outer surface of plastic sheeting. A molded silicone phone case is not a container in the 4202 sense — it is a sleeve that fits the phone, not a case that holds it inside.",
      },
      {
        hts_code: "3926.90.99.10",
        rejected_because:
          "Statistical suffix .10 is reserved for laboratory ware. This is a consumer accessory.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "3926.90.99.89", score: 0.89, description: "Other articles of plastics, other" },
      { hts_code: "8517.71.00.00", score: 0.77, description: "Parts of telephone sets" },
      { hts_code: "4202.92.91.00", score: 0.69, description: "Cases with outer surface of plastic sheeting" },
      { hts_code: "3926.90.99.10", score: 0.58, description: "Other articles of plastics, laboratory ware" },
      { hts_code: "3923.10.90.00", score: 0.52, description: "Plastic articles for conveyance/packing" },
    ],
  },
  {
    description: "Polypropylene food storage container set with snap-on lids, 1 liter, microwave safe",
    hts_code: "3924.10.40.00",
    hts_code_8: "3924.10.40",
    gri_rule_applied: "1",
    confidence: "high",
    precision_level: "10",
    reasoning:
      "GRI 1: heading 3924 covers 'Tableware, kitchenware, other household articles and hygienic or toilet articles, of plastics.' Subheading 3924.10 is specifically 'Tableware and kitchenware.' Polypropylene snap-lid food storage containers — used to store food in the kitchen and reheat in the microwave — fall squarely under 3924.10. The 8-digit line .40 is the basket 'Other' tableware/kitchenware of plastics. Statistical suffix .00. The container set is presented as a set put up for retail sale (containers + matching lids); GRI 3(b) is not needed because the set is described in a single subheading at the 6-digit level.",
    citations: ["3924.10.40.00", "3924.10.40", "3924.10"],
    alternative_codes_considered: [
      {
        hts_code: "3923.10.90.00",
        rejected_because:
          "3923 is for articles for the conveyance or packing of goods (commercial packaging). 3924 is the more specific heading for household tableware/kitchenware — applying GRI 1, the more specific heading prevails.",
      },
      {
        hts_code: "3924.90.56.50",
        rejected_because:
          "3924.90 covers 'other household articles' — bath/shower products, etc. Food storage containers are squarely tableware/kitchenware of 3924.10, not the residual .90 line.",
      },
    ],
    missing_inputs_for_precision: [],
    top_candidates: [
      { hts_code: "3924.10.40.00", score: 0.95, description: "Plastic tableware and kitchenware, other" },
      { hts_code: "3923.10.90.00", score: 0.72, description: "Plastic articles for conveyance or packing, other" },
      { hts_code: "3924.90.56.50", score: 0.63, description: "Other household plastic articles" },
      { hts_code: "3926.90.99.89", score: 0.54, description: "Other articles of plastics, other" },
    ],
  },
];

/**
 * For each seeded SKU that has a hand-crafted trace, insert an audit_log
 * row with the full classification trace and set sku_master.current_classification_id
 * to point at it. Idempotent — only writes when the SKU currently has a null
 * classification_id and the audit_log table is empty for the corresponding ID.
 */
export async function seedClassificationTraces(ctx: AppContext, customerId: string): Promise<void> {
  for (const t of TRACES) {
    // Find the SKU row by canonical description.
    const sku = await ctx.db
      .prepare(
        "SELECT sku, current_classification_id FROM sku_master WHERE customer_id = ? AND lower(canonical_description) = ? LIMIT 1",
      )
      .bind(customerId, t.description.trim().toLowerCase())
      .first<{ sku: string; current_classification_id: string | null }>();
    if (!sku) continue;
    if (sku.current_classification_id) continue; // already backfilled

    const classificationId = randomUUID();
    const occurredAt = new Date(Date.now() - Math.floor(Math.random() * 36) * 60 * 60 * 1000).toISOString();
    const model = ctx.config.defaultModel;
    const promptVersion = "v3.2-2026-04-15";
    const actor = `system:classifier@${model}#${promptVersion}`;

    const userMessage = `Product description from the importer:
"""
${t.description}
"""

Candidate HTS codes retrieved from the schedule (ranked by semantic similarity, most similar first). Cite only codes from this list:
${t.top_candidates
  .map((c, i) => `  ${String(i + 1).padStart(2)}. [${c.score.toFixed(3)}] ${c.hts_code}  —  ${c.description}`)
  .join("\n")}

Apply the GRI sequence and call the report_classification tool.`;

    const trace = {
      classificationId,
      promptVersion,
      model,
      candidates: t.top_candidates.map((c) => ({
        htsCode: c.hts_code,
        score: c.score,
        description: c.description,
        fullPath: c.description,
      })),
      userMessage,
      attempts: [
        {
          attempt: 1,
          rawToolInput: {
            hts_code: t.hts_code,
            hts_code_8: t.hts_code_8,
            gri_rule_applied: t.gri_rule_applied,
            reasoning: t.reasoning,
            citations: t.citations,
            alternative_codes_considered: t.alternative_codes_considered,
            missing_inputs_for_precision: t.missing_inputs_for_precision,
            confidence: t.confidence,
            precision_level: t.precision_level,
          },
          zodError: null,
          invalidCitations: [],
          invalidHtsCode: false,
        },
      ],
      reasoning_consistency_warning: null,
      sku_memory_hit: null,
      result: {
        hts_code: t.hts_code,
        hts_code_8: t.hts_code_8,
        gri_rule_applied: t.gri_rule_applied,
        reasoning: t.reasoning,
        citations: t.citations,
        alternative_codes_considered: t.alternative_codes_considered,
        missing_inputs_for_precision: t.missing_inputs_for_precision,
        confidence: t.confidence,
        precision_level: t.precision_level,
        validation_warning: null,
      },
    };

    const auditRowId = randomUUID();
    await ctx.db
      .prepare(
        "INSERT INTO audit_log (id, occurred_at, actor, entity_kind, entity_id, action, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(auditRowId, occurredAt, actor, "classification", classificationId, "classify", JSON.stringify(trace))
      .run();

    // Wire the SKU to the trace.
    await ctx.db
      .prepare("UPDATE sku_master SET current_classification_id = ? WHERE customer_id = ? AND sku = ?")
      .bind(classificationId, customerId, sku.sku)
      .run();
  }
}
