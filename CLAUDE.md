# AI-Native Customs Brokerage MVP

## What we're building

An AI-powered customs operations layer for small and mid-sized US importers (target wedge: Amazon FBA sellers, Shopify merchants, and DTC brands importing from China). The product replaces the manual work a licensed customs broker does, while pairing with a licensed broker partner for legal filing and signature.

The pitch to importers: "Send us your last 6 months of entries. We'll find duties you overpaid and classifications you should challenge. Then we'll handle your next shipment for the same price as your current broker, but with full transparency and proactive tariff optimization."

## Why now

- Tariff complexity has exploded in 2025–2026: Section 301 expansions, reciprocal tariffs, de minimis elimination, UFLPA enforcement, Section 232 changes
- 42% of CBP penalties stem from HTS misclassification
- Only ~14,500 licensed customs brokers in the US serve millions of importers; the talent pool is constrained
- Existing AI players target enterprise or sell tools to existing brokers; nobody owns the SMB importer experience end-to-end
- The licensed-broker bottleneck creates a defensible "AI does the work, licensed professional certifies" model

## Core product surfaces

### 1. Document ingestion
Importer forwards shipping documents (commercial invoice, packing list, bill of lading, mill test certificates, ISF data) via email or upload. We extract structured line items: description, quantity, unit value, country of origin, manufacturer, material composition, intended use.

### 2. HTS classification agent
For each line item, we:
- Retrieve relevant HTS chapter notes, headings, and binding rulings from a Vectorize index
- Apply General Rules of Interpretation (GRI 1 through 6) in legal order
- Produce a 10-digit HTS code with full citation: HTS schedule paragraphs and CBP CROSS ruling numbers
- Flag Section 301, 232, 201, anti-dumping/countervailing duty exposure
- Identify FTA preference eligibility (USMCA primarily; others as we scale)
- Surface alternative codes considered and why they were ruled out

Every classification must be defensible under CBP "reasonable care" standards. No classification ships without at least one cited source.

### 3. Duty calculator
Given the classification + country of origin + customs value, compute total landed duty:
- Base ad valorem rate
- Section 301 add-ons (China)
- Section 232 add-ons (steel/aluminum/derivatives)
- Reciprocal tariffs (2025 framework)
- Anti-dumping/countervailing duties where applicable
- Merchandise Processing Fee (MPF)
- Harbor Maintenance Fee (HMF)
- FTA preference savings if eligible

### 4. Entry draft generation
Produce a draft CBP Form 7501 entry summary plus ISF (10+2) data. The draft is structured for licensed-broker review, not for direct filing in the MVP.

### 5. Licensed broker review interface
Our broker partner receives a queue of entries to review. Each entry shows:
- Agent's classification with full reasoning trace
- Confidence score per line item
- Flagged uncertainties for human attention
- One-click approve, one-click correct
- Corrections feed back into a per-customer SKU memory so the agent learns

### 6. Filing handoff
For the MVP, the licensed broker partner submits the approved entry through their existing ABI/ACE software. Post-MVP we build direct ACE integration once we have our own filer permit.

### 7. Duty refund / Post Summary Correction (PSC) finder — HERO FEATURE
The single most important feature for sales. Given an importer's historical entries (typically 6–24 months, sourced via CBP ACE Importer Portal export or broker handoff), the agent:
- Reclassifies every line item from scratch using current methodology
- Flags every entry where the original classification appears wrong, missed an FTA preference, missed a Section 301 exclusion, or overpaid via wrong valuation method
- Quantifies recoverable duty per entry
- Drafts Post Summary Corrections and protests where applicable
- Produces a savings report: "We found $X in recoverable duties across Y entries; here's the breakdown"

This is the wedge that converts importers from their existing broker to us.

### 8. Proactive tariff monitoring
A continuously running agent that:
- Watches the Federal Register, CBP CSMS messages, USTR exclusion publications, FMC notices
- Identifies which of our customers' active SKUs are affected by each change
- Drafts customer outreach: "Section 301 exclusion XYZ was just published. Your product (HTS 8518.30.20) qualifies. Here's the savings forecast. Want us to file the request?"

### 9. Per-customer SKU master database
A structured knowledge base of every SKU we've ever classified for a given importer: HTS code, GRI rule applied, citations, classification date, who reviewed it, any corrections. Same SKU classified the same way every shipment. This data flywheel is our long-term moat.

### 10. Audit trail and reasonable-care documentation
Every classification, every duty calculation, every change is logged with timestamps, sources, model versions, and reviewer identity. This is the audit binder if CBP ever conducts a focused assessment on one of our customers.

## Customer journey (target wedge: Amazon FBA seller importing from China)

1. Acquisition: We offer a free historical entry audit. They send us their last 6 months of entries (Excel export from their current broker or ACE portal).
2. Audit: We produce a savings report within 48 hours showing recoverable duties. Typical finding: 5–15% of total duties paid.
3. Conversion: If the audit finds material savings, they let us handle their next shipment.
4. Onboarding: We index their SKU catalog into the per-customer master database.
5. Recurring: Each new shipment runs through the pipeline, broker review, and filing within hours instead of days.
6. Retention: Proactive tariff monitoring generates additional savings over time. Their per-customer SKU database becomes increasingly valuable.

## Architecture: local-first, Cloudflare-later

We build behind interfaces from day one so the eventual move to Cloudflare is a port, not a rewrite. Today we run on Node + SQLite + the filesystem. Later we add a `src/adapters/cloudflare/` directory and a `src/entry/worker.ts`. The business logic in `src/core/` does not change.

```
src/
├── core/                # pure business logic; depends only on interfaces/
│   ├── agents/          # extractor, classifier, duty-calculator, psc-finder, tariff-monitor
│   ├── routes/          # Hono routes; take AppContext, runtime-agnostic
│   ├── lib/             # retrieval, citations, anthropic wrapper
│   ├── types/           # domain entities (Shipment, LineItem, Classification, …)
│   ├── schemas/         # Zod schemas for LLM output / external boundaries
│   └── app-context.ts   # the bag of injected adapters every agent receives
├── interfaces/          # Database, BlobStorage, VectorStore, KeyValueCache,
│                        # BackgroundQueue, EmbeddingProvider, BrowserAutomation
├── adapters/
│   ├── local/           # SQLite (libsql), filesystem, in-memory cache + queue,
│                        # local vector store, stub embeddings + browser
│   └── cloudflare/      # added later: D1, R2, Vectorize, KV, Queues, Browser Rendering
└── entry/
    ├── cli.ts           # current entry — `tsx src/entry/cli.ts`
    └── worker.ts        # added later
```

**Rule:** code in `src/core/` may import only from `src/core/` and `src/interfaces/`. It may **not** import from `src/adapters/` or any concrete infra package (`@libsql/client`, `fs`, `cloudflare:workers`). Wiring happens at the entry point only.

## Long-term target stack (post-MVP)

- **Cloudflare Workers** (TypeScript, Hono) for backend APIs
- **Cloudflare Pages + Next.js** for frontend (importer dashboard + broker review UI)
- **D1** for relational data → adapter for the `Database` interface
- **R2** for document storage → adapter for the `BlobStorage` interface (two buckets: docs + reference)
- **Vectorize** for HTS + CROSS embeddings → adapter for the `VectorStore` interface
- **Workflows** for multi-step shipment lifecycle (ingest → extract → classify → calc duty → broker review → file → liquidation tracking → PSC scan)
- **Durable Objects** for per-shipment stateful sessions and per-customer agent memory
- **KV** for caching tariff rates → adapter for `KeyValueCache`
- **Queues** for async fan-out → adapter for `BackgroundQueue`
- **Browser Rendering** for scraping CBP CROSS, USTR exclusions, FMC notices → adapter for `BrowserAutomation`
- **Workers AI** for cheap embeddings (BGE) only → adapter for `EmbeddingProvider`
- **Anthropic API** (Claude Sonnet 4.5 default; Haiku 4.5 cheap; Opus 4.7 hardest) — works identically locally and on Workers; not abstracted

## Current (local) stack

- **Node 22** runtime, run via `tsx src/entry/cli.ts`
- **Hono** + `@hono/node-server` for HTTP
- **SQLite** via `@libsql/client` (file-backed; API matches D1 closely)
- **Filesystem** for blob storage under `./.data/docs` and `./.data/reference`
- **In-memory** vector store + cache + queue
- **Anthropic SDK** for LLM calls (same as production)

## Conventions

- TypeScript strict mode everywhere
- Hono for HTTP routing (works on Node today, Workers later)
- `src/core/` imports only from `src/core/` and `src/interfaces/`. Never from `src/adapters/` or concrete infra packages.
- Zod for runtime validation at every external boundary (uploads, API responses, LLM outputs, DB reads)
- All LLM outputs validated against Zod schemas; if invalid, retry with structured output enforcement
- All external IO through typed interfaces with explicit error types
- No `any`; if a type is unknown, use `unknown` and narrow
- Every HTS classification must cite at least one source (HTS paragraph or CBP ruling)
- Every monetary value in cents (integer), never floats
- All timestamps in UTC ISO 8601
- Error handling is explicit — no silent catches
- Eval harness is a first-class output, not an afterthought; every classifier change must be measured against the eval set before merging

## Eval methodology

We build a gold-standard eval set from CBP CROSS rulings. Each ruling has a product description and a legally correct HTS classification. We hold out a test set, run our agent on each description, and report:
- Top-1 accuracy (10-digit code exact match)
- Top-1 accuracy at 8-digit (statistical suffix often legitimately varies)
- Top-3 accuracy
- Citation grounding rate (% of classifications that cite an actual ruling that exists)
- Per-chapter accuracy breakdown (some HTS chapters are harder than others)

Target for MVP: >80% top-1 at 8-digit, >90% top-3 at 8-digit, 100% citation grounding rate.

## Out of scope for MVP

- Direct ACE/ABI filing (we hand off to a licensed broker partner)
- Multi-country imports (US only)
- Real-time tariff rate API (we maintain a versioned KV-backed table updated weekly)
- Export work (US Census/AES filings)
- Drawback claims (a future expansion)
- Foreign trade zones
- C-TPAT certification workflows

## Compliance and legal posture

- We are NOT a licensed customs broker. We are an AI operations platform that pairs with a licensed broker.
- All filings go through our broker partner under their license and ABI permit.
- We carry professional liability and cyber insurance once we have paying customers.
- We comply with 19 CFR Part 111 by ensuring the licensed broker exercises responsible supervision and control of customs business.
- We never tell a customer their classification is final; the licensed broker's signature is what makes it final.

## Long-term moat (not MVP, but informs decisions)

1. Per-customer SKU master databases: the longer they're with us, the more their catalog is classified, the higher the switching cost
2. Eval set quality: our gold-standard eval grows with every broker correction and becomes proprietary training data
3. Tariff change response speed: being first to surface a new exclusion for an affected customer is genuinely valuable
4. Network of broker partners: as we scale, more brokers want to plug in as the filing layer
5. Eventually: our own brokerage license and ABI permit, bringing filing in-house at higher margin

## Stretch goals if MVP goes well

- Self-serve onboarding with automatic ACE Importer Portal data pull
- Multi-broker routing (route filings to whichever partner broker is fastest/cheapest for the port)
- Real-time shipment status sync with major carriers
- Drawback claim automation
- AES export filings
- Expansion to EU customs (different schema entirely; meaningful re-architecture)
