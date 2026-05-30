# Customs Agent Suite — Demo Script (≈5:20)

Built to answer the four required questions, with the live product as the backbone.
Read the **SAY** lines as voiceover while you perform the **SHOW** actions. Keep the screen moving.

**Where each question is answered (tell the grader up front, or use as chapter markers):**

| Q | Topic | Time |
|---|---|---|
| **Q1** | Why we built it — bottlenecks, scale, inspiration | 0:00 – 0:50 |
| **Q2** | How it works — [1] research/method · [2] architecture · [3] agents | 0:50 – 2:50 |
| **★** | The intelligence layer — our unique edge (sourcing, factories, map, simulation) | 2:50 – 3:40 |
| **Q3** | Use cases, impact, who uses it | 3:40 – 4:15 |
| **Q4** | What we'd add next — business **and** platform/technical | 4:15 – 5:20 |

> **Stat to verify before you submit:** the "unclaimed refunds" figures below (≈$80B/yr in U.S. duties; billions in unclaimed overpayments + drawback) are *industry estimates* — grab a citable source (e.g., CBP trade statistics, a drawback-industry report) and put it on screen.

---

# ▶ 3-MINUTE CUT  *(~490 words — read at ~165 wpm)*

Covers all four questions + the unique intelligence layer + business **and** platform roadmap. SHOW cues are in **[brackets]** and aren't spoken. The fuller ~5-minute version is below if you want it.

**[SHOW: Home — hero + the "Why now" stats]**  *(Q1)*
"Every year, U.S. importers pay over **eighty billion dollars** in tariffs — and **billions** in refunds they're owed go **unclaimed**, because no one's looking. We built **Customs Agent Suite** to fix three bottlenecks: classification is *legal reasoning*, and **forty-two percent** of customs penalties come from a wrong code; there are only **fourteen thousand** licensed brokers for millions of importers; and 2025's tariff explosion left small importers stranded. Our insight — you can't *legally* remove the broker, so **AI does the work, and the broker certifies it**."

**[SHOW: Methodology — accuracy table + agent pipeline]**  *(Q2: research + architecture)*
"How it works. The research is a **retrieval-augmented, evaluation-driven** system: we embedded the full tariff schedule and tens of thousands of CBP rulings into a **vector database**, so it reasons over real law; we built a **gold-standard benchmark** from those rulings and optimize against it — top-one and top-three accuracy, a **hundred-percent citation-grounding rate**; and every broker correction feeds a **per-customer memory** that sharpens it over time. The business logic sits behind **typed interfaces** — it ports to **Cloudflare** without a rewrite — and the duty math is a **deterministic engine**, so the dollars are exact, never hallucinated."

**[SHOW: Workflow auto-pilot → Broker queue: approve a filing, expand the duty stack]**  *(Q2: agents)*
"The intelligence is **ten specialized agents** with tools, schema-validated output, and retry; hard codes go through an **adversarial debate** — advocate, challenger, judge — verified against **live CBP rulings**. And it's autonomous: a background scheduler runs the whole shipment lifecycle, so with **zero clicks** it has already drafted the security filing and the **7501** entry and routed them to a licensed broker — who approves with the full reasoning in front of them."

**[SHOW: Policy Lab reroute economics → Catalog landed-cost map → Factory Finder cards]**  *(the unique edge)*
"What sets us apart: every other tool stops at filing. We built a **strategic intelligence layer** — a **Policy Lab** that simulates any tariff shock across your catalog; a **sourcing engine** that uses live web research to map where production could move, naming real factories and grounding labor costs in **World Bank data**; a **Factory Finder** that vets each one — certifications, open capacity, tactical bridge versus long-term partner — plus regulatory monitoring and a **control room** over the whole agent fleet. Not just *how to file* — *how to protect your margins as the rules change*."

**[SHOW: Command center]**  *(Q3)*
"It's for **Amazon FBA and DTC brands** importing from China — too small for a great broker, big enough to overpay. They **recover five to fifteen percent** of duty, stop billions going unclaimed, and never miss a deadline — customs expertise only the Fortune 500 could afford."

**[SHOW: Copilot answering a question]**  *(Q4 + close)*
"What's next, on two fronts. **Business:** our own broker license, direct ACE filing, carrier tracking, drawback automation. **Platform:** ship to Cloudflare — **Durable Objects** for agent memory, **Workflows** for a durable pipeline; turn the eval into a **CI gate**; route models and cache for cost; and **distill** the broker-corrected data into our own fine-tuned classifier. The work of a customs broker — done by AI, certified by a human. **That's Customs Agent Suite.**"

---

# Extended version (~5 min — same content, fuller wording, more SHOW detail)

## Q1 — Why we built this  *(0:00 – 0:50)*

**SHOW:** Home page; slowly scroll the hero and the "Why now" stats (42% / ~14,500 / 5–15%).

**SAY (hook + the scale of the problem):** "Every year, U.S. importers pay over **eighty billion dollars** in tariffs — and the money they're legally owed back but never claim, overpayments and unclaimed drawback, runs into the **billions**. Most importers never even find out. We built **Customs Agent Suite** to capture it — and to keep importers from overpaying in the first place."

**SAY (the bottlenecks we identified):** "We found three. **First, classification** — every imported product needs a precise ten-digit HTS code, and **forty-two percent** of customs penalties come from getting it wrong. It's legal reasoning, not a lookup. **Second, people** — there are only about **fourteen thousand** licensed customs brokers in the entire country, serving millions of importers; the expertise simply doesn't scale. **Third, timing** — tariffs exploded in 2025, Section 301, 232, reciprocal duties, and small importers have no way to keep up. So billions in recoverable duty just sits there, unclaimed, because no one is looking."

**SAY (the inspiration / key insight):** "The insight that started the project: you can't *legally* remove the licensed broker — but you can let an AI do the work and have the broker certify it. That one constraint is what makes this defensible, and it's exactly what no one was building for small importers."

---

## Q2 — How it works  *(0:50 – 2:50)*

### [1] Research & method  *(0:50 – 1:25)*
**SHOW:** Open **Methodology** — the accuracy table, prompt versions, retrieval/eval.

**SAY:** "On the research side, this is a **retrieval-augmented, evaluation-driven** system, with a learning loop. **One — retrieval:** we embedded the entire U.S. tariff schedule and tens of thousands of CBP binding rulings into a **vector database**, so the classifier reasons over the actual law, grounded in real precedent — not the model's memory. **Two — our own benchmark:** we built a **gold-standard evaluation set from real CBP rulings**, each with a legally-correct code, and we **optimize the whole system against it** — measuring top-one and top-three accuracy with a **hundred-percent citation-grounding rate**. That benchmark discipline is the part most projects skip. **Three — a learning loop:** every correction a licensed broker makes is written back into a **per-customer memory**, so the same product is classified the same way every time, and the system gets sharper with use. That growing, broker-verified dataset is also our roadmap to **fine-tuning a specialized customs model.**"

### [2] Product & architecture  *(1:25 – 2:00)*
**SHOW:** Scroll the agent pipeline on Methodology; (optionally flash the repo structure).

**SAY:** "Architecturally it's built clean. The business logic is **pure and infrastructure-agnostic**, behind typed interfaces — today it runs on Node, SQLite, and the filesystem; the *same code* ports to Cloudflare Workers, D1, and Vectorize by swapping adapters, not rewriting logic. And critically, the **duty math is a deterministic engine** — base rate, Section 301, Section 232, fees — with **no language model in the calculation**. So the dollar figures are always exact and auditable, never hallucinated."

### [3] Automation & agent systems  *(2:00 – 2:50)*
**SHOW:** Open **Workflow** (auto-pilot panel + the two drafted approvals), then **Broker queue** — click "Approve filing," expand a classification to show the duty stack + cited reasoning.

**SAY:** "The intelligence is a system of **ten specialized agents** — extraction, classification, duty calculation, refund-finding, sourcing research, and more — each a foundation-model call with **tools, structured output validated against a schema, and automatic retry**. Hard codes go through an **adversarial debate**: an advocate argues for the code, a challenger attacks it, a judge rules — and a separate verifier checks it against **live CBP rulings**. We don't fine-tune; reliability comes from grounding every claim in retrieval, deterministic math, and citations. Then it's orchestrated: a background scheduler runs the whole shipment lifecycle as an **autonomous conveyor** — watch, with *zero clicks* it's already drafted the security filing and the customs entry, and routed them here, to a licensed broker, who approves with the full reasoning in front of them. The AI does the work; a human is always accountable."

---

## ★ The intelligence layer — our unique edge  *(2:50 – 3:40)*

> This is the section that sets you apart. It explains **why** you built the sourcing engine, the factory finder, the map, the simulator, and the monitoring — and why no one else has them.

**SHOW (move fast, one feature each):** **Policy Lab** (click "Reshore to Vietnam," show the economics) → **Catalog** sourcing with the **landed-cost map** → **Factory Finder** cards (capabilities, "taking new clients?", bridge vs partner) → flash **Reg watch** and the **Control room**.

**SAY:** "Here's what actually sets us apart. Every other customs tool stops at filing the paperwork. We built a whole **strategic intelligence layer** on top — because an importer's real question in 2025 isn't just *what's my code*, it's *what do I do about these tariffs?* So we answer it. The **Policy Lab** simulates any tariff shock across your entire catalog in one click. The **sourcing engine** uses live web research to map where your production could move — naming real factories, grounding labor costs in **World Bank data**, and comparing total landed cost on an **interactive map**. The **Factory Finder** then vets those factories one by one — certifications, whether they're even taking new clients, and whether each is a fast tactical bridge or a long-term partner — and it even drafts the outreach email. **Reg watch** monitors the Federal Register so a new exclusion that saves you money reaches *you* first. And a **control room** lets you watch the entire agent fleet reason in real time. **Every feature here exists to answer one question a traditional broker can't:** not just *how do I file this*, but *how do I protect my margins as the rules change.* That's the difference between a filing tool and a strategic partner — and it's the whole reason we built the intelligence, the factories, the map, all of it."

---

## Q3 — Use cases, impact & who uses it  *(3:40 – 4:15)*

**SHOW:** Back to the **Command center**; let the live numbers and "needs attention" sit on screen.

**SAY:** "So who uses it? The wedge is **Amazon FBA sellers and DTC brands importing from China** — importers too small to afford a great broker, but big enough to overpay badly. A founder forwards their entries and gets a savings report in 48 hours; their operations lead lives in this command center; their CFO uses the Policy Lab before the next tariff headline. The impact is concrete: **recover five to fifteen percent** of duty paid, **stop billions in refunds from going unclaimed**, never miss a deadline, and make a sourcing call worth **hundreds of thousands a year**. And the societal value is real: it **democratizes scarce customs expertise**, raises compliance accuracy so fewer small businesses get penalized, and gives them the supply-chain intelligence that today only the Fortune 500 can afford."

---

## Q4 — What we'd add next  *(4:15 – 5:20)*

**SHOW:** **Copilot** — type *"What's the HTS code and landed duty for Bluetooth earbuds from China?"*, send, let it answer. While narrating the *platform* part, optionally flash the repo's `src/core` / `src/adapters` structure or an architecture diagram. End on the home dashboard.

**SAY (business front):** "Where it goes next, on two fronts. On the **business** side, we bring filing fully in-house with our own broker license and direct **ACE and ABI integration**, add real-time **carrier tracking**, and automate **duty drawback and export filings** — each one a new revenue line on top of the same engine."

**SAY (platform / technical front):** "On the **platform** side, we built for this from day one. Because the business logic sits behind **typed interfaces**, shipping to **Cloudflare** is a port, not a rewrite — Workers for the API, D1 and Vectorize for data and retrieval, **Durable Objects** for per-shipment agent state and per-customer memory, and **Workflows** to run the lifecycle as a durable, resumable pipeline instead of a timer. We harden the **evaluation harness into a CI gate** — no prompt or model change ships unless it beats the benchmark — with full **observability** on every agent's tool calls and confidence. We drive **cost and latency** down with model routing — Haiku for the cheap calls, Opus for the hard ones — plus prompt caching and the batch API for the refund fan-out. And we tighten the **retrieval**: hybrid keyword-plus-vector search with reranking, over a corpus that auto-syncs as the tariff tables and rulings change. Then the **data flywheel** closes the loop — every broker correction grows a proprietary, labeled dataset we use to **distill a small, fine-tuned classifier**: cheaper, faster, and ours."

**SAY (close):** "And it all collapses into a copilot you can just talk to — it classifies, prices, and **cites the actual CBP rulings** behind its answer. The work of a customs broker, done by AI, certified by a human. **That's Customs Agent Suite.**"

---

## Recording tips
- **Tool:** OBS, ScreenStudio, Cap, or (Mac) QuickTime "New Screen Recording." Record the browser at **1920×1080**.
- **Pacing:** scroll slowly through each screen; never sit on a static frame more than ~2s.
- **Browser:** full-screen the app, hide the bookmarks bar, use `localhost:3000`.
- **Voice:** measured, confident, ~150 wpm. (Record silent and add narration after if you prefer.)
- **Before you record:** open the **Workflow** page once (or click "Run automation") so the auto-pilot has the ISF + 7501 drafted into the Broker queue's **Filings** section — that makes the Q2 automation beat show real output.
- **Need it shorter?** Trim the Factory Finder line in Q3 to reach ~3:45; the four answers still land in full.
