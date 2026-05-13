// Download the full US Harmonized Tariff Schedule as JSON from USITC's
// public reststop endpoint and save it under data/hts/raw/. Also download
// per-chapter and per-section legal notes as HTML under data/hts/notes/.
// Idempotent: skips any file that already exists.
//
// Endpoints:
//   exportList   →  /reststop/exportList?from=0&to=99&format=JSON&styles=false
//   chapterNotes →  /reststop/getChapterNotes?doc=<NN>
//   sectionNotes →  /reststop/getSectionNotes?doc=<NN>      (chapter num, not section)

import { promises as fs } from "node:fs";
import path from "node:path";

const RAW_URL =
  "https://hts.usitc.gov/reststop/exportList?from=0&to=99&format=JSON&styles=false";
const RAW_PATH = "data/hts/raw/hts-2026.json";
const NOTES_DIR = "data/hts/notes";

async function main(): Promise<void> {
  await fetchSchedule();
  await fetchNotes();
}

async function fetchSchedule(): Promise<void> {
  const targetAbs = path.resolve(RAW_PATH);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });

  if (await exists(targetAbs)) {
    const stat = await fs.stat(targetAbs);
    console.log(`already present: ${RAW_PATH} (${(stat.size / 1024 / 1024).toFixed(1)} MB) — skipping`);
    return;
  }
  console.log(`fetching ${RAW_URL}…`);
  const t0 = Date.now();
  const res = await fetch(RAW_URL);
  if (!res.ok) throw new Error(`HTS fetch failed: HTTP ${res.status}`);
  const text = await res.text();

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
  console.log(`wrote ${RAW_PATH} (${sizeMb} MB, ${parsed.length} rows) in ${seconds}s`);
}

async function fetchNotes(): Promise<void> {
  const dir = path.resolve(NOTES_DIR);
  await fs.mkdir(dir, { recursive: true });

  // Some chapters don't exist (e.g., 77 is reserved). We download all 99 and
  // ignore HTML responses that look like the "Notes not available" stub.
  let fetched = 0;
  let skipped = 0;
  let missing = 0;
  for (let n = 1; n <= 99; n++) {
    const key = String(n).padStart(2, "0");
    fetched += await downloadIfMissing(
      `https://hts.usitc.gov/reststop/getChapterNotes?doc=${n}`,
      path.join(dir, `chapter-${key}.html`),
    );
    fetched += await downloadIfMissing(
      `https://hts.usitc.gov/reststop/getSectionNotes?doc=${n}`,
      path.join(dir, `section-for-${key}.html`),
    );
  }
  // Audit empties — chapters where USITC returned a near-empty body.
  for (const f of await fs.readdir(dir)) {
    const stat = await fs.stat(path.join(dir, f));
    if (stat.size === 0) missing++;
    else if (stat.size < 200) skipped++;
  }
  console.log(`notes: ${fetched} files downloaded this run, ${skipped} short (likely 'no notes' stubs), ${missing} empty`);
}

async function downloadIfMissing(url: string, file: string): Promise<number> {
  if (await exists(file)) return 0;
  const res = await fetch(url);
  if (!res.ok) {
    // 404 on missing chapter is fine; bail on anything else
    if (res.status === 404) {
      await fs.writeFile(file, "");
      return 1;
    }
    throw new Error(`notes fetch failed for ${url}: HTTP ${res.status}`);
  }
  const body = await res.text();
  await fs.writeFile(file, body);
  return 1;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
