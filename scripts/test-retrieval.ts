// Sanity check: hit the indexed HTS vector store with realistic product
// descriptions and print the top-5 matches. Not an eval — just confirms
// that semantic retrieval is sensible before we wire a classifier.
//
// Three sections:
//   1) The original hardcoded queries.
//   2) Five descriptions sampled from evals/hts-classification/gold.jsonl.
//   3) Three "chapter-notes effect" queries plus a diagnostic that shows
//      cosine similarity with vs. without notes baked into the target
//      chunk's embedding — to see whether including notes actually moves
//      the needle.

import { promises as fs } from "node:fs";
import path from "node:path";
import { LocalVectorStore } from "@/adapters/local/local-vector-store";
import { VoyageEmbeddingProvider } from "@/adapters/local/voyage-embedding";
import { loadHtsNotes } from "@/core/lib/hts-notes";
import {
  parseHtsSchedule,
  buildLeanEmbeddingText,
  type HtsChunk,
  type RawHtsRow,
} from "@/core/lib/hts-parser";

const HARDCODED: string[] = [
  "wireless bluetooth headphones with rechargeable battery",
  "men's cotton t-shirt knitted, size large",
  "stainless steel water bottle 750ml insulated",
  "lithium-ion battery pack with 18650 cells",
  "men's leather belt with metal buckle",
  "silicone phone case for smartphone",
  "ceramic coffee mug glazed",
  "yoga mat made of TPE foam",
  "rechargeable electric toothbrush with charging stand",
  "USB-C charging cable 6 feet braided nylon",
];

const GOLD_INDICES = [0, 5, 6, 11, 13]; // headphones, water bottle, phone case, food container, yoga mat

interface NotesDiagnostic {
  query: string;
  /** HTS codes we expect retrieval to surface ("right" answer). */
  targets: string[];
  /** HTS codes that historically beat the targets (we want to push these down). */
  distractors: string[];
}

const NOTES_DIAGNOSTICS: NotesDiagnostic[] = [
  {
    query: "thermos vacuum flask stainless steel insulated, 1 liter capacity",
    targets: ["9617.00", "9617.00.10.00"],
    distractors: ["7310", "7323"],
  },
  {
    query: "decorative plastic phone case with butterfly print",
    targets: ["3926", "3926.90"],
    distractors: ["8517", "4202"],
  },
  {
    query: "polyester yoga mat with rubber backing, 6mm thick",
    targets: ["3918", "3918.90", "9506.91.00"],
    distractors: ["4008", "6306.40"],
  },
];

const TOP_K = 5;

async function main(): Promise<void> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) {
    console.error("VOYAGE_API_KEY is required.");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? ".data";

  const store = await LocalVectorStore.open(path.join(dataDir, "vectors/hts.json"));
  const querier = new VoyageEmbeddingProvider({ apiKey: voyageKey, inputType: "query" });

  console.log("################  hardcoded queries  ################");
  for (const q of HARDCODED) await runQuery(store, querier, q);

  console.log("\n\n################  gold-set sample  ################");
  const lines = (await fs.readFile("evals/hts-classification/gold.jsonl", "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const gold = lines.map((l) => JSON.parse(l) as { description: string; expected_hts_8: string; ambiguous: boolean });
  for (const idx of GOLD_INDICES) {
    const g = gold[idx]!;
    console.log(`\n[${idx}] gold expected ${g.expected_hts_8}${g.ambiguous ? " — ambiguous" : ""}`);
    await runQuery(store, querier, g.description);
  }

  console.log("\n\n################  notes-effect diagnostic  ################");
  await runNotesDiagnostic(store, querier);
}

async function runQuery(
  store: LocalVectorStore,
  embedder: VoyageEmbeddingProvider,
  query: string,
): Promise<void> {
  console.log(`\n=== ${query} ===`);
  const vec = await embedder.embed(query);
  const matches = await store.query(vec, { topK: TOP_K });
  if (matches.length === 0) {
    console.log("  (no matches)");
    return;
  }
  for (const m of matches) {
    const meta = m.metadata as { htsCode?: string; description?: string; parentHeading?: string | null };
    const code = meta.htsCode ?? m.id;
    const desc = (meta.description ?? "").slice(0, 110);
    const parent = meta.parentHeading ? `  [heading ${meta.parentHeading}]` : "";
    console.log(`  ${m.score.toFixed(4)}  ${code.padEnd(13)} ${desc}${parent}`);
  }
}

async function runNotesDiagnostic(
  store: LocalVectorStore,
  querier: VoyageEmbeddingProvider,
): Promise<void> {
  // Load notes and parse so we can rebuild specific chunks' rich and lean
  // embed texts on demand for comparison.
  const raw = JSON.parse(await fs.readFile("data/hts/raw/hts-2026.json", "utf8")) as RawHtsRow[];
  const notes = await loadHtsNotes("data/hts/notes");
  const richChunks = parseHtsSchedule(raw, { notes });
  const byCode = new Map<string, HtsChunk>();
  for (const c of richChunks) byCode.set(c.htsCode, c);

  // A second Voyage provider in document mode so we can re-embed target
  // chunks with and without notes.
  const docEmbedder = new VoyageEmbeddingProvider({
    apiKey: process.env.VOYAGE_API_KEY!,
    inputType: "document",
  });

  for (const diag of NOTES_DIAGNOSTICS) {
    console.log(`\n=== diagnostic: ${diag.query} ===`);
    const queryVec = await querier.embed(diag.query);

    // First show the top-5 from the production (rich) index.
    const matches = await store.query(queryVec, { topK: TOP_K });
    console.log("  index top-5 (rich):");
    for (const m of matches) {
      const meta = m.metadata as { htsCode?: string; description?: string };
      const code = meta.htsCode ?? m.id;
      console.log(`    ${m.score.toFixed(4)}  ${code.padEnd(13)} ${(meta.description ?? "").slice(0, 100)}`);
    }

    // Now re-embed each target/distractor both ways and compare to the query.
    const codes = [...diag.targets, ...diag.distractors];
    const richTexts: string[] = [];
    const leanTexts: string[] = [];
    const usableCodes: string[] = [];
    for (const code of codes) {
      const c = byCode.get(code);
      if (!c) {
        console.log(`    (no chunk for ${code} — skipping)`);
        continue;
      }
      usableCodes.push(code);
      richTexts.push(c.embeddingText);
      leanTexts.push(buildLeanEmbeddingText(c));
    }
    const richVecs = await docEmbedder.embedBatch(richTexts);
    const leanVecs = await docEmbedder.embedBatch(leanTexts);
    console.log("  per-chunk cosine sim to query (rich vs. lean):");
    console.log(`    ${"code".padEnd(13)} ${"rich".padStart(8)}   ${"lean".padStart(8)}   ${"Δ".padStart(7)}  role`);
    for (let i = 0; i < usableCodes.length; i++) {
      const code = usableCodes[i]!;
      const role = diag.targets.includes(code) ? "TARGET" : "distractor";
      const rich = cosine(queryVec, richVecs[i]!);
      const lean = cosine(queryVec, leanVecs[i]!);
      const delta = rich - lean;
      const sign = delta >= 0 ? "+" : "";
      console.log(
        `    ${code.padEnd(13)} ${rich.toFixed(4).padStart(8)}   ${lean.toFixed(4).padStart(8)}   ${(sign + delta.toFixed(4)).padStart(7)}  ${role}`,
      );
    }
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let am = 0;
  let bm = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    am += ai * ai;
    bm += bi * bi;
  }
  const denom = Math.sqrt(am) * Math.sqrt(bm);
  return denom === 0 ? 0 : dot / denom;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
