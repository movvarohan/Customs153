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
2. [Architecture](#architecture)
3. [Setup](#setup)
4. [Usage](#usage)
5. [Evaluation](#evaluation)
6. [Known limitations](#known-limitations)
7. [Roadmap](#roadmap)
8. [AI assistance](#ai-assistance)
9. [References and acknowledgements](#references-and-acknowledgements)
10. [Legal posture](#legal-posture)

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

### Prerequisites

- Node.js 22 or newer
- An [Anthropic API key](https://console.anthropic.com/) (Claude Sonnet 4.5 default;
  Opus 4.7 used for higher-accuracy runs)
- A [Voyage AI API key](https://dashboard.voyageai.com/) for the `voyage-3-large`
  embedding model

### Installation

```bash
npm install
cp .env.example .env                       # set ANTHROPIC_API_KEY and VOYAGE_API_KEY
npm run db:migrate                         # apply the SQLite schema
npm run hts:fetch                          # download the USITC tariff schedule (~6 s)
npm run hts:index                          # embed the schedule into the local vector store
                                           # (~10 min on a paid Voyage plan; the free tier
                                           # works but is rate-limited)
npm --prefix frontend install
npm run setup:browser                      # optional: install Chromium for the ACE replica
```

### Running

```bash
npm run start                              # backend on :8787
npm --prefix frontend run dev              # frontend on :3000 (proxies /api to :8787)
```

Open <http://localhost:3000>. The frontend proxies `/api/*` to the backend, so only
port 3000 needs to be exposed externally. The broker queue seeds itself on first
load. Process Invoice and Find Refunds each ship with a one-click sample loader.

### Troubleshooting

- `Voyage TLS: certificate is not yet valid` — sandbox clock skew. Set
  `VOYAGE_INSECURE_TLS=1` for Voyage calls only.
- `Voyage 429` — rate cap on the free tier during the one-time index. Use
  `HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index`.
- ACE-broker page reports `Executable doesn't exist…` — Chromium is not installed.
  Run `npm run setup:browser`, or use the page as-is — it falls back to a guided
  walkthrough.
- Broker queue or Reg watch panels appear empty — confirm you are viewing through
  port 3000 (the proxy). Direct cross-origin calls to `:8787` from a tunnel will not
  reach the API.

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

## Legal posture

This software is not a licensed customs broker. It is an analysis and decision-support
platform that operates in partnership with a licensed broker who exercises responsible
supervision and control under 19 CFR Part 111. All filings go through the broker
under their license and ABI permit. A classification produced here is not final until
the broker signs off; this disclaimer appears on the rendered PDF and on every
finding in the UI. Scope is US imports only; export filings (AES), drawback, FTZ, and
C-TPAT are out of scope.
