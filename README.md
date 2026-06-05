# Customs Agent Suite

An AI-assisted operations platform for US importers. It classifies goods under the
Harmonized Tariff Schedule, computes landed duty, identifies overpaid duty on past
entries, screens parties against federal compliance lists, and surfaces sourcing
alternatives. A licensed customs broker reviews and files the resulting work product;
the platform does not transact with CBP directly.

Live application: https://frontend-mu-ashen-13.vercel.app

Architecture deep-dive: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
Source credits and references: [`docs/SOURCES.md`](./docs/SOURCES.md)
Long-term product spec: [`CLAUDE.md`](./CLAUDE.md)

## Contents

1. [Overview](#overview)
2. [Technology stack](#technology-stack)
3. [Architecture](#architecture)
4. [Setup](#setup)
5. [Usage](#usage)
6. [API reference](#api-reference)
7. [Evaluation](#evaluation)
8. [Known limitations](#known-limitations)
9. [Roadmap](#roadmap)
10. [AI assistance](#ai-assistance)
11. [References and acknowledgements](#references-and-acknowledgements)
12. [Security and data handling](#security-and-data-handling)
13. [License](#license)
14. [Legal posture](#legal-posture)

## Overview

US tariff policy changed substantially in 2025-2026 (Section 301 expansions, reciprocal
tariffs, de minimis elimination, Section 232 changes). Importers face two structural
constraints. First, classifying merchandise under the Harmonized Tariff Schedule is a
legal exercise that follows the General Rules of Interpretation; CBP attributes roughly
42 percent of penalties to classification error. Second, the licensed-broker labor
pool is small (approximately 14,000 active licenses nationwide), so the expertise is
expensive and difficult to scale.

This project addresses both constraints. The platform performs the analytical and
drafting work that a customs broker would otherwise do by hand — extraction from
shipping documents, classification, duty calculation, refund identification, party
screening, sourcing analysis — and routes the output to a licensed broker for review
and signature. 19 CFR Part 111 requires the broker to exercise responsible supervision
and control over customs business, so the broker remains in the loop; the platform
does not file entries directly.

Eleven foundation-model agents are wired through a clean architecture with typed
interfaces between business logic and infrastructure. Fourteen pages comprise the web
UI. A 100-case benchmark grounded in CBP CROSS rulings evaluates the classifier. Sample
invoices, sample entry-summary PDFs, sample historical entries, and the three
screening lists are committed so the repository runs offline after the one-time HTS
schedule index.

### Web surfaces

| Page | Purpose |
|---|---|
| `/process-invoice` | Upload an invoice, packing list, or bill of lading. The extractor produces a structured shipment record; the classifier runs each line under the GRI procedure (reasoning streams token-by-token); the duty calculator produces a landed-cost breakdown. Per-line expansions show the retrieved HTS candidates, tariff-engineering alternatives, a CBP focused-assessment defense packet, a CROSS rulings cross-check, and the adversarial debate transcript for hard codes. |
| `/find-refunds` | Accepts 12 months of historical entries as JSON export or CBP Form 7501 PDFs. Re-classifies every line, quantifies recoverable duty, drafts Post Summary Corrections, and renders a broker-facing PDF. |
| `/risk` | Standalone screen for an importer and its suppliers against OFAC SDN, BIS Entity List, UFLPA, and active AD/CVD cases. Returns a structured `RiskProfile` with citations to the underlying public sources. |
| `/broker` | The broker's review queue. Each line surfaces the classifier's full reasonable-care record: product facts used, tariff notes considered, CBP rulings cited, and why competing codes were rejected. Confirmations write to a per-importer SKU memory used as a prior on future shipments. |
| `/coordination` | One timeline per shipment. The coordinator agent drafts outreach (channel recommendation, subject, body, call talk track) and the panel exposes email, call, and text action buttons. Email uses `mailto:` and text uses `sms:` to launch the user's local clients with the draft prefilled. |
| `/deadlines` | PSC and protest windows sorted by what expires next. |
| `/simulator` | Tariff what-if analysis across the catalog (reciprocal scenarios, Section 301 stack, country reroute). |
| `/catalog`, `/factory-finder` | Sourcing research grounded in World Bank country profiles and live web search. |
| `/regulatory` | Federal Register monitoring with importer-specific impact attribution. |
| `/audit-broker` | Playwright-driven session against an ACE Importer Portal replica. |
| `/methodology` | Benchmark results, prompt-evolution history, model bake-off, retrieval diagnostic. |
| `/audit-trail` | The reasonable-care binder: every classification logged with timestamp, model and prompt version, GRI rule, confidence, citations, and reasoning. |
| `/copilot` | Conversational interface backed by the same retrieval and classification pipeline. |

## Technology stack

Runtime and language. TypeScript 5.7 in strict mode throughout. Node.js 22 runs the
backend via `tsx`. The codebase compiles with zero `any` annotations; external
boundaries are validated with Zod schemas.

Backend. Hono 4 on `@hono/node-server` for HTTP routing. The framework was chosen
because the same handler runs on Node today and on Cloudflare Workers tomorrow
without modification. `@libsql/client` provides a file-backed SQLite implementation
of the `Database` interface; the same calls work against Cloudflare D1. PDFKit
renders the refund report. Playwright (`playwright-core`) drives the ACE replica.
The Anthropic SDK is the only LLM client; Voyage AI is called via `fetch`.

Frontend. Next.js 15 (App Router) with React 19 and Tailwind CSS. Server components
are used where they reduce client-side JavaScript; the dynamic surfaces (Process
Invoice, Find Refunds, Risk, Copilot) are client components that consume NDJSON
streams from the API. The frontend proxies `/api/*` to the backend so a single port
is exposed in production. Deployed to Vercel.

AI and retrieval. Claude Sonnet 4.5 is the default reasoning model; Opus 4.7 is used
for the highest-accuracy classifier runs and the model bake-off; Haiku 4.5 handles
cheaper tool-using agents (coordinator, regulatory monitor). Tool-use with structured
input schemas is the contract for every classification — free-text LLM output never
reaches a downstream consumer. Voyage AI's `voyage-3-large` produces 1024-dimensional
embeddings; the schedule and rulings are indexed once and stored in a local vector
file (~88 MB) that is interchangeable with Cloudflare Vectorize.

Storage. SQLite via libsql for transactional state (`audit_log`, `sku_master`,
`filings`, `customers`). Filesystem for blobs (`./.data/docs`, `./.data/reference`).
A JSON-backed local vector store (`src/adapters/local/local-vector-store.ts`) for
embeddings. In-memory implementations of the cache and background-queue interfaces.
Each is swappable for the corresponding Cloudflare service by adding the adapter
under `src/adapters/cloudflare/` and changing one wire-up line in `src/entry/`.

Tooling. `vitest` for unit tests (22 tests, ~1 s, no API keys required). `tsx` for
the entry points. `playwright-core` for the browser-automation paths. PDFKit and
`ffmpeg-static` (used in earlier demo generation) for static artifacts. The frontend
ships its own `tsc --noEmit` and `next lint` gates.

Data on disk. The committed `data/` directory holds the artifacts the platform
reads: the USITC HTS schedule (chapters 01-99, ~5 MB), the indexed CBP CROSS
rulings, a versioned tariff-rate snapshot, sample invoices and entry-summary PDFs
for the demo flows, and the three federal screening lists (`data/risk/`). The
one-time HTS index is the only artifact built locally rather than committed; see
[Setup](#setup).

## Architecture

The codebase enforces a hard separation between business logic and infrastructure.
Source files in `src/core/` may import from `src/core/` and `src/interfaces/` only.
Concrete infrastructure — `@libsql/client`, the filesystem, embedding APIs — lives in
`src/adapters/` and is injected at the entry point. The eventual move to Cloudflare
Workers, D1, R2, and Vectorize is intended as a port rather than a rewrite.

```
src/
  core/
    agents/        Eleven agents: extractor, classifier, duty-calculator,
                   psc-finder, sourcing-intel, reroute-intel, factory-finder,
                   factory-deepdive, tariff-monitor, coordinator, copilot,
                   risk-screener. Plus cross-verifier, debate, counterfactual,
                   audit-defense as classification support.
      prompts/     Versioned classifier prompts (v1 through v3.2) retained on disk.
    routes/        Hono routes; runtime-agnostic, take AppContext.
    lib/           Tariff rates, FX, PDF rendering, SKU memory, retry, concurrency,
                   research loop, broker queue, risk-data loader.
    schemas/       Zod schemas at every external boundary (LLM output, HTTP, DB).
    app-context.ts The injection container.
  interfaces/      Database, BlobStorage, VectorStore, KeyValueCache, BackgroundQueue,
                   EmbeddingProvider, BrowserAutomation.
  adapters/local/  SQLite (libsql), filesystem, in-memory cache and queue, local
                   vector store, Voyage embeddings, stub browser.
  entry/cli.ts     Wires local adapters and serves Hono on Node.

frontend/          Next.js 15, React 19, Tailwind. Fourteen pages, proxies /api.
evals/             100-case gold set, harness, reports.
data/
  hts/, hts-schedule/     USITC HTS schedule and notes.
  cross-rulings/          CBP CROSS rulings indexed for retrieval.
  tariff-rates/           Versioned snapshot of duty rates.
  sample-invoices/        Generated invoices for the demo flow.
  sample-entries/         Generated entry sets for the refund finder.
  risk/                   OFAC SDN, BIS Entity List, UFLPA, AD/CVD cases, XUAR regions.
scripts/           HTS fetch and index, sample generators, eval runner, seeds.
tests/             22 unit tests covering the deterministic core; no API keys required.
```

### Design notes

The duty calculator is deterministic: base rate, Section 301, Section 232, MPF, HMF,
all computed in integer cents with no LLM involvement. This guarantees the dollar
figures are exact and auditable.

The classifier output is structured. A tool-use schema forces the model to emit
step-by-step GRI reasoning, the rule applied, citations from the retrieved candidate
set, alternatives considered with rejection reasons, missing-input notes, precision
level (6/8/10 digit), and confidence, in that order. The model must produce the
reasoning before committing to a code. Cited codes are validated against the retrieved
candidate set; a non-matching citation triggers a single retry with an explicit
reminder, then surfaces as a `validation_warning` rather than silently failing.

Broker corrections write to a per-importer SKU memory table. On subsequent
classification calls for the same description, the prior decision is injected into
the classifier prompt as authoritative if broker-confirmed, or as a weak hint if
agent-only. This is the learning loop and per-customer moat described in
[`CLAUDE.md`](./CLAUDE.md).

The risk screener is deterministic. Names are normalised (lowercase, strip corporate
suffixes, drop punctuation) and matched via trigram Jaccard similarity against three
in-memory tables loaded from `data/risk/`. Matches are bucketed into exact (similarity
≥ 0.99), fuzzy (≥ 0.85), and partial (≥ 0.70). Every output finding carries a citation
with source, source ID, refresh date, and quote.

All monetary values are integer cents. All timestamps are UTC ISO 8601. Code in
`src/core/` never imports a concrete infrastructure package.

## Setup

The repository runs end-to-end on a local machine with no external services beyond
the two LLM and embedding APIs. The web app, the CLI, and the test suite all use
the same code path; the test suite runs without any API keys at all.

### Prerequisites

- Node.js 22 or newer (`node --version` to check).
- An Anthropic API key. Sign up at <https://console.anthropic.com/> and create a key
  under Settings → API Keys. Claude Sonnet 4.5 is the default model; the platform
  also supports Opus 4.7 and Haiku 4.5 via environment variables (see
  [Configuration](#configuration)).
- A Voyage AI API key. Sign up at <https://dashboard.voyageai.com/> and create a key
  under API Keys. The free tier is sufficient to run the one-time HTS schedule index
  (slower) and all runtime queries.

The two keys are required only at runtime — they are read from environment variables
and never persisted to disk or committed.

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/movvarohan/Customs153.git
cd Customs153
npm install
npm --prefix frontend install
```

Copy the environment template and add your keys:

```bash
cp .env.example .env
# Edit .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   VOYAGE_API_KEY=pa-...
```

Initialize the database and the HTS retrieval index. This is a one-time step; the
resulting files live under `./.data/` and are gitignored.

```bash
npm run db:migrate            # apply the SQLite schema (instant)
npm run hts:fetch             # download the USITC HTS schedule from the official source (~6 s)
npm run hts:index             # embed the schedule into the local vector store
                              # paid Voyage plan: ~10 minutes
                              # free tier (rate-limited): up to several hours
npm run setup:browser         # optional, only if you want the live ACE replica
```

### Configuration

The platform reads its configuration from environment variables. Sensible defaults
are set in `.env.example`; override only what you need.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Claude API access |
| `VOYAGE_API_KEY` | required | Embedding API access |
| `DEFAULT_MODEL` | `claude-sonnet-4-5` | Model used by the classifier and most agents |
| `CHEAP_MODEL` | `claude-haiku-4-5-20251001` | Coordinator, regulatory monitor, low-stakes paths |
| `HARD_MODEL` | `claude-opus-4-7` | Available for highest-accuracy classifier runs |
| `PORT` | `8787` | Backend listening port |
| `DATA_DIR` | `.data` | Local data directory (DB, vectors, blobs) |
| `ENABLE_VERIFIER` | unset | Set to `1` to run the CROSS-grounded verifier on every classification |
| `WORKFLOW_INTERVAL_MS` | `30000` | Background scheduler cadence |
| `VOYAGE_INSECURE_TLS` | unset | Set to `1` only if your environment has clock skew (see Troubleshooting) |
| `HTS_BATCH_SIZE`, `HTS_BATCH_PAUSE_MS` | unset | Throttle the one-time HTS index on free-tier Voyage |

### Running

In two separate terminals:

```bash
npm run start                          # terminal 1: backend on :8787
npm --prefix frontend run dev          # terminal 2: frontend on :3000
```

Open <http://localhost:3000>. Only port 3000 needs to be reachable from a browser;
the frontend proxies `/api/*` to `:8787` server-side, so there is no CORS surface
and no second port to forward.

### Verifying the install

```bash
npm test                               # 22 unit tests, ~1 s, no API keys required
curl http://localhost:8787/            # the backend health summary
```

The web app self-seeds: the Broker queue populates a starter SKU catalog on first
load, Process Invoice has a "Load sample" button, Find Refunds accepts the bundled
`data/sample-entries/amazon-fba.json`. If you can complete the Find Refunds flow on
that sample file and download the rendered PDF, the install is working end-to-end.

### Troubleshooting

`Voyage TLS: certificate is not yet valid` — usually clock skew inside a sandbox
or container. Setting `VOYAGE_INSECURE_TLS=1` disables TLS verification for the
Voyage calls only and is acceptable as a workaround during local development.

`Voyage 429` — the free tier rate-limits aggressively during the one-time index.
Use `HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index` to slow the
indexer down; the runtime queries are small enough that the free tier handles
them comfortably.

`Executable doesn't exist...` from the Audit-broker page — Chromium is not
installed locally. Run `npm run setup:browser`, or skip the install entirely; the
page detects the missing binary and falls back to a guided walkthrough.

Empty Broker queue or Reg Watch panel — verify you are viewing through port 3000
rather than calling the API directly. The frontend proxies `/api/*` server-side; a
cross-origin call to `:8787` from a remote tunnel will not reach the backend.

## Usage

The web application is the primary interface. Every agent is also reachable from the
CLI for scripting and grading:

```bash
npm run process-invoice -- data/sample-invoices/shenzhen-electronics.pdf
npm run find-refunds    -- data/sample-entries/amazon-fba.json
npm run risk:screen     -- data/sample-entries/amazon-fba.json
npm run eval:classifier
npm test
npm run risk:fetch                         # refresh OFAC, BIS, UFLPA lists from upstream
```

`npm run eval:classifier` writes a timestamped report to `evals/reports/`.
`npm test` runs the 22 keyless unit tests in under a second.

## API reference

The backend exposes 44 HTTP endpoints under `/api/`. Bodies are JSON unless noted;
streaming responses use NDJSON. The complete set is in `src/core/routes/api.ts`; the
endpoints below are the ones a grader or integrator is likely to call directly.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/process-invoice` | Streams extraction → classification → duty events for an invoice or BL. Multipart upload. |
| `POST` | `/api/find-refunds` | Streams classification events for a HistoricalEntries body (or multipart of 7501 PDFs); final event includes the PSC findings and the risk profile. |
| `POST` | `/api/render-refund-pdf` | Takes a `PSCFindings` body, returns the rendered PDF. |
| `POST` | `/api/risk/screen` | Takes either a full HistoricalEntries body or `{importer, importer_ein, suppliers, country_of_origin, hts_codes}`; returns a `RiskProfile`. |
| `GET`  | `/api/broker/queue` | The licensed-broker review queue for the demo customer. |
| `POST` | `/api/broker/confirm`, `/correct` | Broker corrections; write back to per-importer SKU memory. |
| `GET`  | `/api/audit-log` | The last N classifications with their structured trace. |
| `GET`  | `/api/audit-log/:id` | One classification record by ID. |
| `GET`  | `/api/methodology` | The accuracy table, model bake-off, retrieval diagnostic, and experiment log. |
| `GET`  | `/api/deadlines`, `/api/coordination` | Per-entry liquidation/PSC/protest tracking and per-shipment coordination state. |
| `POST` | `/api/coordination/draft` | Drafts outreach (email body, subject, call script, SMS) for a shipment. |
| `GET`  | `/api/workflow`, `POST /api/workflow/run` | Background scheduler state and a manual run trigger. |

All schemas (request and response) are defined in `src/core/schemas/`. Every LLM
output is validated against a Zod schema before it leaves the agent that produced
it, and the same schemas are used to type the HTTP boundary.

## Evaluation

The classifier is evaluated against a 100-case benchmark constructed from CBP CROSS
binding rulings. Of the 100 cases, 97 are scored: 77 were verified directly against a
published ruling, 12 were corrected after the initial gold answer was found to be
wrong, 8 are disputed cases scored against an accept-set rather than a single answer,
and 3 were excluded as unverifiable. See [`evals/GOLD_REVIEW.md`](./evals/GOLD_REVIEW.md)
and [`evals/accept-set-audit.md`](./evals/accept-set-audit.md) for the audit.

Results on the post-audit 97-case set under prompt v3.2:

| Metric | Opus 4.7 | Sonnet 4.5 |
|---|---|---|
| Top-1 at 8-digit | 64.9% | 61.9% |
| Top-3 at 8-digit | 75.3% | 72.2% |
| Top-1 at 6-digit | 69.1% | 63.9% |
| Chapter correct | 88.7% | 86.6% |
| Citation grounding | 100% | 99.0% |

Citation grounding is enforced by the validation step rather than measured after the
fact; 99 percent on Sonnet reflects a small number of runs where the validation
warning was attached rather than the run rejected.

Auxiliary studies in [`evals/`](./evals):

- `v3.1-to-v3.2-report.md` — each prompt iteration scored before merge. The largest
  improvement came from the v3.2 honest 6-digit fallback, which directs the model to
  commit at the 6-digit subheading when the attribute distinguishing 8-digit lines
  (e.g. value tier, fiber content) is not present in the input.
- `opus-vs-sonnet-report.md` — head-to-head on the gold set plus the refund samples.
- `retrieval-diagnostic.md` — of the 37 hardest failures, 20 had the correct code in
  the top-50 retrieved candidates (reasoning failures), and 17 did not (retrieval
  failures). This distinguishes errors a better prompt can fix from errors requiring
  a better retriever.
- `verifier-eval-report.md` — a same-model second-pass verifier was evaluated and not
  shipped: it produced 5 rescues and 5 breaks on the gold set, net zero. A separate
  CROSS-grounded verifier that introduces new external evidence is the one in
  production.

The risk screener is deterministic and citation-grounded by design. Each finding
includes a `citation` with `source`, `source_id`, `source_date`, and `quote` from the
matched row. The three federal lists, an AD/CVD case index, and an XUAR region map
are committed in [`data/risk/`](./data/risk) so demonstrations run offline;
`npm run risk:fetch` retrieves the upstream public sources. The matching thresholds
(exact 0.99, fuzzy 0.85, partial 0.70) are documented in `src/core/lib/risk-data.ts`.

### Tests

`tests/` covers the deterministic core that the money calculation depends on. The
suite runs in approximately one second and requires no API keys or vector index:

- `duty-fees.test.ts` — MPF clamping (FY2026 floor $33.58, ceiling $651.50), HMF
  ocean-only logic, and the entry-level fee-cancellation property used by the
  refund math.
- `tariff-rates.test.ts` — base rate, Section 301, and Section 232 resolution.
- `classifier-stream.test.ts` — partial-JSON decoder that drives the live-reasoning UI.
- `sku-memory.test.ts` — per-importer learning loop against an in-memory database.
- `mock-portal.test.ts` — the ACE Importer Portal replica used in the Audit-broker flow.

## Known limitations

The retrieval step is the current accuracy ceiling. Approximately 17 of the 37
hardest gold-set failures involve the correct code not appearing in the top-50
retrieved candidates. A larger model does not address these failures; chapter-note-
aware re-indexing or hybrid lexical-plus-vector retrieval would.

The tariff-rate table at `data/tariff-rates/2026.json` covers the common consumer-
goods chapters explicitly. Other chapters fall back to a conservative default with a
logged warning. Production deployment would pull the full USITC table on a weekly
schedule.

Entry-level fees (MPF, HMF) are computed once on the aggregate entered value, not per
line. They cancel out of the refund math because they are identical under the filed
and proposed codes for any given entry. USMCA and other FTA MPF exemptions are not
modeled. Mode of transport defaults to ocean when absent, and the assumption is
surfaced in the report.

The Audit-broker page targets a local replica of the ACE Importer Portal. The real
portal uses SSO and bot detection; production targets the live portal via Cloudflare
Browser Rendering.

The product has not been deployed to paying customers. Claims about what the system
does are reproducible from the repository. Claims about commercial outcomes (refund
recovery rates, etc.) are framed as the product motion, not measured customer results.

## Roadmap

Engineering work that would precede a production release:

1. The benchmark becomes a required CI check; no prompt or model change ships unless
   it beats the previous best score.
2. Model routing: a smaller model on classifications with a clear retrieval-score
   margin and high self-reported confidence, a frontier model on the rest. Prompt
   caching for the shared GRI system prompt.
3. Direct ACE Importer Portal access so the historical audit becomes self-serve. The
   importer connects their CBP account; the refund finder runs against the last two
   years of entries automatically.

The longer-term research direction is making classification provably correct. Each
classification today cites a CBP ruling that supports the answer and is cross-checked
against live precedent at review time. The next step is moving from "the answer cites
a relevant precedent" to "the legal procedure that produced the answer is itself
machine-checkable." The General Rules of Interpretation are a formal decision
procedure. A symbolic encoding of one HTS chapter — Chapter 85 (electronics) is a
reasonable pilot — combined with the chapter and section notes would let the
classifier emit a proof that GRI 1 was applied before GRI 3, that essential-character
analysis ran in the right order, and that exclusions were checked. Outcome data from
broker confirmation and CBP liquidation would then close the loop with reinforcement
learning on the ten-month-delayed signal. Neither of these is feasible without
operational scale, which is what makes them defensible work for later.

## AI assistance

This project was built using Claude Code (Anthropic's command-line coding agent) as
the primary implementation tool. The authoring split was roughly as follows.

The author set the product scope (`CLAUDE.md`), the architecture, the per-session
plan of work, the evaluation methodology, and the decision points throughout: each
prompt iteration, the rejection of the same-model verifier, the model and concurrency
defaults, the framing of the reasonable-care record as four explicit pillars, and the
boundaries on autonomy. Decisions were made in dialogue, not delegated.

Claude Code wrote the TypeScript implementation, the Zod schemas, the agent prompts,
the PDF renderer, the Next.js frontend, the unit tests, the data-fetching scripts,
the documentation files, and these README sections. It ran agents and reported
results, surfaced failures (Voyage rate limits, libsql foreign-key enforcement, the
verifier negative result) rather than working around them silently, and revised work
in response to feedback.

A reasonable estimate is that approximately 98 percent of the code lines were
AI-generated and human-reviewed. The commit history (`git log --oneline`) shows the
session-level cadence and the decision points; commit messages describe units of
work that were discussed before they ran.

No upstream repository was forked. The product, architecture, prompts, agents,
evaluation methodology, frontend, and documentation are original to this project.
Third-party dependencies (Hono, Next.js, React, Tailwind, Zod, libsql, Playwright,
pdfkit) are credited in `package.json` and `frontend/package.json` and discussed in
[`docs/SOURCES.md`](./docs/SOURCES.md).

## References and acknowledgements

A comprehensive list is in [`docs/SOURCES.md`](./docs/SOURCES.md). The principal
public sources used by the platform:

- Harmonized Tariff Schedule of the United States, US International Trade Commission.
  Retrieved via the official USITC dump and indexed locally.
- CBP CROSS (Customs Rulings Online Search System) binding rulings. Used as the
  ground truth for the classifier benchmark and as live precedent in the verifier.
- OFAC Specially Designated Nationals list, US Treasury Office of Foreign Assets
  Control. A representative subset is committed; `npm run risk:fetch` retrieves the
  current ~12,000-row file.
- BIS Entity List, US Bureau of Industry and Security, retrieved via the trade.gov
  consolidated screening list endpoint.
- UFLPA Entity List, US Department of Homeland Security Forced Labor Enforcement
  Task Force.
- World Bank country profiles, used by the sourcing engine for labor and
  manufacturing context.
- Federal Register, monitored by the Reg Watch agent for CBP, USTR, USITC, and
  Commerce rules.
- Anthropic Claude (Sonnet 4.5, Opus 4.7, Haiku 4.5) for reasoning; Voyage AI
  `voyage-3-large` for embeddings.

The legal framework for the AI-plus-broker design is 19 CFR Part 111
(Customs Brokers).

## Security and data handling

API keys are read from environment variables at runtime and are never written to
disk or committed. The repository ships a `.env.example` template; `.env` itself is
gitignored. Outbound calls are made to two third-party services (Anthropic, Voyage)
plus the public datasets listed in [References](#references-and-acknowledgements);
all other traffic is local.

The `audit_log` table records every classification with its full reasoning trace, the
candidates retrieved, the model and prompt version, and the timestamp. This is the
reasonable-care record required under 19 CFR Part 111. The table is append-only by
convention; production deployment would enforce that at the database level.

Personally identifiable information is limited to importer name, EIN (optional), and
supplier names. Nothing is sent to a third-party service that the customer has not
already shared with CBP or a public list. The risk-screening lists are public; the
matching is local.

## License

This project was developed as a final project for CS 153 at Stanford. No license has
been applied; rights are reserved by the author. Inquiries about reuse can be sent
through the GitHub repository.

## Legal posture

This software is not a licensed customs broker. It is an analysis and decision-support
platform that operates in partnership with a licensed broker who exercises responsible
supervision and control under 19 CFR Part 111. All filings go through the broker
under their license and ABI permit. A classification produced here is not final until
the broker signs off; this disclaimer appears on the rendered PDF and on every
finding in the UI. Scope is US imports only; export filings (AES), drawback, FTZ, and
C-TPAT are out of scope.
