// TESTS ONLY. Deterministic hash-to-vector — no semantic meaning. Use this in
// unit tests that need an EmbeddingProvider without hitting a real API.
// For local development and indexing, use VoyageEmbeddingProvider instead.
//
// Default dimensions match voyage-3-large (1024) so tests can swap providers
// without re-indexing.

import type { EmbeddingProvider } from "@/interfaces/embeddings";

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions = 1024) {
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
