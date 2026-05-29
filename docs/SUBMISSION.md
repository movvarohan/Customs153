# Submission materials

Everything needed for the Gradescope milestone, the proposal form, and the demo video, drafted from the actual project. Numbers here match `evals/` and the Methodology page.

---

## Proposal

**Project Title:** customs-agent — an AI-native customs operations layer for SMB US importers

**Track:** Automation / Agent Systems (a system of 10 cooperating agents), with a Domain-Specific application surface (US customs / trade compliance).

**Proposed approach.** Replace the manual labor of a licensed customs broker — HTS classification, landed-duty calculation, finding overpaid duty in past entries, watching the regulatory feed — with a system of LLM agents, while pairing with a licensed broker who reviews and signs every filing. The hard technical problem is *defensible* classification: assigning a 10-digit Harmonized Tariff Schedule code that survives CBP's "reasonable care" standard, with a cited legal basis (the General Rules of Interpretation, chapter/section notes, and CBP binding rulings) rather than a guess.

**Implementation plan & timeline.** Built incrementally, one piece per working session, each gated by an eval: (1) clean local-first architecture + HTS retrieval index; (2) the classifier with versioned prompts and a CROSS-grounded gold set; (3) the document extractor; (4) the deterministic duty calculator; (5) the PSC / refund finder; (6) the web frontend; (7) a measurement cycle — gold-set audit, model bake-off, retrieval diagnostic, a rejected verifier experiment; (8) a second agent tier — broker copilot + SKU memory, counterfactual tariff engineering, CBP audit-defense, CROSS-grounded verifier, adversarial debate, Federal Register watcher, browser-driven ACE pull.

---

## Milestone

**Title / Track:** as above.

**Progress (2–3 sentences).** The full pipeline is functional end-to-end: documents in → structured shipment → per-line HTS classification with streamed GRI reasoning and cited sources → deterministic landed-duty math → refund finder over historical entries → broker review with a learning SKU memory, plus a live Federal Register watcher and a browser agent that pulls entries from the ACE portal. It's measured against a 100-case gold set built from CBP CROSS binding rulings (64.9% top-1 @ 8-digit, 75.3% top-3, 100% citation grounding with Opus 4.7), and the prompt was iterated v1→v3.2 with every version scored before merge. Ten agents, eight web surfaces, ~60 commits.

**Future implementation.** Retrieval upgrades (chapter-note-aware re-indexing, hybrid BM25 + dense, a reranker) — the eval shows retrieval, not the model, is the current accuracy ceiling. Then: direct ACE/ABI filing once we hold our own filer permit; multi-broker routing; real-time tariff-rate API; drawback automation.

**Compute.** Anthropic API (Claude Sonnet 4.5 / Opus 4.7), Voyage AI embeddings (voyage-3-large). No GPU training; this is an inference + retrieval + tool-use system.

---

## Demo video script (Q1–Q4)

### Q1 — Why did you build this?
Tariff complexity exploded in 2025–2026: Section 301 expansions, reciprocal tariffs, de minimis elimination, Section 232 changes. **42% of CBP penalties come from HTS misclassification**, and there are only **~14,500 licensed customs brokers** in the US serving millions of importers — a structural bottleneck. SMB importers (Amazon FBA sellers, Shopify/DTC brands) are stuck: they either overpay a broker for opaque work or misclassify and risk penalties. The insight: the *labor* a broker does is automatable with cited, defensible AI; the *legal certification* is not — so pair the two. The wedge is a free historical-entry audit that finds real money (overpaid duty) and converts the importer.

### Q2 — How exactly does it work? (Automation / Agent Systems)
Ten cooperating agents on a clean local-first architecture (`src/core/` pure logic, adapters at the edge, runnable from CLI / HTTP / eventually a Cloudflare Worker unchanged):
- **extractor** reads the invoice/packing-list/BL PDFs into one structured shipment.
- **classifier** assigns the 10-digit HTS code by walking GRI 1–6 explicitly, retrieving the top-50 candidate tariff lines from a Voyage-embedded copy of the full HTS, and citing at least one source — validated against a Zod schema, retried if a citation isn't grounded.
- **duty-calculator** is deterministic (no LLM): base ad valorem + Section 301 + Section 232 + MPF + HMF, every component cited.
- **psc-finder** re-classifies historical entries and quantifies recoverable duty; **entry-summary-parser** ingests CBP Form 7501 PDFs; **counterfactual** proposes legal tariff-engineering alternatives; **audit-defense** simulates a CBP focused assessment; **cross-verifier** checks a code against live CBP CROSS rulings; **debate** runs advocate/challenger/judge; **tariff-monitor** parses the live Federal Register; **ace-browser-agent** drives the ACE portal with Playwright; **sku-memory** turns broker corrections into priors.
- Shown live: the classifier's reasoning **streams token-by-token** with cited HTS lines highlighted, and you can see exactly which of the 50 retrieved candidates it used.

### Q3 — Use cases & impact
A broker's whole back office, available to importers who could never afford one: instant defensible classification on every new shipment, a "find my overpaid duty" audit on the last 12 months (typical finding 5–15% of duties paid), proactive alerts when a Federal Register change affects your specific SKUs, and a CBP-ready audit binder for every decision. Society-level: it widens access to correct customs treatment, reduces the 42% misclassification penalty rate, and routes the legal-certification step to a licensed professional rather than removing them.

### Q4 — What would you add?
Retrieval improvements first (the eval points there, not at the model). Then own-permit ACE filing, multi-broker routing, a real-time rate API, and drawback automation. EU customs is a longer-horizon re-architecture.

---

## Where the evidence lives (for graders)

| Claim | File |
|---|---|
| CROSS-grounded gold set + per-case citations | `evals/GOLD_REVIEW.md`, `evals/hts-classification/gold.jsonl` |
| Gold-set audit (corrections + accept-sets, with rulings) | `evals/accept-set-audit.md` |
| Prompt evolution v1→v3.2 with measured deltas | `evals/v3.1-to-v3.2-report.md`, `src/core/agents/prompts/` |
| Model bake-off (Opus vs Sonnet) | `evals/opus-vs-sonnet-report.md` |
| Retrieval diagnostic (reasoning- vs retrieval-bound) | `evals/retrieval-diagnostic.md` |
| Rejected verifier experiment | `evals/verifier-eval-report.md` |
| Headline metrics surfaced in-product | `/methodology` page, `evals/eval-summary.json` |
| Reasonable-care audit logging | `/audit-trail` page, `audit_log` table |
| Automated tests (keyless, `npm test`) | `tests/` — 22 tests over duty/fee math, rate resolution, streaming decoder, SKU memory, portal |
| AI-usage disclosure, sources, decisions | `README.md`, `docs/SOURCES.md`, git history |
