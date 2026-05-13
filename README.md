# customs-agent

AI-native customs brokerage MVP for SMB US importers.

See [CLAUDE.md](./CLAUDE.md) for the full product vision, architecture, and conventions. **Read it first** — every stub references the section of CLAUDE.md it implements.

## Architecture in one sentence

`src/core/` is pure business logic that depends only on `src/interfaces/`. `src/adapters/local/` provides the implementations for local dev (SQLite, filesystem, in-memory). `src/adapters/cloudflare/` will provide D1 / R2 / Vectorize / KV / Queues implementations later. The entry point in `src/entry/cli.ts` wires them together. Moving to Cloudflare is "add the adapters and a `worker.ts`" — the core does not change.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY

# 3. Apply migrations to the local SQLite database
npm run db:migrate

# 4. (One-time) Fetch and index the HTS schedule — see "Data setup" below
npm run hts:fetch
npm run hts:index

# 5. Run the dev server
npm run dev

# 6. Verify
curl http://localhost:8787/health
# → {"ok":true,"service":"customs-agent","environment":"development","timestamp":"..."}
```

The dev server hot-reloads via `tsx watch`. The SQLite file, vector indexes, and blob storage all live under `./.data/` (gitignored).

## Data setup

Retrieval-augmented classification needs an indexed copy of the US Harmonized Tariff Schedule. The three commands below are one-time per machine (re-run when USITC publishes a revision).

### 1. Get a Voyage API key

We use [Voyage AI](https://www.voyageai.com/) (`voyage-3-large`, 1024 dims) for embeddings — strong on technical retrieval, generous free tier, and what Anthropic recommends. Set the key in `.env`:

```
VOYAGE_API_KEY=pa-...
```

### 2. Fetch the schedule

```bash
npm run hts:fetch
```

Downloads the full HTS as JSON from USITC's public reststop endpoint into `data/hts/raw/hts-2026.json` (~15 MB, ~20k rows). Idempotent — re-running does nothing if the file is present.

### 3. Index it

```bash
npm run hts:index
```

Parses every tariff line (4-, 6-, 8-, 10-digit), composes an embedding text per chunk that includes the heading hierarchy and chapter context, embeds in batches of 128 via Voyage, and writes the result to `.data/vectors/hts.json`. Takes a few minutes; shows progress as it goes.

### 4. Verify retrieval

```bash
npm run hts:test
```

Runs ~10 hardcoded product descriptions (headphones, t-shirt, water bottle, lithium battery, etc.) against the index and prints the top-5 HTS codes per query with similarity scores. Eyeball the output — "wireless bluetooth headphones" should return the 8518 family, "cotton t-shirt" should return 6109, etc. This is a sanity check, not an eval. The real classifier eval (CLAUDE.md → "Eval methodology") comes later.

### Voyage free tier vs. paid

Without a payment method on file, Voyage caps usage at **3 requests/minute and 10,000 tokens/minute** for `voyage-3-large`. With the full HTS (~26,600 chunks × ~150 tokens ≈ 4 M tokens), that's **~3.5 hours wall time**. Add a payment method at https://dashboard.voyageai.com/ and the same job completes in **~5 minutes** at standard rate limits. The first 200 M tokens/month are free regardless.

The indexing script paces itself for the free tier by default. Two env vars tune it:

| Env var               | Default | Use for                                                |
|-----------------------|---------|--------------------------------------------------------|
| `HTS_BATCH_SIZE`      | `64`    | Set to `128` on paid Voyage for full throughput.       |
| `HTS_BATCH_PAUSE_MS`  | `21000` | Set to `0` on paid Voyage.                             |

The adapter retries 429 / 5xx with exponential backoff that honors `Retry-After`, so a run will eventually complete even if you under-pace.

### `HTS_MAX_LEVEL` — smoke-test convenience

```bash
HTS_MAX_LEVEL=6 npm run hts:index
```

Filters the corpus to chunks whose HTS code has at most N digits (4, 6, 8, or 10). Useful for getting retrieval working end-to-end on free-tier Voyage in 15–25 minutes (4- + 6-digit ≈ 3,000 chunks) before committing to a full ~26 K index. **Production indexing must run unfiltered.** Without the full 8- and 10-digit chunks, the classifier cannot reach the 10-digit precision CBP requires.

## Troubleshooting

### `Voyage TLS: certificate is not yet valid`

Some sandboxes (including Claude Code's web runner) generate ephemeral TLS certs whose `notBefore` is a fraction of a second after the shell clock. Node's `https` rejects them; curl is slow enough to dodge it. Setting

```bash
VOYAGE_INSECURE_TLS=1 npm run hts:index
```

disables certificate verification **for Voyage calls only** (via a per-request `rejectUnauthorized: false` in `src/adapters/local/voyage-embedding.ts`). Every other HTTPS call in the codebase still verifies normally.

Never set this in production. It's a clock-skew workaround for sandboxes — if you see it on a real server you have a clock or PKI problem to fix, not a flag to flip.

## Project layout

```
src/
  core/                # business logic — depends only on src/interfaces
    agents/            # extractor, classifier, duty-calculator, psc-finder, tariff-monitor
    routes/            # Hono routes (runtime-agnostic; injected with AppContext)
    lib/               # anthropic wrapper, HTS/CROSS retrieval, citation grounding, tariff rates
    types/             # domain entities + job payloads
    schemas/           # Zod schemas for LLM output / external boundary validation
    app-context.ts     # the dependency bag every core function receives
  interfaces/          # Database, BlobStorage, VectorStore, KeyValueCache,
                       # BackgroundQueue, EmbeddingProvider, BrowserAutomation
  adapters/
    local/             # SQLite (libsql), filesystem, in-memory cache/queue,
                       # local vector store, stub embeddings + browser
    cloudflare/        # added later
  entry/
    cli.ts             # local dev — wires local adapters, serves via @hono/node-server

scripts/               # migrate, index-hts, index-cross, seed-tariff-rates
evals/                 # classifier eval harness + gold-standard set
migrations/            # SQL migrations (currently 0001_initial.sql)
data/                  # raw HTS schedule, CROSS rulings, tariff tables (gitignored)
frontend/              # Next.js app (scaffolded later)
```

## Adding a new adapter (when you migrate to Cloudflare)

1. Drop a file under `src/adapters/cloudflare/`, e.g. `d1-db.ts`, that implements `Database`.
2. Repeat for `R2BlobStorage`, `VectorizeStore`, `KvCache`, `CloudflareQueue`, etc.
3. Add `src/entry/worker.ts` that builds an `AppContext` from the Workers `Env` and serves the same `buildApp(ctx)` Hono app.
4. Add a `wrangler.toml` with the bindings.

No file in `src/core/` should change.

## Conventions

See CLAUDE.md → "Conventions". Highlights:

- TypeScript strict mode; no `any`
- `src/core/` may not import from `src/adapters/` or any concrete infra package
- Zod-validate every external boundary
- Monetary values in integer cents
- Every classification cites at least one source
- Every classifier change measured against the eval set before merging

## Scripts

```bash
npm run dev              # start local server with hot reload
npm run start            # start once (no reload)
npm run typecheck        # tsc --noEmit
npm run db:migrate       # apply migrations/*.sql to local SQLite
npm run hts:fetch        # download USITC HTS JSON to data/hts/raw/
npm run hts:index        # parse + embed (Voyage) + write vector index
npm run hts:test         # sanity-check retrieval with sample product descriptions
npm run index:cross      # (stub) embed CROSS rulings
npm run seed:rates       # (stub) load tariff rate table into cache
npm run eval:classifier  # (stub) run classifier against gold-standard set
```
