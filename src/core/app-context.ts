// The bag of injected dependencies every core function receives.
// Built by an entry point (cli.ts today, worker.ts later) from its adapter set.
// Core code depends only on this and the interfaces it points at.

import type Anthropic from "@anthropic-ai/sdk";
import type {
  Database,
  BlobStorage,
  VectorStore,
  KeyValueCache,
  BackgroundQueue,
  EmbeddingProvider,
  BrowserAutomation,
} from "@/interfaces";
import type { ClassificationJob } from "./types/jobs";

export interface AppConfig {
  environment: "development" | "staging" | "production";
  defaultModel: string;
  cheapModel: string;
  hardModel: string;
}

export interface AppContext {
  db: Database;

  // Customer uploads (invoices, packing lists, BOLs, generated PDFs).
  docs: BlobStorage;
  // HTS schedule + CROSS rulings cache.
  reference: BlobStorage;

  htsIndex: VectorStore;
  crossIndex: VectorStore;

  cache: KeyValueCache;
  classificationQueue: BackgroundQueue<ClassificationJob>;

  embeddings: EmbeddingProvider;
  browser: BrowserAutomation;

  anthropic: Anthropic;

  config: AppConfig;
}
