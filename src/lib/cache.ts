// TODO(CLAUDE.md "Stack"):
//   KV helpers for tariff rate tables, exchange rates, FTA preference rules.

import type { Env } from "@/types/env";

export async function getCachedJson<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.CACHE.get(key, "json");
  return (raw as T | null) ?? null;
}

export async function setCachedJson<T>(
  env: Env,
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const opts = ttlSeconds === undefined ? undefined : { expirationTtl: ttlSeconds };
  await env.CACHE.put(key, JSON.stringify(value), opts);
}
