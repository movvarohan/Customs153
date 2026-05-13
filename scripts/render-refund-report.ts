// Renders a refund-report JSON into a polished PDF — the artifact an
// importer actually receives. Run with:
//
//   tsx scripts/render-refund-report.ts <input.json> [<output.pdf>]
//
// Layout:
//   1. Cover page         — importer name, date, top-line metrics
//   2. Executive summary  — one paragraph in importer-friendly language
//   3. Refund opportunities — one block per finding with plain-English reasoning
//   4. Methodology        — what we do, what we don't do, legal limits
//   5. Appendix           — table of every entry analyzed, with our take

import { promises as fs } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { PSCFindings, type PSCFindingsT, type RefundOpportunityT } from "@/core/schemas/refund";

interface RenderOptions {
  inputPath: string;
  outputPath: string;
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(0)}%`;
}

function plainEnglishReason(opp: RefundOpportunityT): string {
  // First two sentences of the summary, cleaned of markdown emphasis chars.
  const cleaned = opp.reasoning_summary.replace(/\*\*/g, "").replace(/[••]/g, "");
  const sents = cleaned.split(/(?<=[.!?])\s+/);
  return sents.slice(0, 2).join(" ").trim();
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("usage: tsx scripts/render-refund-report.ts <input.json> [<output.pdf>]");
    process.exit(2);
  }
  const outputPath = process.argv[3] ?? inputPath.replace(/\.json$/i, ".pdf");

  const raw = await fs.readFile(inputPath, "utf8");
  const findings = PSCFindings.parse(JSON.parse(raw));
  await renderPdf({ inputPath, outputPath }, findings);

  const stat = await fs.stat(outputPath);
  console.log(`wrote ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`);
}

async function renderPdf(opts: RenderOptions, f: PSCFindingsT): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(opts.outputPath)), { recursive: true });
  const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true });
  const out = await fs.open(opts.outputPath, "w");
  const stream = out.createWriteStream();
  doc.pipe(stream);

  // ── Color palette ───────────────────────────────────────────────────────
  const NAVY = "#0f2c4d";
  const ACCENT = "#2a7f62";
  const MUTED = "#4a4a4a";
  const LIGHT = "#dddddd";
  const RED = "#a83a3a";

  // ── COVER PAGE ──────────────────────────────────────────────────────────
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("CUSTOMS-AGENT", { characterSpacing: 2 });
  doc.fontSize(9).fillColor(MUTED).font("Helvetica").text("AI-native customs operations  ·  hts.customs-agent.com").moveDown(6);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(28).text("Duty Refund Analysis");
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font("Helvetica").fontSize(13).text(`Historical-entry audit for ${f.importer}`);
  doc.moveDown(2);

  // Date block
  const analyzedDate = new Date(f.analyzed_at).toISOString().slice(0, 10);
  doc.fillColor(MUTED).fontSize(10).font("Helvetica-Bold").text("Analysis date:");
  doc.font("Helvetica").text(analyzedDate);
  doc.moveDown(1.5);

  // Top metrics — boxed
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
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, 310, metricY, { width: 250 });
    const isMoney = label.startsWith("Total");
    doc.fillColor(isMoney ? ACCENT : NAVY).font("Helvetica-Bold").fontSize(isMoney ? 13 : 11).text(value, 310, metricY + 11, { width: 250 });
    metricY += 24;
  }

  // Disclaimer
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
  const summary = oppCount === 0
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
      renderOpportunityBlock(doc, opp, idx + 1, { NAVY, ACCENT, MUTED, LIGHT, RED });
      doc.moveDown(1);
    });
  }

  // ── METHODOLOGY ─────────────────────────────────────────────────────────
  doc.addPage();
  sectionHeader(doc, "Methodology", NAVY);
  doc.moveDown(0.5);

  const methSections: Array<[string, string]> = [
    [
      "Classification",
      "Each line item is re-classified from the seller's product description against the full US Harmonized Tariff Schedule. The agent applies the General Rules of Interpretation (GRI 1 through 6) in legal order — first looking at the heading terms and binding chapter/section notes (GRI 1), then specificity and essential-character analysis (GRI 3) when more than one heading applies, then descending to the 6-, 8-, and 10-digit lines via GRI 6.",
    ],
    [
      "Citations",
      "Every classification cites at least one source from the candidate set returned by retrieval — either an HTS heading, subheading, or chapter note. Citations are checked against the candidate set; classifications whose citations don't ground are rejected and re-attempted.",
    ],
    [
      "Confidence",
      "\"High\" means we would defend this classification under a CBP focused assessment. \"Medium\" means the heading is likely correct but the 8-digit line depends on a value tier, material tier, or named-vs-residual choice that requires broker confirmation against actual product details. \"Low\" means two or more chapters remain plausible. Only high and medium opportunities appear in this report; low-confidence disagreements are listed separately for broker review.",
    ],
    [
      "Duty calculation",
      "Duty under both the filed and proposed classifications is computed deterministically — no LLM involved in the math. We model base ad-valorem rates, Section 301 (China) add-ons, Section 232 (steel and aluminum), Merchandise Processing Fee (0.3464%, capped per CBP's annual schedule), and Harbor Maintenance Fee (0.125% for ocean freight). Rates come from a versioned snapshot of the official USITC tariff table.",
    ],
    [
      "PSC eligibility window",
      "Post Summary Corrections may be filed within 314 days of entry liquidation, which is roughly within 11 months of the entry date. Entries older than the window are flagged in the appendix — those refunds, if accepted, must be pursued through the protest process (CBP Form 19) within 180 days of liquidation.",
    ],
    [
      "Limits",
      "All findings in this report are AI-generated and require licensed customs broker review before any filing. customs-agent is not a licensed customs broker; we are an AI operations platform that pairs with a licensed broker partner who exercises responsible supervision and control under 19 CFR Part 111. We do not represent any importer before CBP; we provide analysis our broker partner uses to file. Recoverable amounts assume CBP accepts each re-classification — actual recovery depends on broker confirmation and CBP review.",
    ],
  ];
  for (const [heading, body] of methSections) {
    ensureSpace(doc, 90);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(heading);
    doc.moveDown(0.2);
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(body, { width: 504, align: "justify", lineGap: 2 });
    doc.moveDown(0.8);
  }

  // ── APPENDIX ────────────────────────────────────────────────────────────
  doc.addPage();
  sectionHeader(doc, "Appendix — all entries analyzed", NAVY);
  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `Below is every entry / line item we analyzed. "✓" indicates we agreed with the broker's filing; rows in the opportunities section above are flagged here as refund opportunities. Low-confidence disagreements are listed at the end.`,
    { width: 504 },
  );
  doc.moveDown(0.6);

  // Build a quick map from (entry_number, line_index) → opportunity / uncertain
  const oppMap = new Map<string, RefundOpportunityT>();
  for (const o of f.refund_opportunities) oppMap.set(`${o.entry_number}#${o.line_index}`, o);
  const uncertainSet = new Set<string>(
    f.uncertain_cases.map((u) => `${u.entry_number}#${u.line_index}`),
  );

  // Table header
  const colHdr = (text: string, x: number, width: number) =>
    doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text(text, x, doc.y, { width, continued: false });

  // Two-column layout for appendix rows would be cluttered; use a single-column
  // structured row per line.
  // Group by entry for readability.
  const byEntry = new Map<string, { entry_number: string; lines: Array<{ idx: number; o?: RefundOpportunityT; uncertain: boolean }> }>();
  for (const o of f.refund_opportunities) {
    const grp = byEntry.get(o.entry_number) ?? { entry_number: o.entry_number, lines: [] };
    grp.lines.push({ idx: o.line_index, o, uncertain: false });
    byEntry.set(o.entry_number, grp);
  }
  for (const u of f.uncertain_cases) {
    const grp = byEntry.get(u.entry_number) ?? { entry_number: u.entry_number, lines: [] };
    grp.lines.push({ idx: u.line_index, uncertain: true });
    byEntry.set(u.entry_number, grp);
  }

  const totalDisagree = f.refund_opportunities.length + f.uncertain_cases.length;
  const totalAgree = f.agreements;

  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    `Across ${f.total_entries_analyzed} entries (${f.total_line_items_analyzed} line items): ` +
      `${totalAgree} agreed (we concur with filed classification), ` +
      `${f.refund_opportunities.length} refund opportunities surfaced, ` +
      `${f.uncertain_cases.length} flagged uncertain. Entry-level detail follows.`,
    { width: 504 },
  );
  doc.moveDown(0.6);

  // Render only the disagreements as table — agreed lines are summarized above.
  // (Full per-entry table would balloon the PDF; the JSON report has it.)
  if (totalDisagree > 0) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Disagreement detail");
    doc.moveDown(0.3);
    for (const o of f.refund_opportunities) {
      ensureSpace(doc, 50);
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(
        `${o.entry_number}  ·  line ${o.line_index + 1}  ·  ${o.entry_date}`,
        { width: 504 },
      );
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `${truncate(o.line_description, 90)}`,
        { width: 504 },
      );
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `filed ${o.hts_filed_8}  →  our ${o.hts_predicted_8}  ·  recoverable ${fmtMoney(o.recoverable_amount_usd_cents)}  ·  confidence ${o.our_confidence}`,
        { width: 504 },
      );
      doc.moveDown(0.4);
    }
    for (const u of f.uncertain_cases) {
      ensureSpace(doc, 45);
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(9).text(
        `${u.entry_number}  ·  line ${u.line_index + 1}  ·  ${u.entry_date}  ·  UNCERTAIN`,
        { width: 504 },
      );
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `${truncate(u.line_description, 90)}`,
        { width: 504 },
      );
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
        `filed ${u.hts_filed}  ·  agent predicted ${u.hts_predicted}  ·  not surfaced as opportunity (low confidence)`,
        { width: 504 },
      );
      doc.moveDown(0.4);
    }
  }

  // Page numbers — written in a second pass AFTER all content layout is
  // done, so the count reflects the final physical page total. Crucial
  // detail: pdfkit's doc.text() advances y after writing, and if that
  // advance crosses the page boundary pdfkit auto-paginates. Earlier
  // versions of this footer loop produced 12 physical pages when the
  // content fit in 6, all stamped "X / 6", because the footer write on
  // page N created page N+1 as a side effect. Two safeguards:
  //   1. lineBreak:false suppresses the y-advance, so the footer can't
  //      create a new page as a side effect.
  //   2. We snapshot start+count once into TOTAL_PAGES and never look at
  //      the live range during the loop.
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
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  void opts;
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
  c: { NAVY: string; ACCENT: string; MUTED: string; LIGHT: string; RED: string },
): void {
  const top = doc.y;

  // Title line
  doc.fillColor(c.NAVY).font("Helvetica-Bold").fontSize(13).text(
    `Finding ${num}  ·  ${fmtMoney(opp.recoverable_amount_usd_cents)} recoverable`,
    54,
    top,
    { width: 504 },
  );
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(9).text(
    `${opp.entry_number}  ·  entry date ${opp.entry_date}  ·  ${opp.psc_eligible ? "within PSC window" : "outside PSC window — protest required"}  ·  confidence ${opp.our_confidence}`,
    { width: 504 },
  );
  doc.moveDown(0.4);

  // Product description
  doc.fillColor(c.NAVY).font("Helvetica-Bold").fontSize(10).text("Product as filed:");
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(10).text(opp.line_description, { width: 504, lineGap: 1 });
  doc.moveDown(0.3);

  // HTS comparison block
  const compTop = doc.y;
  doc.rect(54, compTop, 504, 50).fillAndStroke("#f5f7fa", c.LIGHT);
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(9).text("Filed classification", 64, compTop + 8, { width: 240 });
  doc.fillColor(c.NAVY).font("Helvetica-Bold").fontSize(12).text(opp.hts_filed, 64, compTop + 22, { width: 240 });
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(9).text(`duty paid: ${fmtMoney(opp.duty_paid_usd_cents)}`, 64, compTop + 38, { width: 240 });

  doc.fillColor(c.MUTED).font("Helvetica").fontSize(9).text("Our proposed classification", 310, compTop + 8, { width: 240 });
  doc.fillColor(c.ACCENT).font("Helvetica-Bold").fontSize(12).text(opp.hts_predicted, 310, compTop + 22, { width: 240 });
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(9).text(`duty under our code: ${fmtMoney(opp.duty_predicted_usd_cents)}`, 310, compTop + 38, { width: 240 });

  doc.y = compTop + 58;

  // Reasoning
  doc.fillColor(c.NAVY).font("Helvetica-Bold").fontSize(10).text("Why we believe this is misclassified:");
  doc.fillColor(c.MUTED).font("Helvetica").fontSize(10).text(plainEnglishReason(opp), {
    width: 504,
    align: "justify",
    lineGap: 1.5,
  });
  doc.moveDown(0.3);

  // Broker-review footer
  doc.fillColor(c.MUTED).font("Helvetica-Oblique").fontSize(8).text(
    "This finding requires review by a licensed customs broker before filing a Post Summary Correction. Confirm the product matches the predicted classification's terms before action.",
    { width: 504, align: "left" },
  );
  doc.moveDown(0.4);

  // Separator
  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor(c.LIGHT).lineWidth(0.5).stroke();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
