// TODO(CLAUDE.md "Stack" + "Conventions"):
//   Thin wrapper over @anthropic-ai/sdk. Three model tiers: DEFAULT (Sonnet 4.5),
//   CHEAP (Haiku 4.5), HARD (Opus 4.7). Caller picks via env var, not hardcoded.
//   Enforces structured output via tool-use + Zod validation; retries on Zod failure.

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Env } from "@/types/env";

export type ModelTier = "default" | "cheap" | "hard";

export function getClient(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export function modelFor(env: Env, tier: ModelTier): string {
  switch (tier) {
    case "default":
      return env.DEFAULT_MODEL;
    case "cheap":
      return env.CHEAP_MODEL;
    case "hard":
      return env.HARD_MODEL;
  }
}

export async function structuredCall<T>(
  _env: Env,
  _opts: {
    tier: ModelTier;
    system: string;
    userContent: Anthropic.ContentBlockParam[];
    schema: z.ZodType<T>;
    maxRetries?: number;
  },
): Promise<T> {
  throw new Error("not implemented");
}
