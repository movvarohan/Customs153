// Local EmbeddingProvider backed by Voyage AI. Defaults to voyage-3-large at
// 1024 dimensions. The same class is used for both indexing (input_type:
// "document") and querying (input_type: "query") — pick one per instance.
//
// Why Voyage: strong technical-retrieval quality, generous free tier, and
// it's what Anthropic recommends. When we eventually move embeddings to
// Workers AI, that becomes a separate adapter implementing EmbeddingProvider
// — no caller change.

import type { EmbeddingProvider } from "@/interfaces/embeddings";

const DEFAULT_MODEL = "voyage-3-large";
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BASE_URL = "https://api.voyageai.com/v1";
const MAX_BATCH = 128;

export type VoyageInputType = "document" | "query";

export interface VoyageEmbeddingOptions {
  apiKey: string;
  inputType: VoyageInputType;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens?: number };
  model?: string;
}

interface VoyageError {
  detail?: string;
  error?: { message?: string };
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly inputType: VoyageInputType;
  private readonly baseUrl: string;

  constructor(opts: VoyageEmbeddingOptions) {
    if (!opts.apiKey) throw new Error("VoyageEmbeddingProvider: apiKey is required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
    this.inputType = opts.inputType;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.callApi([text]);
    if (!vec) throw new Error("Voyage returned no embedding");
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const slice = texts.slice(i, i + MAX_BATCH);
      const vecs = await this.callApi(slice);
      out.push(...vecs);
    }
    return out;
  }

  private async callApi(inputs: string[]): Promise<number[][]> {
    const body = JSON.stringify({
      input: inputs,
      model: this.model,
      input_type: this.inputType,
      output_dimension: this.dimensions,
      truncation: true,
    });

    // Retry policy: 429 (rate limit) and 5xx are retryable with exponential
    // backoff that respects Retry-After when present. Free-tier Voyage caps
    // are tight (3 RPM, 10K TPM) so 429s are common during bulk indexing.
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
      });

      if (res.ok) {
        const parsed = (await res.json()) as VoyageResponse;
        const sorted = [...parsed.data].sort((a, b) => a.index - b.index);
        return sorted.map((d) => d.embedding);
      }

      const raw = await res.text();
      const detail = parseDetail(raw);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Voyage ${res.status}: ${detail}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoffMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60_000, 2000 * 2 ** (attempt - 1));
      console.warn(
        `[voyage] ${res.status} on attempt ${attempt}/${maxAttempts}; sleeping ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    }
    throw new Error("unreachable");
  }
}

function parseDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as VoyageError;
    return parsed.error?.message ?? parsed.detail ?? raw;
  } catch {
    return raw;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
