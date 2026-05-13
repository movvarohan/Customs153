# customs-agent

AI-native customs brokerage MVP for SMB US importers.

See [CLAUDE.md](./CLAUDE.md) for the full product vision, stack, and conventions.
**Read CLAUDE.md first** — it's the source of truth this codebase is structured around.

## Quick reference

- **Backend:** Cloudflare Workers (TypeScript, Hono)
- **Frontend:** Cloudflare Pages + Next.js (in `frontend/`, scaffold later)
- **Data:** D1, R2, KV, Vectorize, Queues, Durable Objects, Workflows
- **LLM:** Anthropic API (Sonnet 4.5 / Haiku 4.5 / Opus 4.7); Workers AI for cheap embeddings only

## First-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 3. Create the Cloudflare resources

Run each command. Each one prints an ID or confirmation — capture the D1 and KV
IDs and paste them into `wrangler.toml` where it says `REPLACE_WITH_...`.

```bash
npx wrangler d1 create customs-agent-db
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create customs-agent-docs
npx wrangler r2 bucket create customs-agent-reference
npx wrangler vectorize create hts-schedule --dimensions=768 --metric=cosine
npx wrangler vectorize create cbp-cross-rulings --dimensions=768 --metric=cosine
npx wrangler queues create classification-jobs
```

### 4. Apply the initial D1 migration

```bash
npm run db:migrate:local   # local dev D1
npm run db:migrate         # remote D1
```

### 5. Set secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# optional, only if/when CBP grants programmatic access:
# npx wrangler secret put CBP_CROSS_API_KEY
```

For local dev, copy `.env.example` to `.dev.vars` instead.

### 6. Run locally

```bash
npm run dev
```

Then `curl http://localhost:8787/health` — should return JSON with `ok: true`.

### 7. Type-check

```bash
npm run typecheck
```

## Project layout

```
src/
  workers/          # Hono routes (ingest, classify, audit, broker-review, webhooks)
  agents/           # LLM-driven agents (extractor, classifier, psc-finder, tariff-monitor)
  workflows/        # Cloudflare Workflows (shipment lifecycle)
  durable-objects/  # Per-shipment session DOs
  lib/              # anthropic, retrieval (HTS + CROSS), db, storage, cache, tariff-rates, citations
  types/            # Domain types + Env interface
  schemas/          # Zod schemas for LLM output / external boundary validation
scripts/            # One-off indexing jobs (HTS, CROSS, tariff rate seed)
evals/              # Classifier eval harness + gold-standard set
migrations/         # D1 SQL migrations
data/               # Raw HTS schedule + CROSS rulings + tariff rate tables (gitignored)
frontend/           # Next.js + Cloudflare Pages app (scaffolded later)
```

Every stub file references the relevant CLAUDE.md section in a `TODO` comment.

## Deploy

```bash
npm run deploy
```

## Conventions

See CLAUDE.md → "Conventions". Highlights:

- TypeScript strict mode; no `any`
- Zod-validate every external boundary (LLM output, uploads, DB reads)
- Monetary values in integer cents
- Every classification cites at least one source
- Every classifier change measured against the eval set before merging
