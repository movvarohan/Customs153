// Embed all HTS chunks via Voyage (input_type=document) and upsert them into
// the local HTS vector store. Run after `npm run hts:fetch`.
//
// Vector store metadata stored per chunk:
//   { htsCode, digitLevel, description, parentHeading, fullPath }
// This is enough for test-retrieval and the eventual classifier to render
// candidates without round-tripping to the raw JSON.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseHtsSchedule, type RawHtsRow, type HtsChunk } from "@/core/lib/hts-parser";
import { LocalVectorStore } from "@/adapters/local/local-vector-store";
import { VoyageEmbeddingProvider } from "@/adapters/local/voyage-embedding";
import type { VectorRecord } from "@/interfaces/vector-store";

const RAW_PATH = "data/hts/raw/hts-2026.json";
const BATCH_SIZE = 128;

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

  console.log("parsing…");
  const chunks = parseHtsSchedule(rows);
  console.log(`  ${chunks.length} tariff-line chunks`);

  const vectorPath = path.join(dataDir, "vectors/hts.json");
  // Start fresh so a re-index with a different embedding model doesn't leave
  // stale dimensions mixed in.
  await fs.rm(vectorPath, { force: true });
  const store = await LocalVectorStore.open(vectorPath);

  const embedder = new VoyageEmbeddingProvider({
    apiKey: voyageKey,
    inputType: "document",
  });

  console.log(`embedding via ${"voyage-3-large"} @ ${embedder.dimensions} dims, batch=${BATCH_SIZE}`);
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
      } satisfies HtsMeta,
    }));
    await store.upsert(records);
    done += batch.length;
    const pct = ((done / chunks.length) * 100).toFixed(1);
    const last = batch[batch.length - 1]!;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${done}/${chunks.length} (${pct}%, last=${last.htsCode}, ${elapsed}s)`);
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done in ${seconds}s — index written to ${vectorPath}`);
}

interface HtsMeta {
  htsCode: string;
  digitLevel: number;
  description: string;
  parentHeading: string | null;
  fullPath: string;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
