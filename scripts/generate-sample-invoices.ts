// Generate three synthetic commercial-invoice PDFs into data/sample-invoices/.
// The line-item content comes from Claude Sonnet 4.5 (with a prompt for
// realistic, messy SMB-importer language). The PDF rendering uses pdfkit —
// pure JS, no native deps. Also seeds the FX rate cache so non-USD invoices
// can be converted by the extractor.

import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { z } from "zod";

const OUT_DIR = path.resolve("data/sample-invoices");

const InvoiceLineGen = z.object({
  description: z.string().min(3),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  country_of_origin: z.string().nullable(),
  hts_code_from_invoice: z.string().nullable(),
  material_composition: z.string().nullable(),
  model_number: z.string().nullable(),
});

const InvoiceGen = z.object({
  vendor: z.object({
    name: z.string(),
    address: z.array(z.string()),
    contact: z.string().nullable(),
  }),
  consignee: z.object({
    name: z.string(),
    address: z.array(z.string()),
  }),
  invoice_number: z.string(),
  invoice_date: z.string(),
  currency: z.string(),
  country_of_origin: z.string().nullable(),
  payment_terms: z.string().nullable(),
  incoterms: z.string().nullable(),
  line_items: z.array(InvoiceLineGen).min(4),
});
type InvoiceGenT = z.infer<typeof InvoiceGen>;

interface Profile {
  filename: string;
  prompt: string;
}

const PROFILES: Profile[] = [
  {
    filename: "shenzhen-electronics.pdf",
    prompt: `Generate a realistic commercial invoice from a small Shenzhen electronics manufacturer selling consumer electronics to a US Amazon FBA seller. The invoice is in USD. The vendor has slightly off "Chinglish" formatting and uses ALL CAPS for some product descriptions, with abbreviations and pre-classified HTS codes on some line items. Include 6–8 line items mixing: Bluetooth headphones, USB-C cables, phone cases, small power banks, LED desk lamps. Vary the data — include one line with hts_code_from_invoice set (the vendor pre-classified), one with material_composition (e.g., "PC+silicone"), one with model_number, and at least one line with a sparse/vague description like "MIXED HARDWARE - SAMPLE" that the extractor should flag. Use realistic prices ($3.50–$45 per unit) and quantities (100–1000). Don't make the descriptions textbook-clean; make them like a real seller types them.`,
  },
  {
    filename: "vietnam-apparel.pdf",
    prompt: `Generate a realistic commercial invoice from a Vietnamese garment manufacturer selling apparel to a US importer. The invoice is in USD. Include 5–7 line items mixing: men's cotton t-shirts (various colors/sizes), women's polyester blouses, denim jeans, woven scarves, a small order of swimwear. Realistic apparel-trade conventions: list size/color breakdowns sometimes in the description, sometimes as separate columns; include country_of_origin Vietnam at the document level (per the FTA). Include fiber composition (e.g., "100% Cotton", "65% Polyester 35% Cotton"). One line should have an HTS code from the seller (apparel exporters often pre-classify). Prices: $4–$25 per unit, quantities 200–2000. Include a "SAMPLES NO COMMERCIAL VALUE" line if it fits naturally (the extractor should flag it).`,
  },
  {
    filename: "india-houseware.pdf",
    prompt: `Generate a realistic commercial invoice from a small Indian houseware manufacturer selling to a US gift-shop importer. **The invoice is in Indian Rupees (INR).** Include 5–8 line items: ceramic mugs, brass candle holders, cotton dhurries (rugs), wooden cutting boards, glass tea-light holders, painted ceramic bowls. Realistic Indian-export conventions: descriptions sometimes include the Hindi/regional name in parentheses, GST is sometimes shown but is separate, occasional small typos. Prices in INR (1 USD ≈ 83 INR), so unit prices are commonly ₹150–₹2500. Quantities 50–500. Use country_of_origin India. Include material_composition for at least 2 items.`,
  },
];

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY required.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  for (const p of PROFILES) {
    console.log(`\n→ generating ${p.filename}`);
    const data = await generateInvoiceData(client, p.prompt);
    const pdfPath = path.join(OUT_DIR, p.filename);
    await renderPdf(data, pdfPath);
    const stat = await fs.stat(pdfPath);
    console.log(`  wrote ${pdfPath} (${(stat.size / 1024).toFixed(1)} KB, ${data.line_items.length} lines, currency ${data.currency})`);
  }

  console.log("\nFX rates for non-USD invoices are seeded by process-invoice via src/core/lib/fx-rates.ts.");
}

async function generateInvoiceData(client: Anthropic, prompt: string): Promise<InvoiceGenT> {
  const INVOICE_TOOL_SCHEMA = {
    type: "object" as const,
    properties: {
      vendor: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "array", items: { type: "string" } },
          contact: { type: ["string", "null"] },
        },
        required: ["name", "address", "contact"],
      },
      consignee: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "array", items: { type: "string" } },
        },
        required: ["name", "address"],
      },
      invoice_number: { type: "string" },
      invoice_date: { type: "string", description: "any format that looks like the vendor would print it" },
      currency: { type: "string" },
      country_of_origin: { type: ["string", "null"] },
      payment_terms: { type: ["string", "null"] },
      incoterms: { type: ["string", "null"] },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unit_price: { type: "number" },
            country_of_origin: { type: ["string", "null"] },
            hts_code_from_invoice: { type: ["string", "null"] },
            material_composition: { type: ["string", "null"] },
            model_number: { type: ["string", "null"] },
          },
          required: [
            "description",
            "quantity",
            "unit_price",
            "country_of_origin",
            "hts_code_from_invoice",
            "material_composition",
            "model_number",
          ],
        },
      },
    },
    required: [
      "vendor",
      "consignee",
      "invoice_number",
      "invoice_date",
      "currency",
      "country_of_origin",
      "payment_terms",
      "incoterms",
      "line_items",
    ],
  };

  const res = await client.messages.create({
    model: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
    max_tokens: 4096,
    system:
      "You generate synthetic commercial-invoice data for testing a customs classification system. Be realistic and slightly messy — write descriptions the way a real seller would, not the way a tariff schedule would. Vary line items meaningfully. Never include any real personal data; vendor and consignee names should be obviously synthetic (e.g., 'Shenzhen Aurora Electronics Co., Ltd.', 'Atlas Retail Holdings LLC').",
    tools: [
      {
        name: "emit_invoice",
        description: "Emit a structured synthetic commercial-invoice dataset.",
        input_schema: INVOICE_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "emit_invoice" },
    messages: [{ role: "user", content: prompt }],
  });
  const tu = res.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("no tool_use block");
  const parsed = InvoiceGen.safeParse(tu.input);
  if (!parsed.success) throw new Error(`invoice generation failed Zod: ${parsed.error.message}`);
  return parsed.data;
}

async function renderPdf(data: InvoiceGenT, outPath: string): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const stream = await fs.open(outPath, "w");
  const writeStream = stream.createWriteStream();
  doc.pipe(writeStream);

  // Header — vendor block
  doc.fontSize(16).font("Helvetica-Bold").text(data.vendor.name);
  doc.fontSize(9).font("Helvetica");
  for (const ln of data.vendor.address) doc.text(ln);
  if (data.vendor.contact) doc.text(data.vendor.contact);

  // Title
  doc.moveDown(0.6);
  doc.fontSize(20).font("Helvetica-Bold").text("COMMERCIAL INVOICE", { align: "center" });

  // Metadata block (left = invoice info, right = consignee)
  doc.moveDown(0.4);
  const metaTop = doc.y;
  doc.fontSize(9).font("Helvetica");
  doc.text(`Invoice No.: ${data.invoice_number}`, 36, metaTop);
  doc.text(`Invoice Date: ${data.invoice_date}`);
  if (data.payment_terms) doc.text(`Payment Terms: ${data.payment_terms}`);
  if (data.incoterms) doc.text(`Incoterms: ${data.incoterms}`);
  if (data.country_of_origin) doc.text(`Country of Origin: ${data.country_of_origin}`);
  doc.text(`Currency: ${data.currency}`);

  doc.font("Helvetica-Bold").text("Sold To / Consignee:", 320, metaTop);
  doc.font("Helvetica").text(data.consignee.name);
  for (const ln of data.consignee.address) doc.text(ln);

  // Compute table top
  doc.moveDown(1);
  const tableTop = Math.max(doc.y, metaTop + 100);
  doc.y = tableTop;
  doc.x = 36;

  // Column layout (Letter width 612pt, margins 36 → usable 540pt)
  const colX = { idx: 36, desc: 72, qty: 312, unit: 360, total: 460 };
  const tableWidth = 540;

  // Header row
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("#", colX.idx, tableTop);
  doc.text("Description", colX.desc, tableTop);
  doc.text("Qty", colX.qty, tableTop, { width: 40, align: "right" });
  doc.text("Unit Price", colX.unit, tableTop, { width: 90, align: "right" });
  doc.text("Total", colX.total, tableTop, { width: 110, align: "right" });
  doc.moveTo(36, tableTop + 14).lineTo(36 + tableWidth, tableTop + 14).stroke();

  let rowY = tableTop + 20;
  doc.font("Helvetica").fontSize(9);
  let runningTotal = 0;
  data.line_items.forEach((li, i) => {
    const total = li.quantity * li.unit_price;
    runningTotal += total;
    // Compose multi-line description with optional extras
    const descLines: string[] = [li.description];
    const extras: string[] = [];
    if (li.material_composition) extras.push(`Material: ${li.material_composition}`);
    if (li.model_number) extras.push(`Model: ${li.model_number}`);
    if (li.hts_code_from_invoice) extras.push(`HTS: ${li.hts_code_from_invoice}`);
    if (li.country_of_origin) extras.push(`Origin: ${li.country_of_origin}`);
    if (extras.length > 0) descLines.push(extras.join("  ·  "));

    doc.text(String(i + 1) + ".", colX.idx, rowY);
    const descText = descLines.join("\n");
    doc.text(descText, colX.desc, rowY, { width: 232 });
    doc.text(String(li.quantity), colX.qty, rowY, { width: 40, align: "right" });
    doc.text(li.unit_price.toFixed(2), colX.unit, rowY, { width: 90, align: "right" });
    doc.text(total.toFixed(2), colX.total, rowY, { width: 110, align: "right" });
    rowY += Math.max(28, 12 * descLines.length + 6);
    // Page break check
    if (rowY > 720) {
      doc.addPage();
      rowY = 50;
    }
  });

  // Total row
  doc.moveTo(36, rowY + 4).lineTo(36 + tableWidth, rowY + 4).stroke();
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text(`TOTAL ${data.currency}`, colX.unit - 60, rowY + 12, { width: 150, align: "right" });
  doc.text(runningTotal.toFixed(2), colX.total, rowY + 12, { width: 110, align: "right" });

  // Footer
  doc.font("Helvetica-Oblique").fontSize(8);
  doc.text("Synthetic invoice generated for customs-agent eval. Not a real commercial document.", 36, 760, {
    width: tableWidth,
    align: "center",
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => resolve());
    writeStream.on("error", (e) => reject(e));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
