// TODO: replace with a real local embedding model (e.g. BGE via
// @huggingface/transformers, or Voyage / OpenAI API for dev). 768-dim cosine
// matches our planned Vectorize index dimensionality.
//
// This stub deterministically hashes text → vector so retrieval is at least
// reproducible during early scaffolding work. Do NOT use it for real eval runs.

import type { EmbeddingProvider } from "@/interfaces/embeddings";

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions = 768) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return hashToVector(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashToVector(t, this.dimensions));
  }
}

function hashToVector(text: string, dims: number): number[] {
  const out = new Array<number>(dims).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    out[i % dims]! += ((h >>> 0) % 2000) / 1000 - 1;
  }
  // L2 normalize so cosine similarity is well-behaved.
  let mag = 0;
  for (const v of out) mag += v * v;
  mag = Math.sqrt(mag) || 1;
  return out.map((v) => v / mag);
}
