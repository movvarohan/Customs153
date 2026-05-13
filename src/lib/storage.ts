// TODO(CLAUDE.md "Stack"):
//   R2 helpers. DOCS = customer uploads. REFERENCE = HTS schedule + CROSS rulings cache.

import type { Env } from "@/types/env";

export async function putDocument(
  env: Env,
  key: string,
  body: ReadableStream | ArrayBuffer | string,
  contentType: string,
): Promise<void> {
  await env.DOCS.put(key, body, { httpMetadata: { contentType } });
}

export async function getDocument(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.DOCS.get(key);
}
