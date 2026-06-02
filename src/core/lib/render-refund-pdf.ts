// PDF rendering for the refund analysis. Returns a Buffer rather than
// writing to a file, so it's reusable from both the CLI script and the
// HTTP handler that streams a PDF to a frontend download.
//
// Layout:
//   1. Cover page         — importer, date, AT-A-GLANCE metrics
//   2. Executive summary  — importer-friendly paragraph + "what happens next"
//   3. Refund opportunities — one block per finding
//   4. Methodology        — what we do, what we don't do, legal limits
//   5. Appendix           — disagreements + uncertain + classification failures

import PDFDocument from "pdfkit";
import type { PSCFindingsT, RefundOpportunityT } from "@/core/schemas/refund";
import type { RiskProfileT } from "@/core/schemas/risk";

const NAVY = "#0f2c4d";
const ACCENT = "#2a7f62";
const MUTED = "#4a4a4a";
const WARN = "#b54a1f";
const RISK_RED = "#b1372e";
const LIGHT = "#dddddd";
const RED = "#a83a3a";

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(0)}%`;
}

function plainEnglishReason(opp: RefundOpportunityT): string {
  const cleaned = opp.reasoning_summary.replace(/\*\*/g, "").replace(/[••]/g, "");
  const sents = cleaned.split(/(?<=[.!?])\s+/);
  return sents.slice(0, 2).join(" ").trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function sectionHeader(doc: PDFKit.PDFDocument, text: string, color: string): void {
  doc.fillColor(color).font("Helvetica-Bold").fontSize(20).text(text);
  doc.moveDown(0.1);
  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor("#cccccc").lineWidth(0.5).stroke();
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > 730) doc.addPage();
}

function renderOpportunityBlock(
  doc: PDFKit.PDFDocument,
  opp: RefundOpportunityT,
  num: number,
): void {
  const top = doc.y;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(
    `Finding ${num}  ·  ${fmtMoney(opp.recoverable_amount_usd_cents)} recoverable`,
    54,
    top,
    { width: 504 },
  );
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `${opp.entry_number}  ·  entry date ${opp.entry_date}  ·  ${opp.psc_eligible ? "within PSC window" : "outside PSC window — protest required"}  ·  confidence ${opp.our_confidence}`,
    { width: 504 },
  );
  doc.moveDown(0.4);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Product as filed:");
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(opp.line_description, { width: 504, lineGap: 1 });
  doc.moveDown(0.3);

  const compTop = doc.y;
  doc.rect(54, compTop, 504, 50).fillAndStroke("#f5f7fa", LIGHT);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Filed classification", 64, compTop + 8, { width: 240 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(opp.hts_filed, 64, compTop + 22, { width: 240 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`duty paid: ${fmtMoney(opp.duty_paid_usd_cents)}`, 64, compTop + 38, { width: 240 });

  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Our proposed classification", 310, compTop + 8, { width: 240 });
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(12).text(opp.hts_predicted, 310, compTop + 22, { width: 240 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`duty under our code: ${fmtMoney(opp.duty_predicted_usd_cents)}`, 310, compTop + 38, { width: 240 });

  doc.y = compTop + 58;

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Why we believe this is misclassified:");
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(plainEnglishReason(opp), {
    width: 504,
    align: "justify",
    lineGap: 1.5,
  });
  doc.moveDown(0.3);

  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(
    "This finding requires review by a licensed customs broker before filing a Post Summary Correction. Confirm the product matches the predicted classification's terms before action.",
    { width: 504, align: "left" },
  );
  doc.moveDown(0.4);

  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor(LIGHT).lineWidth(0.5).stroke();
}

/**
 * Renders the refund report into an in-memory PDF buffer. Both
 * scripts/render-refund-report.ts (CLI, writes buffer to file) and
 * src/core/routes/api.ts (HTTP, returns buffer to client) call this.
 */
export async function renderRefundReportToBuffer(f: PSCFindingsT): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── COVER ───────────────────────────────────────────────────────────────
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("CUSTOMS-AGENT", { characterSpacing: 2 });
  doc.fontSize(9).fillColor(MUTED).font("Helvetica").text("AI-native customs operations  ·  hts.customs-agent.com").moveDown(6);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(28).text("Duty Refund Analysis");
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font("Helvetica").fontSize(13).text(`Historical-entry audit for ${f.importer}`);
  doc.moveDown(2);

  const analyzedDate = new Date(f.analyzed_at).toISOString().slice(0, 10);
  doc.fillColor(MUTED).fontSize(10).font("Helvetica-Bold").text("Analysis date:");
  doc.font("Helvetica").text(analyzedDate);
  doc.moveDown(1.5);

  const recov = f.total_recoverable_usd_cents;
  const elig = f.refund_opportunities.filter((o) => o.psc_eligible).length;
  const nonElig = f.refund_opportunities.filter((o) => !o.psc_eligible).length;
  const boxTop = doc.y;
  doc.rect(54, boxTop, 504, 110).fillAndStroke("#f5f7fa", LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("AT A GLANCE", 70, boxTop + 14, { width: 200 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const metricsLeft: Array<readonly [string, string]> = [
    ["Entries analyzed", String(f.total_entries_analyzed)],
    ["Line items analyzed", String(f.total_line_items_analyzed)],
    ["Refund opportunities surfaced", String(f.refund_opportunities.length)],
  ];
  const metricsRight: Array<readonly [string, string]> = [
    ["Total recoverable", fmtMoney(recov)],
    ["Within PSC filing window", `${elig} of ${f.refund_opportunities.length}`],
    ["Require protest (outside window)", String(nonElig)],
  ];
  let metricY = boxTop + 32;
  for (const [label, value] of metricsLeft) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, 70, metricY, { width: 220 });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(value, 70, metricY + 11, { width: 220 });
    metricY += 24;
  }
  metricY = boxTop + 32;
  for (const [label, value] of metricsRight) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, 310, metricY, { width: 248 });
    const isMoney = label.startsWith("Total");
    doc.fillColor(isMoney ? ACCENT : NAVY).font("Helvetica-Bold").fontSize(isMoney ? 13 : 11).text(value, 310, metricY + 11, { width: 248 });
    metricY += 24;
  }

  doc.y = boxTop + 130;
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8.5).text(
    "This is an AI-generated analysis. All findings require licensed customs broker review before any Post Summary Correction or protest is filed. customs-agent is not a licensed customs broker; we pair with a broker partner who exercises responsible supervision and control under 19 CFR Part 111.",
    54,
    doc.y,
    { width: 504, align: "justify" },
  );

  // ── EXECUTIVE SUMMARY ───────────────────────────────────────────────────
  doc.addPage();
  sectionHeader(doc, "Executive summary", NAVY);
  doc.moveDown(0.5);

  const oppCount = f.refund_opportunities.length;
  const hi = f.confidence_breakdown.high_usd_cents;
  const md = f.confidence_breakdown.medium_usd_cents;
  const summary =
    oppCount === 0
      ? `We analyzed ${f.total_entries_analyzed} entries (${f.total_line_items_analyzed} line items) filed under your import history. We agreed with the existing classification on ${fmtPct(f.agreements, f.total_line_items_analyzed)} of line items. No refund opportunities surfaced at sufficient confidence for filing. ${f.uncertain_cases.length > 0 ? `${f.uncertain_cases.length} cases were flagged as uncertain — see the appendix.` : ""}`
      : `We analyzed ${f.total_entries_analyzed} entries (${f.total_line_items_analyzed} line items) filed under your import history. We identified ${oppCount} ${oppCount === 1 ? "line item" : "line items"} where we believe the classification filed was incorrect, representing ${fmtMoney(recov)} in recoverable duties. ${elig === oppCount ? `All ${oppCount} findings are within the 314-day PSC window and can be filed as a Post Summary Correction.` : `${elig} of ${oppCount} are within the PSC window; the remaining ${nonElig} are older and require a protest (CBP Form 19) within 180 days of liquidation.`} Of the recoverable total, ${fmtMoney(hi)} is high-confidence and ${fmtMoney(md)} is medium-confidence (broker should verify against actual product details). ${f.uncertain_cases.length > 0 ? `${f.uncertain_cases.length} additional case${f.uncertain_cases.length === 1 ? "" : "s"} are flagged as uncertain — listed in the appendix.` : ""}`;

  doc.fillColor(MUTED).font("Helvetica").fontSize(11).text(summary, { width: 504, align: "justify", lineGap: 3 });
  doc.moveDown(2);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("What happens next");
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).list(
    [
      "Review the refund opportunities (next section). Each finding includes the legal reasoning and the citations the agent relied on.",
      "Your licensed customs broker validates each finding against the actual product before filing. We pair with your existing broker or one of ours.",
      "Accepted findings are filed as Post Summary Corrections (within 314 days of liquidation) or as protests (within 180 days of liquidation).",
      "Refunds are typically issued by CBP within 90 days of an accepted PSC.",
    ],
    { width: 504, lineGap: 2, bulletRadius: 2 },
  );

  // ── REFUND OPPORTUNITIES ───────────────────────────────────────────────
  if (f.refund_opportunities.length > 0) {
    doc.addPage();
    sectionHeader(doc, "Refund opportunities", NAVY);
    doc.moveDown(0.5);
    f.refund_opportunities.forEach((opp, idx) => {
      ensureSpace(doc, 200);
      renderOpportunityBlock(doc, opp, idx + 1);
      doc.moveDown(1);
    });
  }

  // ── RISK & COMPLIANCE ──────────────────────────────────────────────────
  if (f.risk_profile) renderRiskSection(doc, f.risk_profile);

  // ── METHODOLOGY ────────────────────────────────────────────────────────
  doc.addPage();
  sectionHeader(doc, "Methodology", NAVY);
  doc.moveDown(0.5);

  const methSections: Array<[string, string]> = [
    ["Classification", "Each line item is re-classified from the seller's product description against the full US Harmonized Tariff Schedule. The agent applies the General Rules of Interpretation (GRI 1 through 6) in legal order — first looking at the heading terms and binding chapter/section notes (GRI 1), then specificity and essential-character analysis (GRI 3) when more than one heading applies, then descending to the 6-, 8-, and 10-digit lines via GRI 6."],
    ["Citations", "Every classification cites at least one source from the candidate set returned by retrieval — either an HTS heading, subheading, or chapter note. Citations are checked against the candidate set; classifications whose citations don't ground are rejected and re-attempted."],
    ["Confidence", '"High" means we would defend this classification under a CBP focused assessment. "Medium" means the heading is likely correct but the 8-digit line depends on a value tier, material tier, or named-vs-residual choice that requires broker confirmation against actual product details. "Low" means two or more chapters remain plausible. Only high and medium opportunities appear in this report; low-confidence disagreements are listed separately for broker review.'],
    ["Duty calculation", "Duty under both the filed and proposed classifications is computed deterministically — no LLM involved in the math. We model base ad-valorem rates, Section 301 (China) add-ons, and Section 232 (steel and aluminum). Rates come from a versioned snapshot of the official USITC tariff table."],
    ["Fee calculation assumptions and limitations", "Merchandise Processing Fee (MPF, 0.3464%, FY2026 min $33.58 / max $651.50 per CBP Dec. 25-10) and Harbor Maintenance Fee (HMF, 0.125%) are CBP user fees assessed at the entry level on the aggregate entered value, not per line. Because they're value-based and entry-based — not classification-based — they are identical under the filed code and the proposed code on the same entry, and therefore CANCEL OUT in the recoverable-amount calculation. Recoverable equals (filed duty − proposed duty) only; we do not double-count fees. HMF only applies to ocean cargo; if the entry's mode of transport is not on the source documents we assume ocean and surface that assumption. We do not currently model MPF exemptions for goods qualifying under USMCA or other free-trade agreements (those entries pay no MPF) — broker should confirm FTA eligibility before filing. Fees are computed on the data available; entries with missing entered-value totals are flagged in the appendix."],
    ["PSC eligibility window", "Post Summary Corrections may be filed within 314 days of entry liquidation, which is roughly within 11 months of the entry date. Entries older than the window are flagged in the appendix — those refunds, if accepted, must be pursued through the protest process (CBP Form 19) within 180 days of liquidation."],
    ["Limits", "All findings in this report are AI-generated and require licensed customs broker review before any filing. customs-agent is not a licensed customs broker; we are an AI operations platform that pairs with a licensed broker partner who exercises responsible supervision and control under 19 CFR Part 111. We do not represent any importer before CBP; we provide analysis our broker partner uses to file. Recoverable amounts assume CBP accepts each re-classification — actual recovery depends on broker confirmation and CBP review."],
  ];
  for (const [heading, body] of methSections) {
    ensureSpace(doc, 90);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(heading);
    doc.moveDown(0.2);
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(body, { width: 504, align: "justify", lineGap: 2 });
    doc.moveDown(0.8);
  }

  // ── APPENDIX ───────────────────────────────────────────────────────────
  doc.addPage();
  sectionHeader(doc, "Appendix — all entries analyzed", NAVY);
  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `Below is every entry / line item we analyzed. Rows in the opportunities section above are flagged here as refund opportunities. Low-confidence disagreements and classification failures are listed at the end.`,
    { width: 504 },
  );
  doc.moveDown(0.6);

  const totalDisagree = f.refund_opportunities.length + f.uncertain_cases.length + (f.failures?.length ?? 0);

  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `Across ${f.total_entries_analyzed} entries (${f.total_line_items_analyzed} line items): ` +
      `${f.agreements} agreed (we concur with filed classification), ` +
      `${f.refund_opportunities.length} refund opportunities surfaced, ` +
      `${f.uncertain_cases.length} flagged uncertain, ` +
      `${f.failures?.length ?? 0} classification failures. Entry-level detail follows.`,
    { width: 504 },
  );
  doc.moveDown(0.6);

  if (totalDisagree > 0) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Disagreement detail");
    doc.moveDown(0.3);
    for (const o of f.refund_opportunities) {
      ensureSpace(doc, 50);
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(`${o.entry_number}  ·  line ${o.line_index + 1}  ·  ${o.entry_date}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${truncate(o.line_description, 90)}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `filed ${o.hts_filed_8}  ->  our ${o.hts_predicted_8}  ·  recoverable ${fmtMoney(o.recoverable_amount_usd_cents)}  ·  confidence ${o.our_confidence}`,
        { width: 504 },
      );
      doc.moveDown(0.4);
    }
    for (const u of f.uncertain_cases) {
      ensureSpace(doc, 45);
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(9).text(`${u.entry_number}  ·  line ${u.line_index + 1}  ·  ${u.entry_date}  ·  UNCERTAIN`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${truncate(u.line_description, 90)}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `filed ${u.hts_filed}  ·  agent predicted ${u.hts_predicted}  ·  not surfaced as opportunity (low confidence)`,
        { width: 504 },
      );
      doc.moveDown(0.4);
    }
    for (const fail of f.failures ?? []) {
      ensureSpace(doc, 45);
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(9).text(
        `${fail.entry_number}  ·  line ${fail.line_index + 1}  ·  CLASSIFICATION FAILED — broker review required`,
        { width: 504 },
      );
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${truncate(fail.line_description, 90)}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(`error: ${truncate(fail.error, 150)}`, { width: 504 });
      doc.moveDown(0.4);
    }
  }

  // Page numbers — written after layout, in a way that can't auto-paginate.
  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
      `${i + 1} / ${totalPages}`,
      54,
      750,
      { width: 504, align: "right", lineBreak: false },
    );
  }
  doc.flushPages();

  doc.end();
  return done;
}

// ─── Risk & Compliance section ────────────────────────────────────────────
function renderRiskSection(doc: PDFKit.PDFDocument, r: RiskProfileT): void {
  doc.addPage();
  sectionHeader(doc, "Risk & compliance", NAVY);
  doc.moveDown(0.4);

  // Status banner.
  const banner = r.overall_status === "clean"
    ? { color: ACCENT, label: "CLEAN" }
    : r.overall_status === "review_required"
    ? { color: WARN, label: "REVIEW REQUIRED" }
    : { color: RISK_RED, label: "BLOCKING" };
  doc.save();
  doc.rect(54, doc.y, 504, 30).fill(banner.color);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(11)
    .text(banner.label, 54, doc.y - 25, { width: 100, align: "center" });
  doc.fillColor("white").font("Helvetica").fontSize(10)
    .text(r.headline, 160, doc.y - 13, { width: 388, lineBreak: false });
  doc.restore();
  doc.y += 14;
  doc.moveDown(0.6);

  // Sources used.
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `Sources: ${r.sources_used.map((s) => `${s.name} (${s.rows.toLocaleString()} rows, refreshed ${s.last_refreshed})`).join(" · ")}`,
    { width: 504 },
  );
  doc.moveDown(0.8);

  // Parties screened.
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Parties screened");
  doc.moveDown(0.2);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(
    `Importer: ${r.parties_screened.importer_name}${r.parties_screened.importer_ein ? ` (EIN ${r.parties_screened.importer_ein})` : ""}`,
    { width: 504 },
  );
  if (r.parties_screened.supplier_names.length > 0) {
    doc.text(`Suppliers (${r.parties_screened.supplier_names.length}): ${r.parties_screened.supplier_names.join(", ")}`, { width: 504 });
  } else {
    doc.text("Suppliers: none on file. Add supplier names per entry for fuller screening.", { width: 504 });
  }
  doc.moveDown(0.8);

  // Sanctions check.
  ensureSpace(doc, 80);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Sanctions check (OFAC SDN + BIS Entity List)");
  doc.moveDown(0.2);
  if (r.sanctions_hits.length === 0) {
    doc.fillColor(ACCENT).font("Helvetica").fontSize(10).text(
      `Clean. No party matched any entry on the OFAC SDN list or BIS Entity List.`,
      { width: 504 },
    );
  } else {
    for (const h of r.sanctions_hits) {
      ensureSpace(doc, 60);
      doc.fillColor(h.match_quality === "exact" ? RISK_RED : WARN).font("Helvetica-Bold").fontSize(10)
        .text(`${h.party_name} → ${h.matched_name}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `${h.citation.source} #${h.citation.source_id} · ${h.match_quality} match (${(h.similarity * 100).toFixed(0)}% similarity) · refreshed ${h.citation.source_date}`,
        { width: 504 },
      );
      doc.text(h.recommended_action, { width: 504, lineGap: 1 });
      doc.moveDown(0.4);
    }
  }
  doc.moveDown(0.6);

  // UFLPA.
  ensureSpace(doc, 80);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("UFLPA exposure (Uyghur Forced Labor Prevention Act)");
  doc.moveDown(0.2);
  if (r.uflpa_exposure.length === 0) {
    doc.fillColor(ACCENT).font("Helvetica").fontSize(10).text(
      `No UFLPA exposure. No party on the DHS UFLPA Entity List; no supplier address in XUAR or a documented labor-transfer destination.`,
      { width: 504 },
    );
  } else {
    for (const u of r.uflpa_exposure) {
      ensureSpace(doc, 60);
      const color = u.exposure_kind === "direct_list_match" ? RISK_RED : WARN;
      doc.fillColor(color).font("Helvetica-Bold").fontSize(10)
        .text(`${u.party_name} — ${u.region_or_sector}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `${u.citation.source} · ${u.citation.quote} · refreshed ${u.citation.source_date}`,
        { width: 504 },
      );
      doc.text(u.recommended_action, { width: 504, lineGap: 1 });
      doc.moveDown(0.4);
    }
  }
  doc.moveDown(0.6);

  // AD/CVD cases.
  ensureSpace(doc, 80);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Antidumping / countervailing-duty cases active on filed HTS lines");
  doc.moveDown(0.2);
  if (r.add_cvd_active_cases.length === 0) {
    doc.fillColor(ACCENT).font("Helvetica").fontSize(10).text(
      `No active AD/CVD case matches any (HTS code, country) on the filing.`,
      { width: 504 },
    );
  } else {
    for (const c of r.add_cvd_active_cases) {
      ensureSpace(doc, 55);
      doc.fillColor(WARN).font("Helvetica-Bold").fontSize(10)
        .text(`HTS ${c.hts_code_8} from ${c.country} — case ${c.case_number}${c.margin_pct != null ? ` (${c.margin_pct}%)` : ""}`, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(c.product_description, { width: 504 });
      doc.text(c.recommended_action, { width: 504, lineGap: 1 });
      doc.moveDown(0.4);
    }
  }
  doc.moveDown(0.6);

  // Entity graph.
  if (r.entity_anomalies.length > 0) {
    ensureSpace(doc, 80);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Entity-graph anomalies");
    doc.moveDown(0.2);
    for (const a of r.entity_anomalies) {
      ensureSpace(doc, 55);
      doc.fillColor(WARN).font("Helvetica-Bold").fontSize(10).text(a.description, { width: 504 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `Parties: ${a.parties_involved.join("; ")}`, { width: 504 },
      );
      doc.text(a.recommended_action, { width: 504, lineGap: 1 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.6);
  }

  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(
    "Every item in this section requires licensed-broker review before filing. customs-agent is not a licensed customs broker; this report is decision-support for the broker partner.",
    { width: 504, align: "left" },
  );
}
