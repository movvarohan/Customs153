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

# 4. Run the dev server
npm run dev

# 5. Verify
curl http://localhost:8787/health
# → {"ok":true,"service":"customs-agent","environment":"development","timestamp":"..."}
```

The dev server hot-reloads via `tsx watch`. The SQLite file and blob storage live under `./.data/` (gitignored).

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
npm run index:hts        # (stub) embed HTS schedule into local vector store
npm run index:cross      # (stub) embed CROSS rulings
npm run seed:rates       # (stub) load tariff rate table into cache
npm run eval:classifier  # (stub) run classifier against gold-standard set
```
