// VectorStore interface. Local adapter is in-memory + JSON snapshot;
// Vectorize adapter later. Filter is a simple equality match on metadata.

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorQueryOptions {
  topK: number;
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(vector: number[], opts: VectorQueryOptions): Promise<VectorMatch[]>;
  delete(ids: string[]): Promise<void>;
}
