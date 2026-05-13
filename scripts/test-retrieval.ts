// Sanity check: hit the indexed HTS vector store with a handful of realistic
// product descriptions and print the top-5 matches. Not an eval — just
// confirms that "headphones" returns the 8518 family and not random chapters.

import path from "node:path";
import { LocalVectorStore } from "@/adapters/local/local-vector-store";
import { VoyageEmbeddingProvider } from "@/adapters/local/voyage-embedding";

const QUERIES: string[] = [
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

const TOP_K = 5;

async function main(): Promise<void> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) {
    console.error("VOYAGE_API_KEY is required.");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? ".data";

  const store = await LocalVectorStore.open(path.join(dataDir, "vectors/hts.json"));
  const embedder = new VoyageEmbeddingProvider({
    apiKey: voyageKey,
    inputType: "query",
  });

  for (const query of QUERIES) {
    console.log(`\n=== ${query} ===`);
    const vec = await embedder.embed(query);
    const matches = await store.query(vec, { topK: TOP_K });
    if (matches.length === 0) {
      console.log("  (no matches — did you run `npm run hts:index`?)");
      continue;
    }
    for (const m of matches) {
      const meta = m.metadata as {
        htsCode?: string;
        description?: string;
        parentHeading?: string | null;
      };
      const code = meta.htsCode ?? m.id;
      const desc = meta.description ?? "(no description)";
      const parent = meta.parentHeading ? ` [heading ${meta.parentHeading}]` : "";
      console.log(`  ${m.score.toFixed(4)}  ${code.padEnd(13)} ${desc}${parent}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
