# customs-agent

**AI-native customs operations for SMB US importers.** An importer's broker filed entries on the wrong HTS code; we re-classify every line item from scratch under the current Harmonized Tariff Schedule, recompute duty under both the filed and corrected codes, and surface every Post Summary Correction with quantified savings — full GRI reasoning attached, ready for a licensed broker to file. Same engine processes inbound invoices end-to-end.

> **Wedge:** Amazon FBA sellers, Shopify merchants, and DTC brands importing from China. Pitch: *"Send us your last 6 months of entries. We'll find duties you overpaid and classifications you should challenge."*

The full product vision, including the long-term roadmap (Cloudflare Workers backend, broker-review UI, per-customer SKU master, proactive tariff monitoring), is in [`CLAUDE.md`](./CLAUDE.md). This README covers what's in the repo today and how to run it.

---

## What's in the repo

Three working surfaces:

1. **CLI agents** — `npm run process-invoice -- file.pdf` and `npm run find-refunds -- entries.json`, plus `npm run eval:classifier` against a 40-case gold set.
2. **HTTP API** — Hono backend on port 8787 with NDJSON-streaming endpoints for the frontend, and a PDF-rendering endpoint that serves the same artifact the CLI produces.
3. **Web UI** — Next.js 15 app under `frontend/` with three screens: landing, single-invoice processing with live per-line classification, and historical-entries refund analysis with live progress and PDF download.

Everything below `src/` is the agent layer; the frontend is its own subtree under `frontend/`.

---

## Architecture (clean / local-first / Cloudflare-later)

```
src/
├── core/                # pure business logic — depends only on src/interfaces/
│   ├── agents/          # extractor, classifier, duty-calculator, psc-finder
│   │   └── prompts/     # versioned classifier system prompts (v1 → v3.1)
│   ├── routes/          # Hono routes (runtime-agnostic, AppContext-injected)
│   ├── lib/             # tariff rates, FX, PDF renderer, retry, concurrency
│   ├── types/           # domain entities + job payloads
│   ├── schemas/         # Zod schemas for LLM output / external boundaries
│   └── app-context.ts   # the dependency bag every core function receives
├── interfaces/          # Database, BlobStorage, VectorStore, KeyValueCache,
│                        # BackgroundQueue, EmbeddingProvider, BrowserAutomation
├── adapters/
│   ├── local/           # SQLite (libsql), filesystem, in-memory cache + queue,
│   │                    # local vector store, Voyage embeddings, stub browser
│   └── cloudflare/      # added later: D1, R2, Vectorize, KV, Queues
└── entry/
    └── cli.ts           # local dev — wires local adapters, serves Hono on Node

frontend/                # Next.js 15 + Tailwind. Three screens, no backend logic.
data/                    # tariff rates, sample invoices, sample entry files,
                         # rendered PDFs (committed for reproducibility)
evals/                   # 40-case gold set + classifier eval harness
scripts/                 # generators (sample invoices, sample entries),
                         # fetchers (HTS schedule + notes), eval / index runners
migrations/              # D1-compatible SQL (currently 0001_initial.sql)
```

**Layering rule, enforced everywhere:** code in `src/core/` may import only from `src/core/` and `src/interfaces/`. It may not import from `src/adapters/` or any concrete infra package (`@libsql/client`, `fs`, `cloudflare:workers`). All wiring happens at the entry point. The Cloudflare port is "add `src/adapters/cloudflare/`, add `src/entry/worker.ts`, write a `wrangler.toml` — `src/core/` doesn't change."

**Why this matters:** the agent layer is reachable from the CLI, from the HTTP API, and (eventually) from a Cloudflare Worker, with zero modification. The PDF renderer is a single function that both the CLI script and the HTTP route call. The classifier prompt is a versioned text file iterated against an eval harness; v1 → v3.1 history is preserved on disk for diffing.

---

## Setup from scratch

### Prerequisites

- **Node 22** or later
- An **[Anthropic API key](https://console.anthropic.com/)** — Claude Sonnet 4.5 powers extraction and classification (≈ $0.02 per line classified, $0.04 per invoice extracted)
- A **[Voyage AI key](https://dashboard.voyageai.com/)** — voyage-3-large 1024d embeddings power retrieval (free tier sufficient for indexing once; paid tier $0.18/M tokens)

### One-time setup

```bash
# 1. Install backend dependencies
npm install

# 2. Configure secrets
cp .env.example .env
# Edit .env and set:
#   ANTHROPIC_API_KEY=sk-ant-...
#   VOYAGE_API_KEY=pa-...

# 3. Apply the SQLite migration
npm run db:migrate

# 4. Fetch the HTS schedule + chapter/section notes from USITC
npm run hts:fetch        # ≈ 6 sec, downloads ~11 MB JSON + 198 notes files

# 5. Embed the HTS into the local vector store (one-time, paid Voyage)
npm run hts:index        # ≈ 17 min on paid Voyage; ~$2 in embedding cost
                         # Free-tier override: HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index
                         # — but the full schedule takes ~20 hours under free-tier rate caps.

# 6. Verify retrieval is sensible
npm run hts:test         # 10 sample queries × top-5 each, ~30 sec
```

### Install the frontend

```bash
npm --prefix frontend install
```

### Run

Open two terminals:

```bash
# Terminal 1 — backend (port 8787)
npm run start

# Terminal 2 — frontend (port 3000)
npm --prefix frontend run dev
```

Open <http://localhost:3000>.

> **Sandbox note**: certain dev-cluster setups (Claude Code's web runner) issue ephemeral TLS certs whose `notBefore` lies a fraction of a second in the future. Set `VOYAGE_INSECURE_TLS=1` on those environments — it's a per-adapter scoped escape hatch, not a global. Don't set it elsewhere; see `## Troubleshooting` below.

---

## Demo flows

### 1. Process a single commercial invoice

CLI:

```bash
npm run process-invoice -- data/sample-invoices/shenzhen-electronics.pdf
# Other samples in data/sample-invoices/:
#   vietnam-apparel.pdf
#   india-houseware.pdf  (INR — exercises the FX conversion path)
```

Web: <http://localhost:3000/process-invoice> → drag a PDF.

The extractor pulls structured line items via Claude Sonnet's PDF support (verbatim seller descriptions, integer-cent monetary discipline). The classifier runs on each line in parallel (concurrency 5) and surfaces missing-input flags ("unit value in USD", "exact material composition", etc.) for broker review.

Typical wall time on the Shenzhen sample (8 lines): **~80 seconds** end-to-end.

### 2. Find refund opportunities in a batch of historical entries

CLI:

```bash
npm run find-refunds -- data/sample-entries/amazon-fba.json
# Other samples in data/sample-entries/:
#   vietnam-apparel.json
#   india-houseware.json
```

Web: <http://localhost:3000/find-refunds> → upload the JSON.

The PSC finder re-classifies every line, computes duty under both the filed and our predicted code, and surfaces opportunities sorted by recoverable amount. Low-confidence disagreements go to a separate "broker review" bucket — never auto-filed. Entries older than 11 months are flagged as outside the PSC window (protest required).

The agent fires per-line callbacks as each line completes, so the web UI shows a live progress bar and a recoverable-so-far counter rather than dead air.

Typical wall time on the FBA sample (22 lines): **~130 seconds** with first per-line update at ~22 seconds.

### 3. Download the broker-facing PDF

After running the find-refunds analysis (web), click "Download full report (PDF)". The PDF is the same artifact the CLI produces (`scripts/render-refund-report.ts`), generated by a shared rendering function. Cover page with at-a-glance metrics, executive summary, one block per opportunity with plain-English reasoning, methodology section, appendix listing every disagreement and any classification failures.

Sample committed renders: `data/sample-refund-reports/{amazon-fba,vietnam-apparel,india-houseware}.pdf`.

### 4. Generate fresh sample data

Both the synthetic invoices (PDFs via pdfkit + Claude-generated content) and the synthetic historical entries (deterministic, with planted misclassifications and a `_ground_truth_correct_hts` field for eval) can be regenerated:

```bash
npm run generate-samples       # 3 invoices into data/sample-invoices/
npm run generate-entries       # 3 entry files into data/sample-entries/ (deterministic seed)
```

The entry generator is fully deterministic so the eval scorer can compare prompt iterations against the same planted misclassifications.

---

## Eval methodology and current results

### The 40-case gold set (`evals/hts-classification/gold.jsonl`)

40 hand-curated test cases representing realistic SMB-importer language across consumer electronics, apparel, housewares, food, and industrial parts. Each case has:

- a verbatim seller description (the way an Amazon seller writes their own products, not the way the HTS describes them)
- an `expected_hts_8` (8-digit HTS, the unambiguous level)
- an `expected_hts_10` (10-digit when unambiguous, else null)
- a `notes` field explaining the classification reasoning
- an `ambiguous` flag for cases CBP rulings split on
- a `disputed` flag with `acceptable_hts_8: [...]` for cases where multiple answers are defensible (e.g., silicone phone cases — 3926.99 vs 4202)

15 of the 40 are flagged ambiguous; one is disputed. At least 5 cases test GRI rules other than GRI 1 (sets, composites, unassembled articles).

### Classifier accuracy (latest run, prompt v3.1, model claude-sonnet-4-5)

Run: `npm run eval:classifier`. Reports written to `evals/reports/classifier-<timestamp>.json`.

| Metric | Value |
|---|---|
| Top-1 @ 10-digit | 30 % |
| Top-1 @ 8-digit | 57.5 % (40 cases) / 59.0 % (excluding disputed) |
| Top-3 @ 8-digit | 72.5 % |
| **Chapter-correct top-1** | **92.5 %** |
| Citation grounding rate | 100 % (every classification cites only retrieved candidates) |

Confidence calibration:

| Confidence | n | Top-1 @ 8-digit accuracy |
|---|---|---|
| high | 27 | 70.4 % |
| medium | 11 | 27.3 % |
| low | 2 | 50 % |

The model uses "medium" appropriately when the 8-digit line involves a value tier or named-vs-residual choice it can't resolve from the description alone — that's the broker triage hook the v3.1 prompt added.

### Refund-finder precision/recall (latest run, prompt v3.1)

Across 3 synthetic importer profiles (45 entries, 49 line items, 10 planted misclassifications):

| Metric | Value |
|---|---|
| Recall | 7 / 10 = **70 %** |
| Precision | 7 / 12 = **58 %** |
| Pre-broker-review precision (high-conf only) | 7 / 9 = 78 % |

The remaining false positives cluster on identifiable patterns the broker would catch in 30 seconds (Sheesham/rosewood wood being misread as bamboo, Chinese vs. earthenware mug ceramics). Real wins dominate the dollar value.

### Prompt evolution

Four versions of the classifier system prompt are preserved on disk for diffing (`src/core/agents/prompts/classifier-system.{v1,v2,v3,v3.1}.ts`); the active export is in `classifier-system.ts`.

| Version | Change | Headline result |
|---|---|---|
| v1 | Original GRI explanation | 50 % top-1 @ 8-digit, 24/30 cases marked GRI 1 (collapsed reasoning), confidence uncalibrated |
| v2 | Numbered decision procedure (Step 1–4), force verbatim quoting of section/chapter notes, broker-relevance confidence rubric, `missing_inputs_for_precision` field, `hts_code` written last in tool call | 57.5 % top-1 @ 8-digit, GRI distribution diversifies (4 × GRI 3(b)), high-confidence accuracy 70 % |
| v3 | Specificity Rule for named 8-digit lines (bamboo / electric / smartphone) | Fixed bamboo cutting board + brass candle stand; introduced 3 smartwatch false positives ($10K phantom recoverable in FBA sample) — Specificity Rule fought Principal-Function rule and won |
| v3.1 | Rule precedence (notes > principal function > GRI 1 > Specificity Rule > residual) with explicit smartwatch carve-out | 2 of 3 smartwatch FPs suppressed; total false-positive recoverable dropped from $10.8K to ~$1.2K; precision 47 % → 58 %, recall stable at 70 % |

### Known limitations

These show up in the eval and aren't fixed yet — be candid about them:

- **Uncommon wood species** read as bamboo. The Specificity Rule lists "Sheesham, rosewood, oak" by name, but the model still occasionally picks 4419.11 (bamboo) for those because the cutting-board chunk's embed text is very similar across wood species. Affects 2 of 3 Sheesham cases in the India sample.
- **Multi-function electronics requiring principal-function analysis**. Smartwatches are the well-trodden case (settled at 8517.62, not 9102 — covered by an explicit prompt carve-out). Other multi-function devices not specifically named in the prompt (handheld GPS units, "smart" hubs, hybrid cameras) may flip the wrong way.
- **The 6214 cotton-vs-synthetic split** for woven scarves. The model frequently picks 6214.90 ("of other textile materials") for cotton scarves rather than the cotton-specific 6214.30, partly because the gold set itself may be wrong on the canonical answer for cotton voile scarves; we've left this as a known disagreement until we get a real CBP ruling cite.
- **Value-tier 8-digit lines in chapter 4202** (handbags, cases) when the input doesn't include a unit value. Model defaults to "medium" confidence and surfaces "unit value in USD" in `missing_inputs_for_precision`. Working as designed but means several 4202 lines land just below "high" until the broker confirms the tier.
- **Section 301 chapter coverage** in `data/tariff-rates/2026.json` is the demo subset (most consumer-goods chapters covered explicitly; less common chapters fall back to a 2.74% default ad-valorem with a logged warning). Production runs on a full USITC-pulled rate table.
- **Voyage free-tier rate limits** make the one-time HTS index take ~20 hours; the README setup assumes paid Voyage. The classifier's runtime queries are tiny and free-tier-safe.

The eval harness writes a JSON report after every run, so any prompt iteration is measurable.

---

## AI-tool-usage disclosure

**This project was built end-to-end with [Claude Code](https://claude.com/product/claude-code).**

The split was human-directed, AI-executed:

- **Human (the author)**: defined the product vision (`CLAUDE.md`), the architecture (clean / local-first / Cloudflare-later layering, the agent-on-AppContext pattern, the Zod-validated boundaries), the development cadence (one product piece per session: scaffold → retrieval → classifier → extractor → PSC finder → frontend → polish), the eval methodology (gold set, prompt versioning, no autonomous fixes after the eval runs), and every "stop and report" boundary. Made every prompt iteration call (v1 → v2 → v3 → v3.1), every "fix this / don't fix this" call after each eval run, and reviewed every commit before push.
- **Claude Code (the agent)**: wrote all the code — TypeScript implementation, Zod schemas, prompts, tests, PDF rendering, frontend components, npm scripts, this README. Ran the agents end-to-end and reported metrics. When something failed (Voyage rate limits, TLS sandbox quirks, classifier regressions), reported and proposed fixes; never silently iterated.

Every commit message in the git log was AI-written. Code was reviewed live in the conversation, not after-the-fact — a rejected suggestion got iterated on or discarded in the same session.

A rough estimate: **~98% of the code lines were AI-generated and human-reviewed.** The exceptions are a few one-line config edits the author made directly (e.g., adjusting tariff rates) and the prompt iteration calls themselves.

---

## Legal posture

**We are not a licensed customs broker.** customs-agent is an AI operations platform that pairs with a licensed customs broker partner; the broker exercises responsible supervision and control of customs business as required by 19 CFR Part 111. All filings go through the broker partner under their license and ABI permit. We do not represent any importer before CBP — the broker partner does, on the record.

No classification produced by this system is final until the licensed broker signs off. The PDF refund report explicitly says so on the cover page; the web UI's findings carry the same language on every opportunity card.

**Scope is US imports only.** No export work (US Census / AES filings), no multi-country imports, no drawback claims, no foreign trade zones, no C-TPAT certification — these are out of scope for the MVP and listed in `CLAUDE.md`.

---

## Troubleshooting

### `Voyage TLS: certificate is not yet valid`

Some sandboxes (Claude Code's web runner among them) generate ephemeral TLS certs whose `notBefore` is a fraction of a second after the shell clock; Node's `https` rejects them. Set `VOYAGE_INSECURE_TLS=1` to disable certificate verification **for Voyage calls only** — this is a per-adapter escape hatch in `src/adapters/local/voyage-embedding.ts`. Every other HTTPS call in the codebase still verifies normally. Never set this in production.

### `Voyage 429: You have not yet added your payment method`

Voyage's free tier is 3 RPM / 10K TPM. The one-time HTS index sends ~11M tokens, which takes ~20 hours under those caps. Add a payment method at <https://dashboard.voyageai.com/> and the same job runs in 5–10 minutes. Free-tier-friendly defaults: `HTS_BATCH_SIZE=20 HTS_BATCH_PAUSE_MS=60000 npm run hts:index`.

### Classifier returns `validation_warning: "...not in retrieved candidates"`

The agent is required to cite only HTS codes from its candidate set. If retrieval is weak for a particular description, the agent may try to cite a code that wasn't retrieved; this is logged and the classification is retried once. If it still fails, the warning is attached to the result. Review the failing line in `audit_log` (every classification trace is persisted) to decide whether retrieval needs widening or the line genuinely has no good candidate.

### The PDF download serves a "1 / 6" but I see 12 pages

This bug existed in an earlier rev of the renderer (`pdfkit`'s `text()` advances `y` after writing, which auto-paginates as a side effect when the footer write crosses the page boundary). Fixed in commit `ad97c27`: footer is now written with `lineBreak: false` and the page count is snapshotted before the loop. Make sure you're on `master` / latest; the committed sample PDFs in `data/sample-refund-reports/` are post-fix.

---

## License

Internal MVP code. Not currently open-sourced.
