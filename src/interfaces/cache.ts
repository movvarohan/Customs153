// KeyValueCache interface. Local adapter is an in-memory Map with TTL;
// KV adapter later.

export interface KeyValueCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
