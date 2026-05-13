// Download the full US Harmonized Tariff Schedule as JSON from USITC's
// public reststop endpoint and save it under data/hts/raw/. Idempotent:
// if the target file already exists, skip the download.

import { promises as fs } from "node:fs";
import path from "node:path";

const SOURCE_URL =
  "https://hts.usitc.gov/reststop/exportList?from=0&to=99&format=JSON&styles=false";
const TARGET = "data/hts/raw/hts-2026.json";

async function main(): Promise<void> {
  const targetAbs = path.resolve(TARGET);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });

  try {
    const stat = await fs.stat(targetAbs);
    console.log(`already present: ${TARGET} (${(stat.size / 1024 / 1024).toFixed(1)} MB) — skipping`);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  console.log(`fetching ${SOURCE_URL}…`);
  const t0 = Date.now();
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`HTS fetch failed: HTTP ${res.status}`);
  }
  const text = await res.text();

  // Sanity-check: must parse as a non-empty array.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`HTS response was not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`HTS response was not a non-empty array (got ${typeof parsed})`);
  }

  await fs.writeFile(targetAbs, text);
  const sizeMb = (text.length / 1024 / 1024).toFixed(1);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`wrote ${TARGET} (${sizeMb} MB, ${parsed.length} rows) in ${seconds}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
