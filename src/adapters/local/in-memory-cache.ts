// In-memory KeyValueCache with TTL. Fine for dev. Cloudflare KV adapter later.

import type { KeyValueCache } from "@/interfaces/cache";

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

export class InMemoryCache implements KeyValueCache {
  private store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
