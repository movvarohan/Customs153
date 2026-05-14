// CLI shim around src/core/lib/render-refund-pdf.ts. Reads a refund-report
// JSON, calls the shared renderer to produce a PDF buffer, writes the
// buffer to disk. The HTTP handler in src/core/routes/api.ts uses the
// same renderer to stream the PDF directly to the browser.
//
//   tsx scripts/render-refund-report.ts <input.json> [<output.pdf>]

import { promises as fs } from "node:fs";
import path from "node:path";
import { PSCFindings } from "@/core/schemas/refund";
import { renderRefundReportToBuffer } from "@/core/lib/render-refund-pdf";

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("usage: tsx scripts/render-refund-report.ts <input.json> [<output.pdf>]");
    process.exit(2);
  }
  const outputPath = process.argv[3] ?? inputPath.replace(/\.json$/i, ".pdf");

  const raw = await fs.readFile(inputPath, "utf8");
  const findings = PSCFindings.parse(JSON.parse(raw));
  const pdf = await renderRefundReportToBuffer(findings);

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, pdf);
  console.log(`wrote ${outputPath} (${(pdf.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
