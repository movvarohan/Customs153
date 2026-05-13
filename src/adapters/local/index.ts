// Factory: build an AppContext from local adapters. Called by src/entry/cli.ts.

import path from "node:path";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig, AppContext } from "@/core/app-context";
import type { ClassificationJob } from "@/core/types/jobs";
import { SqliteDatabase } from "./sqlite-db";
import { FilesystemStorage } from "./filesystem-storage";
import { LocalVectorStore } from "./local-vector-store";
import { InMemoryCache } from "./in-memory-cache";
import { InProcessQueue } from "./in-process-queue";
import { StubEmbeddingProvider } from "./stub-embeddings";
import { StubBrowser } from "./stub-browser";

export interface LocalContextOptions {
  dataDir: string;
  anthropicApiKey: string;
  config: AppConfig;
}

export async function buildLocalContext(opts: LocalContextOptions): Promise<AppContext> {
  await fs.mkdir(opts.dataDir, { recursive: true });

  const db = await SqliteDatabase.open(`file:${path.join(opts.dataDir, "customs.db")}`);
  const docs = await FilesystemStorage.open(path.join(opts.dataDir, "docs"));
  const reference = await FilesystemStorage.open(path.join(opts.dataDir, "reference"));
  const htsIndex = await LocalVectorStore.open(path.join(opts.dataDir, "vectors/hts.json"));
  const crossIndex = await LocalVectorStore.open(path.join(opts.dataDir, "vectors/cross.json"));
  const cache = new InMemoryCache();

  const classificationQueue = new InProcessQueue<ClassificationJob>(async (job) => {
    // TODO(CLAUDE.md §2 + "Queues"): invoke classifier agent for this line item.
    console.log("[queue] classification job received:", job);
  });

  const embeddings = new StubEmbeddingProvider(768);
  const browser = new StubBrowser();
  const anthropic = new Anthropic({ apiKey: opts.anthropicApiKey });

  return {
    db,
    docs,
    reference,
    htsIndex,
    crossIndex,
    cache,
    classificationQueue,
    embeddings,
    browser,
    anthropic,
    config: opts.config,
  };
}
