# customs-agent

**An AI-native customs operations layer for small and mid-sized US importers.**

Tariff complexity exploded in 2025–2026 (Section 301 expansions, reciprocal tariffs, de minimis elimination, Section 232 changes), 42% of CBP penalties stem from HTS misclassification, and there are only ~14,500 licensed customs brokers serving millions of importers. customs-agent does the work a broker does — classify goods, calculate landed duty, find overpaid duty in past entries, watch the regulatory feed — and pairs with a licensed broker who reviews and files. The AI does the labor; the licensed professional certifies.

> **Wedge:** Amazon FBA sellers, Shopify merchants, and DTC brands importing from China.
> **Pitch:** *"Send us your last 6 months of entries. We'll find duties you overpaid and classifications you should challenge — then handle your next shipment for the same price as your current broker, with full transparency."*

Track: **Automation / Agent Systems** (10 cooperating agents) with a **Domain-Specific** (customs / trade compliance) application surface.

The full product vision and long-term roadmap is in [`CLAUDE.md`](./CLAUDE.md). Submission materials (milestone, proposal, video script), architecture deep-dive, and source/credit list are in [`docs/`](./docs). This README is the operational entry point.

---

## The product, in one screen each

The web app (`frontend/`) has eight surfaces, all backed by the agent layer in `src/`:

| Surface | What it does | Agents involved |
|---|---|---|
| **Process invoice** | Drop the invoice + packing list + BL for one shipment → merged into one record → each line classified live (you watch the GRI reasoning stream token-by-token) → full landed-duty breakdown. Expand any line for: the **retrieved candidates** the agent saw, **tariff-engineering** alternatives, a **CBP focused-assessment defense** packet, a **CROSS-rulings cross-check**, and an **adversarial debate**. | extractor, classifier, duty-calculator, counterfactual, audit-defense, cross-verifier, debate |
| **Find refunds** | Upload 12 months of entries (JSON export **or** CBP Form 7501 PDFs) → re-classify every line → quantify recoverable duty → draft Post Summary Corrections → download a broker-facing PDF. Live progress + recoverable-so-far counter. | entry-summary-parser, classifier, duty-calculator, psc-finder |
| **Broker queue** | The licensed broker's view: a queue of agent classifications to confirm or correct. Corrections write to a **per-importer SKU memory** that becomes a prior on the next shipment — the system learns. | sku-memory |
| **Reg watch** | Watches the live Federal Register (CBP / USTR / USITC / Commerce); parses each rule for affected HTS codes, countries, and duty direction; flags which of the importer's SKUs are hit, with a dollar estimate. | tariff-monitor |
| **Audit broker** | A real Playwright browser signs into the ACE Importer Portal, pulls the entry summaries, and feeds them straight into the refund finder — no data entry. Falls back to a guided walkthrough if no browser is installed. | ace-browser-agent, psc-finder |
| **Methodology** | The measured results: accuracy on the CROSS-grounded gold set, confidence calibration, the v1→v3.2 prompt-evolution timeline, the Sonnet-vs-Opus bake-off, the retrieval diagnostic, and the experiments run. | — (surfaces eval data) |
| **Audit trail** | The immutable reasonable-care binder: every classification logged with timestamp, model + prompt version, GRI rule, confidence, cited sources, and full reasoning trace. | — (reads audit_log) |
| **About** | Problem framing, how it works, legal posture. | — |

Everything is also runnable from the CLI (`npm run process-invoice`, `npm run find-refunds`, `npm run eval:classifier`).

---

## How it works (architecture)

Clean / local-first / Cloudflare-later. `src/core/` is pure business logic that depends only on `src/interfaces/`; concrete infrastructure lives in `src/adapters/`; wiring happens only at the entry point. The eventual move to Cloudflare Workers is a port (add `src/adapters/cloudflare/` + `src/entry/worker.ts`), not a rewrite.

```
src/
├── core/
│   ├── agents/          # extractor, classifier, duty-calculator, psc-finder,
│   │   │                # entry-summary-parser, counterfactual, audit-defense,
│   │   │                # cross-verifier, debate, tariff-monitor, ace-browser-agent
│   │   └── prompts/      # versioned classifier prompts (v1 → v3.2, all kept on disk)
│   ├── routes/          # Hono routes — runtime-agnostic, AppContext-injected
│   ├── lib/             # tariff rates, FX, PDF renderer, SKU memory, retry, concurrency
│   ├── schemas/         # Zod schemas validating every LLM output + external boundary
│   └── app-context.ts   # the dependency bag every core function receives
├── interfaces/          # Database, BlobStorage, VectorStore, KeyValueCache, …
├── adapters/local/      # SQLite (libsql), filesystem, in-memory cache, Voyage embeddings
└── entry/cli.ts         # wires local adapters, serves Hono on Node

frontend/                # Next.js 15 + React 19 + Tailwind. Eight pages. Proxies /api.
evals/                   # 100-case CROSS-grounded gold set + harness + reports + summary
data/                    # HTS schedule, tariff rates, sample invoices/entries (committed)
scripts/                 # HTS fetch/index, sample generators, eval + seed runners
```

**The agent layer is reachable identically from the CLI, the HTTP API, and (eventually) a Worker.** The duty calculator is deterministic (no LLM in the money math). Every classification cites at least one retrieved source or it's rejected and retried. Every monetary value is an integer number of cents. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full data flow and design decisions.

---

## Results (measured, not asserted)

Full detail and the live view are on the **Methodology** page and in [`evals/`](./evals). Headline numbers, **Claude Opus 4.7**, prompt v3.2, on the 97-case post-audit gold set:

| Metric | Opus 4.7 | Sonnet 4.5 |
|---|---|---|
| Top-1 @ 8-digit | **64.9%** | 61.9% |
| Top-3 @ 8-digit | **75.3%** | 72.2% |
| Top-1 @ 6-digit | **69.1%** | 63.9% |
| Chapter-correct | **88.7%** | 86.6% |
| Citation grounding | **100%** | 99.0% |

**The gold set is the evidence backbone.** 100 cases (97 scored), each answer grounded in a **CBP CROSS binding ruling or unambiguous HTS text — never asserted from model judgment**. Verification status: 77 verified, 12 corrected (our own gold fixed against CROSS), 8 disputed (genuine CBP splits, scored with an accept-set), 3 unverifiable (held out of scoring). Built and audited via the CROSS API; see [`evals/GOLD_REVIEW.md`](./evals/GOLD_REVIEW.md) and [`evals/accept-set-audit.md`](./evals/accept-set-audit.md).

**What we measured beyond top-line accuracy:**
- **Prompt evolution v1 → v3.2**, each version scored before merge (`evals/v3.1-to-v3.2-report.md`). v3.2's "honest 6-digit fallback" — commit to the 6-digit subheading when the deciding attribute is absent from the description, instead of guessing the 8-digit line.
- **Model bake-off** — Opus vs Sonnet on the full set + refund samples (`evals/opus-vs-sonnet-report.md`).
- **Retrieval diagnostic** — of the 37 hardest failures, the correct code was in the top-50 retrieved candidates for 20 and missing for 17, telling us which errors are reasoning-bound vs retrieval-bound (`evals/retrieval-diagnostic.md`).
- **A verifier experiment we rejected** — a same-model second pass scored 5 rescues / 5 breaks (net zero), so we did not ship it; the CROSS-grounded verifier that brings *new* external evidence shipped instead (`evals/verifier-eval-report.md`).
- **Confidence calibration** — high-confidence classifications are right far more often than low, so the broker can triage on it.

Run it yourself: `npm run eval:classifier` writes a timestamped report to `evals/reports/`.

### Automated tests

```bash
npm test        # 22 tests, ~1s, no API keys or index required
```

[`tests/`](./tests) covers the deterministic core that the money and live-UI correctness depend on: the duty calculator's MPF clamping and HMF ocean-only logic and the **entry-level fee-cancellation property** the refund math relies on (`duty-fees.test.ts`); Section 301 / 232 / base-rate resolution (`tariff-rates.test.ts`); the streaming partial-JSON reasoning decoder that powers the live view (`classifier-stream.test.ts`); the per-importer SKU-memory learning loop against an in-memory database (`sku-memory.test.ts`); and the ACE portal replica (`mock-portal.test.ts`). They run keyless so anyone cloning the repo can verify the logic without the Anthropic/Voyage keys or the embedding index.

---

## Setup

### Prerequisites
- **Node 22+**
- **[Anthropic API key](https://console.anthropic.com/)** — Claude (Sonnet 4.5 default; Opus 4.7 for the highest accuracy)
- **[Voyage AI key](https://dashboard.voyageai.com/)** — voyage-3-large embeddings for HTS retrieval

### One-time setup
```bash
npm install
cp .env.example .env                 # set ANTHROPIC_API_KEY and VOYAGE_API_KEY
npm run db:migrate                   # apply the SQLite migration
npm run hts:fetch                    # download the USITC HTS schedule + notes (~6s)
npm run hts:index                    # embed the schedule into the local vector store
                                     #   ~10 min on paid Voyage; free tier works but is slow
npm --prefix frontend install
npm run setup:browser                # (optional) download Chromium for the live Audit-broker view
```

### Run — one forwarded port
```bash
npm run start                        # backend on :8787
npm --prefix frontend run dev        # frontend on :3000  (proxies /api to the backend)
```
Open <http://localhost:3000>. **The frontend proxies `/api/*` to the backend**, so only port 3000 needs to be reachable — no CORS, no second port to forward, works through any tunnel or preview URL.

Demo data is bundled: the **Broker queue** self-seeds a realistic catalog, and **Process invoice** / **Find refunds** each have a one-click "Load a sample" button, so the whole app is explorable immediately. CLI equivalents:
```bash
npm run process-invoice -- data/sample-invoices/shenzhen-electronics.pdf
npm run find-refunds    -- data/sample-entries/amazon-fba.json
```

---

## Known limitations (honest)

- **Retrieval is the current accuracy ceiling.** ~17 of the 37 hardest gold failures are cases the correct code was never retrieved into the top-50 — a bigger model doesn't fix those; chapter-note-aware re-indexing / hybrid search would. Documented in `evals/retrieval-diagnostic.md`.
- **Tariff-rate table is a demo subset.** `data/tariff-rates/2026.json` covers the common consumer-goods chapters explicitly; others fall back to a conservative default with a logged warning. Production pulls the full USITC rate table weekly.
- **MPF / HMF fees** are computed at the entry level (once on aggregate value), and **cancel out** of the refund math because they're identical under the filed and proposed code (verified across all 3 sample files). USMCA/FTA MPF exemptions are **not** modeled; mode of transport defaults to ocean for HMF and the assumption is surfaced, not hidden.
- **Reg watch** shows a set of importer-specific tracked alerts (representative tariff actions matched to the catalog) alongside the **live** Federal Register feed; the two are clearly separated in the UI.
- **Audit-broker portal** is a faithful local replica of ACE (real ACE has SSO + bot detection); production targets the live portal via Cloudflare Browser Rendering. The UI describes the agent's behavior, not a live federal integration.
- **Voyage free-tier rate limits** make the one-time HTS index slow (~hours); paid tier indexes in minutes. Runtime queries are tiny and free-tier-safe.

---

## AI-tool-usage disclosure

**This project was built end-to-end with [Claude Code](https://claude.com/product/claude-code)**, human-directed and AI-executed, over ~60 commits with a visible development history.

- **Human (author):** defined the product vision (`CLAUDE.md`), the architecture (clean / local-first / Cloudflare-later, agent-on-AppContext, Zod boundaries), the per-session cadence (scaffold → retrieval → classifier → extractor → PSC finder → frontend → 10 agents → eval rigor → polish), the eval methodology (CROSS-grounded gold, prompt versioning, no autonomous fixes after an eval run), and every "stop and report" boundary. Made every prompt-iteration call (v1 → v3.2), every "fix this / don't fix this" call after each eval, and every model and scope decision (e.g. keep Sonnet as the cost-default; reject the same-model verifier).
- **Claude Code (agent):** wrote all the code — TypeScript, Zod schemas, prompts, the 10 agents, PDF rendering, frontend, scripts, these docs — ran the agents and reported metrics, and surfaced failures honestly (Voyage rate limits, TLS clock-skew, classifier regressions, the 5:5 verifier result) rather than silently iterating.

A rough estimate: **~98% of the code lines were AI-generated and human-reviewed** live in the conversation. No base repository was forked; all dependencies are credited in [`docs/SOURCES.md`](./docs/SOURCES.md).

---

## Legal posture

**We are not a licensed customs broker.** customs-agent is an AI operations platform that pairs with a licensed customs broker partner who exercises responsible supervision and control under 19 CFR Part 111; all filings go through the broker under their license and ABI permit. No classification produced here is final until the broker signs off — the PDF report and every web finding say so. Scope is **US imports only** (no export/AES, no drawback, no FTZ, no C-TPAT).

---

## Troubleshooting

- **`Voyage TLS: certificate is not yet valid`** — sandbox clock skew. Set `VOYAGE_INSECURE_TLS=1` (Voyage calls only; never in production).
- **`Voyage 429`** — free-tier rate cap on the one-time index. Add a payment method, or use `HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index`.
- **Audit-broker "Executable doesn't exist…"** — no Chromium installed locally. Run `npm run setup:browser`, or just use it as-is — it falls back to a guided walkthrough that still pulls the entries and runs the refund finder.
- **Broker queue / Reg watch empty** — make sure you're viewing through `:3000` (the proxy); calling the backend cross-origin from a tunnel won't reach it. The broker queue self-seeds on first load.

See [`docs/`](./docs) for the architecture deep-dive, source credits, and submission materials.
