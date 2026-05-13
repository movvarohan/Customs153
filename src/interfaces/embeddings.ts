// EmbeddingProvider interface. Local stub adapter today; production will be
// Workers AI BGE (or similar). Anthropic does not have an embeddings API,
// so this is a separate model regardless of runtime.

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
