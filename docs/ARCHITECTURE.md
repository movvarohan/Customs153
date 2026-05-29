# Architecture

## Layering (clean / local-first / Cloudflare-later)

```
                 CLI (src/entry/cli.ts)          HTTP API (Hono)            [later] Worker
                          \                          |                          /
                           \                         |                         /
                            ─────────────►  src/core/app-context.ts  ◄────────
                                            (the injected dependency bag)
                                                     │
              ┌──────────────────────────────────────────────────────────────────┐
              │  src/core/  — PURE business logic, imports only src/interfaces/    │
              │                                                                    │
              │   agents/   classifier · extractor · duty-calculator · psc-finder  │
              │             entry-summary-parser · counterfactual · audit-defense  │
              │             cross-verifier · debate · tariff-monitor · ace-browser │
              │   routes/   Hono handlers (AppContext-injected, runtime-agnostic)  │
              │   lib/      tariff-rates · fx · render-refund-pdf · sku-memory      │
              │   schemas/  Zod — validates every LLM output + external boundary    │
              └──────────────────────────────────────────────────────────────────┘
                                                     │  (interfaces only)
              ┌──────────────────────────────────────────────────────────────────┐
              │  src/interfaces/  Database · VectorStore · BlobStorage ·           │
              │                   KeyValueCache · EmbeddingProvider · …            │
              └──────────────────────────────────────────────────────────────────┘
                                                     │
              ┌──────────────────────────────────────────────────────────────────┐
              │  src/adapters/local/  SQLite(libsql) · filesystem · in-mem cache · │
              │                       local vector store · Voyage embeddings        │
              │  src/adapters/cloudflare/   (later) D1 · R2 · Vectorize · KV        │
              └──────────────────────────────────────────────────────────────────┘
```

**Enforced rule:** `src/core/` may import only from `src/core/` and `src/interfaces/` — never from `src/adapters/` or a concrete infra package. Wiring happens once, at the entry point. This is why the same agent code runs from the CLI, the HTTP API, and (eventually) a Cloudflare Worker with no change, and why the Cloudflare migration is "add an adapter set + a worker entry," not a rewrite.

## Request flow — Process invoice

```
PDF(s) ──► extractor (Claude, native PDF) ──► one ExtractedShipment (Zod-validated)
            │  merges invoice + packing list + BL into a single shipment
            ▼
        for each line item (concurrency 5):
            ├─ embed description (Voyage) ──► query HTS vector store ──► top-50 candidates
            ├─ classifier (Claude tool-use): walk GRI 1–6, cite ≥1 candidate, stream reasoning
            │      └─ citation not in candidate set? reject + retry once
            ├─ SKU memory lookup ──► inject a broker-confirmed prior if present
            ├─ duty-calculator (deterministic): base + 301 + 232, per-line
            └─ emit NDJSON: reasoning_delta · line_retrieval · line_classified · line_duty
        ▼
   entry-level MPF + HMF computed once on aggregate value ──► done
```

Optional on-demand per line (from the UI): **counterfactual** (tariff-engineering alternatives, each priced by the deterministic calculator), **audit-defense** (simulated CBP focused-assessment Q&A), **cross-verifier** (live CROSS-rulings check), **debate** (advocate / challenger / judge).

## Request flow — Find refunds

```
HistoricalEntries JSON  ──┐
CBP Form 7501 PDFs ──► entry-summary-parser ──┘──► psc-finder
                                                    ├─ re-classify each line (same classifier)
                                                    ├─ duty under filed code vs predicted code
                                                    │     (entry-level MPF/HMF cancel out)
                                                    ├─ recoverable = filed − predicted, sorted
                                                    └─ low-confidence → broker-review bucket
                                                          ▼
                                              render-refund-pdf (shared with the CLI)
```

## Key design decisions

- **Deterministic money math.** No LLM touches the duty calculation — rates come from a versioned table; the LLM only supplies the classification and country. This makes the recoverable figure auditable and reproducible.
- **Citations or it doesn't ship.** The classifier must cite a retrieved candidate; ungrounded citations are rejected and retried. Citation grounding is a tracked metric (100% with Opus).
- **Integer cents everywhere.** No floats in monetary values.
- **Versioned prompts as artifacts.** `classifier-system.{v1,v2,v3,v3.1,v3.2}.ts` are all on disk; the active one is a re-export. Every version was scored on the gold set before becoming active.
- **The gold set is external truth.** Answers are grounded in CBP CROSS rulings, not model judgment. The eval harness is treated as a first-class output, not an afterthought.
- **Per-importer SKU memory as the moat.** Broker corrections persist and become priors — the same SKU is classified the same way on every future shipment, and switching cost rises with catalog coverage.
- **Frontend proxies `/api`.** The browser only ever talks to the frontend origin (`next.config.mjs` rewrites), so one port runs everything and NDJSON streaming works through any tunnel.

## Tech stack

Node 22 · TypeScript (strict) · Hono + `@hono/node-server` · SQLite via `@libsql/client` (D1-compatible) · Voyage `voyage-3-large` embeddings · Anthropic SDK (Claude Sonnet 4.5 / Opus 4.7) · Next.js 15 + React 19 + Tailwind 3.4 · Playwright (browser agent) · pdfkit (report rendering) · Zod (runtime validation).
