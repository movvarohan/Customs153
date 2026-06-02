// Standalone risk screen — run the risk-screener against any HistoricalEntries
// JSON file (or one of the bundled samples) and print a human-readable summary.
//
//   npm run risk:screen -- data/sample-entries/amazon-fba.json

import { promises as fs } from "node:fs";
import { runRiskScreen } from "@/core/agents/risk-screener";
import { HistoricalEntries } from "@/core/schemas/refund";

async function main() {
  const file = process.argv[2] ?? "data/sample-entries/amazon-fba.json";
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  const parsed = HistoricalEntries.parse(raw);
  const profile = await runRiskScreen(parsed);

  console.log(`\n  ${"━".repeat(70)}`);
  console.log(`  RISK & COMPLIANCE — ${profile.importer}`);
  console.log(`  Overall status: ${profile.overall_status.toUpperCase()}`);
  console.log(`  ${"━".repeat(70)}\n`);
  console.log(`  ${profile.headline}\n`);

  console.log("  Parties screened:");
  console.log(`    Importer: ${profile.parties_screened.importer_name}${profile.parties_screened.importer_ein ? ` (EIN ${profile.parties_screened.importer_ein})` : ""}`);
  console.log(`    Suppliers (${profile.parties_screened.supplier_names.length}):`);
  for (const s of profile.parties_screened.supplier_names) console.log(`      • ${s}`);

  console.log(`\n  Sanctions hits (${profile.sanctions_hits.length}):`);
  if (profile.sanctions_hits.length === 0) console.log("    Clean.");
  for (const h of profile.sanctions_hits) {
    console.log(`    [${h.match_quality}] ${h.party_name} → ${h.matched_name}`);
    console.log(`        ${h.citation.source} #${h.citation.source_id} (${(h.similarity * 100).toFixed(0)}% similarity)`);
    console.log(`        ${h.recommended_action}`);
  }

  console.log(`\n  UFLPA exposure (${profile.uflpa_exposure.length}):`);
  if (profile.uflpa_exposure.length === 0) console.log("    None.");
  for (const u of profile.uflpa_exposure) {
    console.log(`    [${u.exposure_kind}] ${u.party_name}`);
    console.log(`        ${u.region_or_sector}`);
    console.log(`        ${u.recommended_action}`);
  }

  console.log(`\n  AD/CVD cases (${profile.add_cvd_active_cases.length}):`);
  if (profile.add_cvd_active_cases.length === 0) console.log("    None.");
  for (const c of profile.add_cvd_active_cases) {
    console.log(`    [HTS ${c.hts_code_8} · ${c.country}] ${c.case_number} — ${c.product_description}`);
    if (c.margin_pct != null) console.log(`        Margin: ${c.margin_pct}%`);
    console.log(`        ${c.recommended_action}`);
  }

  console.log(`\n  Entity-graph anomalies (${profile.entity_anomalies.length}):`);
  if (profile.entity_anomalies.length === 0) console.log("    None.");
  for (const a of profile.entity_anomalies) {
    console.log(`    [${a.kind}] ${a.description}`);
    console.log(`        ${a.recommended_action}`);
  }

  console.log(`\n  Sources:`);
  for (const s of profile.sources_used) console.log(`    • ${s.name}: ${s.rows.toLocaleString()} rows (refreshed ${s.last_refreshed})`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
