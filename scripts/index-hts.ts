// Embed all HTS chunks via Voyage (input_type=document) and upsert them
// into the local HTS vector store. Run after `npm run hts:fetch`.
//
// Defaults are tuned for a paid Voyage account (batch=128, no inter-batch
// pause). On the free tier override with HTS_BATCH_SIZE=64
// HTS_BATCH_PAUSE_MS=21000 and accept the slowdown.
//
// Vector store metadata stored per chunk:
//   { htsCode, digitLevel, description, parentHeading, fullPath }
// — enough for test-retrieval and the eventual classifier to render
// candidates without round-tripping to the raw JSON.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseHtsSchedule, type RawHtsRow } from "@/core/lib/hts-parser";
import { loadHtsNotes } from "@/core/lib/hts-notes";
import { LocalVectorStore } from "@/adapters/local/local-vector-store";
import { VoyageEmbeddingProvider } from "@/adapters/local/voyage-embedding";
import type { VectorRecord } from "@/interfaces/vector-store";

const RAW_PATH = "data/hts/raw/hts-2026.json";
const NOTES_DIR = "data/hts/notes";

const BATCH_SIZE = Number(process.env.HTS_BATCH_SIZE ?? 128);
const BATCH_PAUSE_MS = Number(process.env.HTS_BATCH_PAUSE_MS ?? 0);
// voyage-3-large input price as of 2026-05: $0.18 / 1M tokens.
const PRICE_PER_MILLION = Number(process.env.VOYAGE_PRICE_PER_MILLION ?? 0.18);
// Rough English approximation; Voyage uses BPE and char/4 is within ~10%.
const CHARS_PER_TOKEN = 4;

const AUTO_YES = process.argv.includes("--yes") || process.argv.includes("-y");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

async function confirm(prompt: string): Promise<boolean> {
  if (AUTO_YES) {
    console.log(`${prompt} y (--yes)`);
    return true;
  }
  if (!process.stdin.isTTY) {
    console.error(`${prompt} aborted (stdin not a tty; pass --yes for non-interactive)`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(prompt)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

async function main(): Promise<void> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) {
    console.error("VOYAGE_API_KEY is required. Set it in .env or export it.");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? ".data";

  console.log(`reading ${RAW_PATH}…`);
  const raw = await fs.readFile(path.resolve(RAW_PATH), "utf8");
  const rows = JSON.parse(raw) as RawHtsRow[];
  console.log(`  ${rows.length} raw rows`);

  console.log("loading chapter / section notes…");
  const notes = await loadHtsNotes(NOTES_DIR);
  console.log(`  ${notes.chapter.size} chapters with notes, ${notes.section.size} chapters with section notes`);

  console.log("parsing…");
  const allChunks = parseHtsSchedule(rows, { notes });
  console.log(`  ${allChunks.length} tariff-line chunks`);

  // Optional digit-level filter — smoke-test convenience only. Production
  // indexing must run unfiltered (the classifier needs 10-digit precision).
  const maxLevel = process.env.HTS_MAX_LEVEL ? Number(process.env.HTS_MAX_LEVEL) : null;
  const chunks = maxLevel === null ? allChunks : allChunks.filter((c) => c.digitLevel <= maxLevel);
  if (maxLevel !== null) {
    console.log(`  HTS_MAX_LEVEL=${maxLevel}: filtered to ${chunks.length} chunks (SMOKE TEST ONLY)`);
  }

  // Token-count histogram.
  const tokenCounts = chunks.map((c) => estimateTokens(c.embeddingText));
  printHistogram(tokenCounts);
  const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);
  const estimatedCost = (totalTokens / 1_000_000) * PRICE_PER_MILLION;
  console.log(
    `\nestimated ~${(totalTokens / 1_000_000).toFixed(2)}M tokens, ~$${estimatedCost.toFixed(2)} at $${PRICE_PER_MILLION.toFixed(2)}/M for voyage-3-large`,
  );

  const ok = await confirm("proceed with indexing? [y/N] ");
  if (!ok) {
    console.log("aborted.");
    process.exit(1);
  }

  const vectorPath = path.join(dataDir, "vectors/hts.json");
  // Idempotent rebuild: nuke any prior vectors so we never blend stale ones.
  await fs.rm(vectorPath, { force: true });
  const store = await LocalVectorStore.open(vectorPath);

  const embedder = new VoyageEmbeddingProvider({
    apiKey: voyageKey,
    inputType: "document",
  });

  console.log(
    `\nembedding via voyage-3-large @ ${embedder.dimensions} dims, batch=${BATCH_SIZE}, pause=${BATCH_PAUSE_MS}ms`,
  );
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedder.embedBatch(batch.map((c) => c.embeddingText));
    const records: VectorRecord[] = batch.map((c, idx) => ({
      id: c.htsCode,
      vector: vectors[idx]!,
      metadata: {
        htsCode: c.htsCode,
        digitLevel: c.digitLevel,
        description: c.description,
        parentHeading: c.parentHeading,
        fullPath: c.fullPath,
      },
    }));
    await store.upsert(records);
    done += batch.length;
    const pct = ((done / chunks.length) * 100).toFixed(1);
    const last = batch[batch.length - 1]!;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${done}/${chunks.length} (${pct}%, last=${last.htsCode}, ${elapsed}s)`);
    if (BATCH_PAUSE_MS > 0 && done < chunks.length) await sleep(BATCH_PAUSE_MS);
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`embedding complete in ${seconds}s`);

  // Verify the file on disk holds the right number of vectors.
  const onDisk = JSON.parse(await fs.readFile(vectorPath, "utf8")) as unknown[];
  if (!Array.isArray(onDisk) || onDisk.length !== chunks.length) {
    throw new Error(
      `vector count mismatch: expected ${chunks.length}, got ${Array.isArray(onDisk) ? onDisk.length : "non-array"}`,
    );
  }
  const stat = await fs.stat(vectorPath);
  console.log(`verified: ${onDisk.length} vectors on disk at ${vectorPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

function printHistogram(values: number[]): void {
  console.log("\nembed-text token distribution:");
  const buckets: Array<[label: string, lo: number, hi: number]> = [
    ["    <200", 0, 200],
    [" 200–400", 200, 400],
    [" 400–600", 400, 600],
    [" 600–800", 600, 800],
    [" 800–1200", 800, 1200],
    ["1200–2000", 1200, 2000],
    ["   >2000", 2000, Infinity],
  ];
  const total = values.length;
  for (const [label, lo, hi] of buckets) {
    const n = values.filter((v) => v >= lo && v < hi).length;
    const pct = (n / total) * 100;
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`  ${label} tok  ${String(n).padStart(6)}  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  console.log(
    `  min=${sorted[0]}  p50=${pct(0.5)}  p95=${pct(0.95)}  p99=${pct(0.99)}  max=${sorted[sorted.length - 1]}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
