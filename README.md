# Customs Agent Suite

**An AI-native customs operations layer for US importers — classifies goods, calculates landed duty, finds overpaid duty in past entries, vets sourcing alternatives, and watches the regulatory feed, paired with a licensed broker who reviews and files. The AI does the labor; the licensed professional certifies.**

> **One-line pitch for an importer:** *"Send your last six months of entries. The refund finder reclassifies every line, surfaces what's recoverable, and flags the deadline before it expires — then we handle your next shipment for the same price as your current broker, with full transparency."*

🎥 **Demo video:** `customs-agent-demo.mp4` (in the repo) · [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) is the teleprompter cut.
📐 **Architecture deep-dive:** [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · **Source credits:** [`docs/SOURCES.md`](./docs/SOURCES.md) · **Product spec:** [`CLAUDE.md`](./CLAUDE.md)

---

## Why this project (Problem & Insight)

In 2026 the United States collects **over $80 billion a year in tariffs**, and **more than $2 billion a year in refunds importers are legally owed go unclaimed** — because claiming them is complicated, expensive, and bound by deadlines that quietly expire (CBP trade statistics; duty-drawback specialist reports cited in [`docs/SOURCES.md`](./docs/SOURCES.md)). Two structural facts make this genuinely hard, and they're what this project was built to address:

1. **Customs classification is legal reasoning, not lookup.** Every imported good gets a 10-digit Harmonized Tariff Schedule (HTS) code that's applied under the **General Rules of Interpretation** — a formal six-rule legal decision procedure — against thousands of pages of chapter notes, section notes, and **CBP binding rulings**. **Forty-two percent of customs penalties come from a wrong code.** It's the same kind of work a junior attorney does on a tax return, not a database lookup.
2. **The expertise can't scale.** There are only about **14,000 licensed customs brokers in the entire country** serving millions of importers (per the Customs Broker License Examination program). The talent pool is genuinely constrained.

**The constraint I designed around:** you can't *legally* remove the licensed broker — 19 CFR Part 111 requires responsible supervision and control over customs business. But you can let the AI do the work and have the broker certify it. That single design choice is what makes a defensible product possible: this isn't a chatbot pretending to replace a broker, it's an operations platform that pairs with one.

**Why this is original and ambitious:** the existing customs-tech market sells either (a) enterprise tools to in-house Fortune-500 trade departments, or (b) productivity tools to existing brokers. Nobody owns the importer's end-to-end experience for the long tail — the millions of mid-sized manufacturers, Amazon FBA brands, and DTC merchants who don't have a Fortune-500-grade trade compliance team. And nobody has built the **strategic intelligence layer** that's actually useful in 2025–2026: classification alone isn't enough when reciprocal tariffs, Section 301 expansions, and de minimis elimination change the math every month — you also have to know *what to do about it.* This project ships both: the classification pipeline **and** the Policy Lab, sourcing engine, Factory Finder, Reg Watch, and refund-finder layered on top.

---

## What was built (Execution)

Ten foundation-model agents wired through a clean architecture, eight web surfaces, a 100-case CBP-grounded benchmark, and a CLI mirror — all runnable locally, with sample data bundled so the whole thing is explorable in five minutes.

### Web surfaces

| Surface | What it does | Agents |
|---|---|---|
| **Process invoice** | Drop an invoice / packing list / bill of lading → one shipment record → each line classified live (GRI reasoning streams token-by-token) → full landed-duty breakdown. Expand any line for the retrieved candidates, tariff-engineering alternatives, a CBP focused-assessment defense packet, a live CROSS rulings check, and an adversarial debate transcript. | extractor, classifier, duty-calculator, counterfactual, audit-defense, cross-verifier, debate |
| **Find refunds** | Upload 12 months of entries (JSON export *or* CBP Form 7501 PDFs). The agent re-classifies every line, quantifies recoverable duty, drafts Post Summary Corrections, and renders a broker-facing PDF report. Live progress + recoverable-so-far counter. | entry-summary-parser, classifier, duty-calculator, psc-finder |
| **Broker queue** | The licensed broker's view: agent classifications to confirm or correct, sorted by duty stakes. Expand any line for the **Reasonable-care record** — the four legal steps the agent followed (product facts used, tariff notes considered, CBP rulings cited, why competing codes were rejected) plus the GRI rule, confidence, and reasoning. Corrections write to a **per-importer SKU memory** that becomes a strong prior the next time the same product ships — the system learns. | sku-memory |
| **Policy Lab** | A what-if simulator: pick a scenario (Universal 10% reciprocal · Section 301 + reciprocal stack · Reshore to Vietnam · etc.) and instantly re-run the duty math across the whole catalog. Shows landed-cost delta, margin impact, and per-SKU exposure. | tariff-rates, duty-calculator |
| **Catalog / Sourcing engine** | For a product, where could production move and what would it cost? Live web research names real factories in candidate countries, grounds labor cost in **World Bank country profiles**, and renders a **landed-cost map** comparing total cost across origins. | sourcing-intel, reroute-intel |
| **Factory Finder** | Deep dive on a single product + country: research specific named factories, their capabilities, certifications, capacity, whether they're taking new clients, and a tactical-bridge-vs-long-term-partner fit. Drafts the outreach email. | factory-finder, factory-deepdive |
| **Coordination** | One timeline per shipment keeping the importer, the licensed broker, and the freight forwarder aligned — every status change, every flag, every deadline. | coordinator |
| **Deadlines** | A live ticker of PSC and protest windows by entry, sorted by what expires next, with the recoverable-dollar amount at stake. So nothing recoverable quietly expires. | psc-finder |
| **Reg Watch** | Monitors the live Federal Register feed (CBP / USTR / USITC / Commerce), parses each rule for affected HTS codes / countries / duty direction, and flags which of the importer's SKUs are hit with a dollar estimate. | tariff-monitor |
| **Audit-broker** | A real Playwright browser signs into the ACE Importer Portal, pulls the entry summaries, and feeds them straight into the refund finder — no manual data entry. Falls back to a guided walkthrough if no browser is installed. | ace-browser-agent, psc-finder |
| **Methodology** | The benchmark results live: accuracy, confidence calibration, the v1→v3.2 prompt-evolution timeline, the Sonnet-vs-Opus bake-off, the retrieval diagnostic, and a list of experiments tried and rejected. | — (surfaces eval data) |
| **Audit trail** | The immutable reasonable-care binder: every classification logged with timestamp, model + prompt version, GRI rule, confidence, cited sources, and full reasoning trace — explicitly rendered as the four legal pillars. This is the binder you hand CBP if they open a focused assessment. | — (reads audit_log) |
| **Copilot** | Conversational interface over the whole system. Ask "what's the HTS code and landed duty for Bluetooth earbuds from China" and get a cited answer pulled through the same retrieval + GRI pipeline. | copilot, classifier, duty-calculator |

Everything is also runnable from the CLI: `npm run process-invoice`, `npm run find-refunds`, `npm run eval:classifier`.

### Architecture (clean / local-first / Cloudflare-later)

```
src/
├── core/              # pure business logic — depends only on src/interfaces/
│   ├── agents/        # ten agents (extractor, classifier, duty-calculator, refund-finder,
│   │   │              #   sourcing-intel, factory-finder, factory-deepdive, reg-watch,
│   │   │              #   coordinator, copilot) + cross-verifier + debate + counterfactual
│   │   └── prompts/   # versioned classifier prompts (v1 → v3.2, all kept on disk)
│   ├── routes/        # Hono routes — runtime-agnostic, AppContext-injected
│   ├── lib/           # tariff rates, FX, PDF renderer, SKU memory, retry/concurrency,
│   │                  #   research loop, broker queue, seeds
│   ├── schemas/       # Zod schemas validating every LLM output and external boundary
│   └── app-context.ts # the dependency bag every core function receives
├── interfaces/        # Database, BlobStorage, VectorStore, KeyValueCache, BackgroundQueue,
│                      #   EmbeddingProvider, BrowserAutomation
├── adapters/local/    # SQLite (libsql), filesystem, in-memory cache + queue,
│                      #   local vector store, Voyage embeddings, stub browser
└── entry/cli.ts       # wires local adapters, serves Hono on Node

frontend/              # Next.js 15 + React 19 + Tailwind. Twelve pages. Proxies /api.
evals/                 # 100-case CBP-CROSS-grounded gold set + harness + reports
data/                  # HTS schedule, tariff rates, sample invoices/entries (committed)
scripts/               # HTS fetch/index, sample generators, eval + seed runners
tests/                 # 22 keyless unit tests on the deterministic core
```

**Key architectural choices.** Code in `src/core/` may import only from `src/core/` and `src/interfaces/` — never from `src/adapters/` or concrete infra packages (`@libsql/client`, `cloudflare:workers`). Wiring happens only at the entry point. **The duty calculator is deterministic** — no LLM in the money math, so dollar amounts are always exact, auditable, and never hallucinated. **Every classification cites at least one retrieved source** or it's rejected and retried — 100% citation grounding by construction. **Every monetary value is an integer number of cents.** All timestamps are UTC ISO 8601. The eventual move to Cloudflare Workers is a port (add `src/adapters/cloudflare/` + `src/entry/worker.ts`), not a rewrite.

### How the classifier works (research/method)

This is not a model I trained. It's a **retrieval-augmented, evaluation-driven** system with a per-customer learning loop:

1. **Retrieve.** The product description is embedded with Voyage-3-large and the top-50 most semantically similar HTS codes are pulled from a local vector store (`LocalVectorStore`, swappable to Cloudflare Vectorize). The full U.S. tariff schedule and tens of thousands of CBP binding rulings are indexed.
2. **Reason under GRI.** The model is forced (via a structured tool-use schema) to emit a step-by-step reasoning trace following the **six General Rules of Interpretation in order**, an explicit GRI-rule field, citations from the retrieved candidate set, alternatives considered with rejection reasons, missing-input notes, and a confidence level — *before* committing to a 10-digit code (field order matters — see `src/core/agents/classifier.ts:43-110`).
3. **Validate.** A Zod schema validates the output. **Every cited code must be in the retrieved candidate set** — if not, retry once with an explicit reminder; if still invalid, attach a `validation_warning` to the result. **100% citation grounding is a contract, not a hope.**
4. **Cross-check.** Optional verifier agent independently reads the predicted code's full HTS text + chapter notes and disagrees if the predicted criteria aren't supported by the description. Disagreement triggers a revision and caps confidence at "medium."
5. **Adversarial debate (for the hardest codes).** An advocate argues for the predicted code, a challenger attacks it citing alternatives, a judge rules.
6. **Persist.** The full trace (candidates, prompt, response, validation, verifier outcome) is written to `audit_log` for the reasonable-care binder.
7. **Learn.** A licensed-broker correction writes back into a **per-customer SKU memory**, so the same product is classified the same way every shipment — and broker-confirmed priors become strong hints to the classifier the next time it runs.

Everything is **deterministic where it can be** (the duty math, the retrieval ranking, the validation) and **structured where it can't be** (the model's reasoning is constrained to a tool-use schema, not free text).

---

## Evaluation & Evidence

A gold-standard benchmark is the backbone of every claim. Full detail and the live view are on the **Methodology** page and in [`evals/`](./evals).

### Headline accuracy (97-case post-audit gold set, prompt v3.2)

| Metric | Opus 4.7 | Sonnet 4.5 |
|---|---|---|
| Top-1 @ 8-digit | **64.9%** | 61.9% |
| Top-3 @ 8-digit | **75.3%** | 72.2% |
| Top-1 @ 6-digit | **69.1%** | 63.9% |
| Chapter-correct | **88.7%** | 86.6% |
| **Citation grounding** | **100%** | 99.0% |

Run it yourself: `npm run eval:classifier` writes a timestamped report to `evals/reports/`.

### The gold set is built honestly — and that matters

100 cases (97 scored), each answer **grounded in a CBP CROSS binding ruling or unambiguous HTS schedule text — never asserted from model judgment.** The audit:

- **77 verified** — answer cross-checked against a real published CROSS ruling
- **12 corrected** — the gold itself was wrong; the original answer was fixed against CROSS
- **8 disputed** — genuine CBP splits (same product, different rulings in different ports); scored with an **accept-set** rather than a single answer
- **3 unverifiable** — held out of scoring rather than counted

Detail: [`evals/GOLD_REVIEW.md`](./evals/GOLD_REVIEW.md), [`evals/accept-set-audit.md`](./evals/accept-set-audit.md).

### What was measured beyond top-line accuracy

- **Prompt evolution v1 → v3.2**, each version scored before merge ([`evals/v3.1-to-v3.2-report.md`](./evals/v3.1-to-v3.2-report.md)). The biggest single jump came from v3.2's **"honest 6-digit fallback"** — telling the model to commit at the 6-digit subheading when the deciding attribute (e.g. value tier, fiber-content percentage) is genuinely missing from the description, instead of guessing the 8-digit line.
- **Model bake-off** — Opus 4.7 vs Sonnet 4.5 on the full gold set and the refund samples ([`evals/opus-vs-sonnet-report.md`](./evals/opus-vs-sonnet-report.md)).
- **Retrieval diagnostic** — of the 37 hardest failures, the correct code was in the top-50 retrieved candidates for **20** of them and **missing for 17** — telling me which errors are reasoning-bound (improvable with a better prompt or model) vs retrieval-bound (require a better retriever) ([`evals/retrieval-diagnostic.md`](./evals/retrieval-diagnostic.md)).
- **A verifier experiment I rejected.** A same-model second pass scored **5 rescues / 5 breaks (net zero)**, so I didn't ship it; instead I shipped a different verifier — the CROSS-grounded one that brings *new* external evidence ([`evals/verifier-eval-report.md`](./evals/verifier-eval-report.md)). This is the kind of result that I'd be tempted to bury and instead chose to surface.
- **Confidence calibration** — high-confidence classifications are right far more often than low-confidence ones, so the licensed broker can triage on it.

### Automated tests

```bash
npm test        # 22 tests, ~1s, no API keys or index required
```

[`tests/`](./tests) covers the **deterministic core that the money depends on**: the duty calculator's MPF clamping and HMF ocean-only logic and the **entry-level fee-cancellation property** the refund math relies on (`duty-fees.test.ts`); Section 301 / 232 / base-rate resolution (`tariff-rates.test.ts`); the streaming partial-JSON reasoning decoder that powers the live UI (`classifier-stream.test.ts`); the per-importer SKU-memory learning loop against an in-memory database (`sku-memory.test.ts`); and the ACE portal replica (`mock-portal.test.ts`). All keyless so the logic can be verified without the Anthropic or Voyage API keys.

### Known limitations (honest)

- **Retrieval is the current accuracy ceiling.** ~17 of the 37 hardest gold failures had the correct code never retrieved into the top-50 — a bigger model doesn't fix those; chapter-note-aware re-indexing or hybrid keyword-plus-vector search would. Documented in `evals/retrieval-diagnostic.md`.
- **Tariff-rate table is a demo subset.** `data/tariff-rates/2026.json` covers the common consumer-goods chapters explicitly; others fall back to a conservative default with a logged warning. Production pulls the full USITC rate table weekly.
- **MPF / HMF fees** are computed at the entry level (once on aggregate value) and **cancel out** of the refund math because they're identical under the filed and proposed code (property-tested across all sample files). USMCA/FTA MPF exemptions are *not* modeled; transport mode defaults to ocean for HMF and the assumption is surfaced, not hidden.
- **Reg Watch** shows tracked importer-specific alerts alongside the **live** Federal Register feed; the two are clearly labeled and separated in the UI.
- **Audit-broker portal** is a faithful local replica of ACE (real ACE has SSO + bot detection); production targets the live portal via Cloudflare Browser Rendering. The UI describes the agent's behavior, not a federal integration.
- **The product has not been used in production with paying customers.** All claims about *what the system does* are demonstrable in the repo; claims about *what the wedge would look like at scale* (e.g. "5–15% duty recovery") are positioned as the product motion, not measured customer outcomes.

---

## Quickstart (Communication & Reproducibility)

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

### Run
```bash
npm run start                        # backend on :8787
npm --prefix frontend run dev        # frontend on :3000  (proxies /api to the backend)
```
Open <http://localhost:3000>. **The frontend proxies `/api/*` to the backend**, so only port 3000 needs to be reachable — no CORS, no second port to forward.

**Demo data is bundled.** The Broker queue self-seeds a realistic catalog of eight SKUs with full reasonable-care records pre-populated for six of them. Process Invoice / Find Refunds each have a one-click "Load a sample" button. So the whole app is explorable from a cold start.

CLI equivalents:
```bash
npm run process-invoice -- data/sample-invoices/shenzhen-electronics.pdf
npm run find-refunds    -- data/sample-entries/amazon-fba.json
```

### Troubleshooting
- **`Voyage TLS: certificate is not yet valid`** — sandbox clock skew. Set `VOYAGE_INSECURE_TLS=1` (Voyage calls only; never in production).
- **`Voyage 429`** — free-tier rate cap on the one-time index. Add a payment method, or use `HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index`.
- **Audit-broker "Executable doesn't exist…"** — no Chromium installed locally. Run `npm run setup:browser`, or use it as-is — it falls back to a guided walkthrough that still pulls the entries and runs the refund finder.
- **Broker queue / Reg watch empty** — make sure you're viewing through `:3000` (the proxy); calling the backend cross-origin from a tunnel won't reach it.

---

## What I'd build next (Roadmap)

**Engineering (weeks-to-months).**
1. **Eval set → CI gate.** Wire the gold-standard benchmark into CI so no prompt or model change ships unless it beats the last best score. Classification accuracy as a contract, not a hope.
2. **Model routing.** Cheap models (Haiku 4.5) for easy classifications, frontier models (Opus 4.7) for the hard ones. Routing decision based on retrieval-score gap and self-reported confidence.
3. **Direct ACE Importer Portal access.** Self-serve historical audit — importer connects their CBP ACE account once, the refund finder runs on the last two years of entries automatically.

**The bigger ambition (years).** Make classification **provably correct**. Today every classification already cites a real ruling and is cross-checked against live CBP precedent in the broker queue — that's the foundation. The next step is going from cited precedent to a **machine-checkable proof** that the *legal procedure itself* was followed, attached to every entry — which flips compliance from something you defend *after* an audit to something you verify *before* you file. The General Rules of Interpretation are already a formal legal decision procedure, so the concrete first step is to encode one HTS chapter — say Chapter 85, electronics — its chapter notes and GRI 1 through 6 as a symbolic checker the LLM has to satisfy, measure the accuracy lift on that subset of the benchmark, and scale chapter by chapter.

At filing scale you close the loop with real CBP outcomes — what the broker accepted, what customs liquidated unchanged — and train on that signal directly. You can't build that today: the law is deliberately ambiguous, and the outcome data only exists after years of filings. That's what makes it hard, and worth building.

---

## AI-tool-usage disclosure (Process & Integrity)

**This project was built end-to-end with [Claude Code](https://claude.com/product/claude-code)**, human-directed and AI-executed, over **112 commits with a visible development history**.

- **Human (author):** defined the product vision (`CLAUDE.md`), the architecture (clean / local-first / Cloudflare-later, agent-on-AppContext, Zod boundaries), the per-session cadence (scaffold → retrieval → classifier → extractor → PSC finder → frontend → ten agents → eval rigor → polish), the eval methodology (CROSS-grounded gold set, prompt versioning, no autonomous fixes after an eval run), and every "stop and report" boundary. Made every prompt-iteration call (v1 → v3.2), every "fix this / don't fix this" call after each eval, every model and scope decision (e.g. keep Sonnet as the cost-default; reject the same-model verifier; ship the CROSS-grounded one instead), and every UX framing call (e.g. the "reasonable-care record" as four explicit legal-steps pillars).
- **Claude Code (agent):** wrote all the code — TypeScript, Zod schemas, prompts, the ten agents, the PDF rendering, the frontend, the scripts, this documentation — ran the agents and reported metrics, and **surfaced failures honestly** (Voyage rate limits, TLS clock-skew, classifier regressions, the 5:5 verifier result, the libsql FK enforcement bug) rather than silently iterating around them.

A rough estimate: **~98% of the code lines were AI-generated and human-reviewed live in the conversation.** Every commit message describes a unit of work that was discussed before it ran. No base repository was forked. All third-party dependencies are credited in [`docs/SOURCES.md`](./docs/SOURCES.md).

The commit history is itself an artifact — readable as a research lab notebook. Skim `git log` to see the cadence: prompt iteration, eval runs, results discussed, decisions taken, dead ends documented (the verifier experiment that didn't ship), features cut (the multi-broker routing), features added (the strategic intelligence layer once the classification core was working).

---

## Legal posture

**I am not a licensed customs broker.** Customs Agent Suite is an AI operations platform that pairs with a licensed customs broker partner who exercises responsible supervision and control under **19 CFR Part 111**; all filings go through the broker under their license and ABI permit. No classification produced here is final until the broker signs off — the PDF report and every web finding says so. Scope is **U.S. imports only** (no export/AES, no drawback, no FTZ, no C-TPAT).

---

## Sources & credits

Comprehensive list in [`docs/SOURCES.md`](./docs/SOURCES.md). The headline ones:
- **Harmonized Tariff Schedule (USITC)** — the U.S. tariff schedule, fetched and indexed via the official USITC dump.
- **CBP CROSS Ruling Search** — binding rulings used as the gold-set ground truth and the live cross-check.
- **World Bank country profiles** — labor and manufacturing data underpinning the sourcing engine.
- **Federal Register** — live regulatory feed that Reg Watch monitors.
- **19 CFR Part 111** — the legal frame for the AI-plus-broker design.
- **Anthropic Claude (Sonnet 4.5, Opus 4.7, Haiku 4.5)** — the reasoning engine. Identical SDK calls work locally and on Cloudflare Workers.
- **Voyage AI (voyage-3-large)** — the embeddings.
- **Open-source libraries**: Hono, Next.js, React, Tailwind, Zod, libsql, Playwright, ffmpeg-static, kokoro-onnx (for the demo voiceover), and others all in `package.json` / `frontend/package.json`.

No code was forked from existing customs-tech repos. The product, architecture, prompts, agents, eval methodology, frontend, and documentation are all original work for this project.

---

## Repo guide for graders (where to look first)

| If you want… | Start here |
|---|---|
| **The two-minute version** | This README. |
| **The three-minute demo** | `customs-agent-demo.mp4` + [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md). |
| **The product vision & long-term roadmap** | [`CLAUDE.md`](./CLAUDE.md). |
| **The architecture rationale** | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). |
| **What's the classifier actually doing?** | [`src/core/agents/classifier.ts`](./src/core/agents/classifier.ts) (start at line 274 `classify`); the system prompt in [`src/core/agents/prompts/`](./src/core/agents/prompts). |
| **The reasonable-care record** | Run the app, open `/broker`, expand any line. Or read [`frontend/app/broker/page.tsx`](./frontend/app/broker/page.tsx) (the four-pillar Drawer panel). |
| **The benchmark** | [`evals/GOLD_REVIEW.md`](./evals/GOLD_REVIEW.md), [`evals/opus-vs-sonnet-report.md`](./evals/opus-vs-sonnet-report.md), [`evals/retrieval-diagnostic.md`](./evals/retrieval-diagnostic.md). Run `npm run eval:classifier`. |
| **The honest failure** | [`evals/verifier-eval-report.md`](./evals/verifier-eval-report.md) — a same-model verifier that didn't help, kept in the repo because the negative result mattered. |
| **The 22-test deterministic core** | `npm test`, or [`tests/`](./tests). |
| **The commit history** | `git log --oneline` — 112 commits, each a unit of work. |
