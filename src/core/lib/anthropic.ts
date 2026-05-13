// TODO(CLAUDE.md "Conventions"):
//   Thin wrapper over @anthropic-ai/sdk. Three model tiers: DEFAULT (Sonnet 4.5),
//   CHEAP (Haiku 4.5), HARD (Opus 4.7). The Anthropic SDK works identically on
//   Node and in Workers, so the client itself lives on AppContext, not behind
//   an interface — only the model picker and the structured-output retry live here.

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AppContext } from "@/core/app-context";

export type ModelTier = "default" | "cheap" | "hard";

export function modelFor(ctx: AppContext, tier: ModelTier): string {
  switch (tier) {
    case "default":
      return ctx.config.defaultModel;
    case "cheap":
      return ctx.config.cheapModel;
    case "hard":
      return ctx.config.hardModel;
  }
}

export async function structuredCall<T>(
  _ctx: AppContext,
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
