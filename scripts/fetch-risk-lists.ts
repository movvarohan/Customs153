// Refresh the three risk-screening lists from their public sources into
// data/risk/. Idempotent — overwrites the existing CSVs.
//
//   npm run risk:fetch
//
// All three lists are free, no auth. If a source is unreachable (sandbox
// without network), the previously-committed file is left in place.

import { promises as fs } from "node:fs";
import path from "node:path";
import { clearRiskDataCache, loadRiskData } from "@/core/lib/risk-data";

const TARGETS: Array<{ name: string; url: string; out: string }> = [
  {
    name: "OFAC SDN",
    url: "https://www.treasury.gov/ofac/downloads/sdn.csv",
    out: "data/risk/ofac-sdn.csv",
  },
  {
    name: "BIS Entity List (via consolidated screening list)",
    url: "https://api.trade.gov/static/consolidated_screening_list/consolidated.csv",
    out: "data/risk/bis-entity-list.csv",
  },
  {
    name: "UFLPA Entity List (DHS publishes PDF; CSV maintained out-of-band)",
    url: "",
    out: "data/risk/uflpa-entity-list.csv",
  },
];

async function fetchOne(t: { name: string; url: string; out: string }): Promise<void> {
  if (!t.url) {
    console.log(`[skip] ${t.name} — no direct CSV URL upstream. Keeping committed copy at ${t.out}.`);
    return;
  }
  try {
    const r = await fetch(t.url);
    if (!r.ok) {
      console.warn(`[warn] ${t.name}: HTTP ${r.status}. Keeping committed copy at ${t.out}.`);
      return;
    }
    const body = await r.text();
    await fs.writeFile(path.resolve(t.out), body);
    const rows = body.split(/\r?\n/).filter((l) => l.length > 0).length;
    console.log(`[ok]   ${t.name}: ${rows.toLocaleString()} rows → ${t.out}`);
  } catch (e) {
    console.warn(`[warn] ${t.name}: ${e instanceof Error ? e.message : String(e)}. Keeping committed copy.`);
  }
}

async function main() {
  for (const t of TARGETS) await fetchOne(t);
  clearRiskDataCache();
  const data = await loadRiskData();
  console.log("\n─── Indexed ───");
  for (const s of data.sources) console.log(`  ${s.name.padEnd(20)} ${s.rows.toString().padStart(6)} rows  (refreshed ${s.last_refreshed})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
