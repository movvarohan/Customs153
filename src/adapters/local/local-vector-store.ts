// In-memory VectorStore with optional JSON-file persistence. Cosine similarity.
// Fine for dev and for indexing thousands of HTS / CROSS items. Replace with
// Vectorize adapter in production.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  VectorMatch,
  VectorQueryOptions,
  VectorRecord,
  VectorStore,
} from "@/interfaces/vector-store";

export class LocalVectorStore implements VectorStore {
  private records = new Map<string, VectorRecord>();

  constructor(private readonly persistPath: string | null) {}

  static async open(persistPath: string | null): Promise<LocalVectorStore> {
    const store = new LocalVectorStore(persistPath);
    if (persistPath) {
      try {
        const raw = await fs.readFile(persistPath, "utf8");
        const arr = JSON.parse(raw) as VectorRecord[];
        for (const r of arr) store.records.set(r.id, r);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    return store;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
    await this.persist();
  }

  async query(vector: number[], opts: VectorQueryOptions): Promise<VectorMatch[]> {
    const matches: VectorMatch[] = [];
    for (const r of this.records.values()) {
      if (opts.filter && !matchesFilter(r.metadata, opts.filter)) continue;
      matches.push({
        id: r.id,
        score: cosineSimilarity(vector, r.vector),
        metadata: r.metadata,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, opts.topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
    await fs.writeFile(
      this.persistPath,
      JSON.stringify(Array.from(this.records.values())),
    );
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector dim mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    aMag += ai * ai;
    bMag += bi * bi;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom === 0 ? 0 : dot / denom;
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (metadata[k] !== v) return false;
  }
  return true;
}
