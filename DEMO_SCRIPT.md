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

> **Stats to cite on screen:** ≈$80B/yr in U.S. duties collected (CBP trade statistics) and **$2B+/yr in unclaimed duty drawback** (the most-cited industry figure — pull it from a drawback-specialist report or CBP and show the source). These are estimates; anchor them to a citation so they read as researched, not asserted.

---

# ▶ 3-MINUTE CUT  *(~535 words ≈ 3:00–3:10 at a confident pace)*

Written as flowing, plain sentences so it's easy to follow. Read at a steady, confident pace (~165 wpm) and use the screen transitions as natural breaths. SHOW cues are in **[brackets]** and aren't spoken. The fuller ~5-minute version is below if you want more detail.

**[SHOW: Home — hero + the "Why now" stats]**  *(Q1)*
"Every year, American importers pay over eighty billion dollars in tariffs, and over two billion dollars in refunds they're owed go unclaimed — because claiming it is complicated, expensive, and bound by deadlines that quietly expire. We built Customs Agent Suite to fix three problems. First, classification is real legal reasoning, and forty-two percent of penalties come from a wrong code. Second, only about fourteen thousand licensed brokers serve millions of importers — the expertise can't scale. Third, the 2025 tariff surge left small importers unable to keep up. Our insight: you can't legally remove the broker, so we let the AI do the work and have the broker certify it."

**[SHOW: Methodology — accuracy table + agent pipeline]**  *(Q2: research + architecture)*
"So how does it work? At its core, this is a retrieval system, not a model we trained. We embedded the entire U.S. tariff schedule and tens of thousands of binding rulings into a vector database, so it reasons over the real law, not memory. We grade it against our own benchmark of real rulings, so every classification ships with a citation you can check. And the duty math runs on a separate, deterministic engine, so the dollar amounts are always exact and auditable."

**[SHOW: Workflow auto-pilot → Broker queue: approve a filing, expand the duty stack]**  *(Q2: agents)*
"On top sits a team of ten specialized agents. The hardest codes go through an adversarial debate — one agent argues, another attacks, a third decides — then a check against live customs rulings. The whole lifecycle runs on autopilot: as you can see, with no clicks, it has already drafted the security filing and the customs entry and handed them to a broker for one approval."

**[SHOW: Policy Lab reroute economics → Catalog landed-cost map → Factory Finder cards]**  *(the unique edge)*
"What really sets us apart: we didn't stop at filing — we built a strategic intelligence layer on top. The Policy Lab simulates any tariff change across a whole catalog in one click. The sourcing engine maps where production could move and what it would cost, and the Factory Finder vets specific factories — even which are taking new clients. Every other tool answers, how do I file this. We answer the bigger question: how do I protect my margins as the rules change."

**[SHOW: Command center]**  *(Q3)*
"It's built for Amazon and direct-to-consumer brands importing from China — too small for a great broker, big enough to overpay. They recover five to fifteen percent of their duty, never miss a refund deadline, and get supply-chain intelligence only the largest companies could afford."

**[SHOW: Copilot answering a question]**  *(Q4 + close)*
"From here we go two directions. On the business side, we bring filing in-house with our own broker's license, and automate drawback and export filings. On the technical side, the north star is classification that's *provable* and *self-improving*. Today the AI explains its reasoning; next, we want it to **prove** it — to lay out, step by step, that it followed customs law, and attach that proof to the entry. That flips compliance from something you defend *after* an audit to something you verify *before* you file. And it learns from real outcomes — every code a broker accepts, every entry customs clears — so it gets sharper with every shipment, eventually filing more accurately than any single broker. And we can't just build it today — that's the point: formalizing law that's deliberately ambiguous is hard, and the outcome data only accumulates once you're filing at scale, which is exactly what makes it defensible. The work of a customs broker, done by AI and certified by a human. That's Customs Agent Suite."

---

# Extended version (~5 min — same content, fuller wording, more SHOW detail)

## Q1 — Why we built this  *(0:00 – 0:50)*

**SHOW:** Home page; slowly scroll the hero and the "Why now" stats (42% / ~14,500 / 5–15%).

**SAY (hook + the scale of the problem):** "Every year, U.S. importers pay over **eighty billion dollars** in tariffs — and **over two billion dollars** in refunds they're legally owed, from overpayments and duty drawback, go **unclaimed**. Not because the money isn't there, but because claiming it is **complicated, expensive, and bound by tight deadlines** — so most importers never even try. We built **Customs Agent Suite** to capture it, and to keep importers from overpaying in the first place."

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

**SAY (platform / technical front):** "On the **platform** side, the next work is about reliability, cost, and accuracy at scale. We harden the **evaluation harness into a CI gate** — no prompt or model change ships unless it beats the benchmark — with full **observability** on every agent's tool calls and confidence. We drive **cost and latency** down with model routing — a cheap model for the easy calls, a frontier model for the hard ones — plus prompt caching and batch inference for the refund fan-out. We tighten **retrieval** with hybrid keyword-plus-vector search and reranking, over a corpus that **auto-syncs** as the tariff tables and rulings change. And we close the **data flywheel** — every broker correction grows a proprietary, labeled dataset we **distill into a small, fine-tuned classifier** that's cheaper, faster, and ours."

**SAY (north star — the hard, valuable moonshot):** "And the real north star — years of work, but transformational: make classification **provably correct and self-improving**. The General Rules of Interpretation are a *formal legal decision procedure*, so we'd build a **neuro-symbolic reasoner** — the model reasoning *inside* a symbolic engine of the tariff hierarchy and the section and chapter legal notes — that emits a **machine-checkable proof** for every code: GRI 1 applied before GRI 3, essential-character analysis, exclusions checked. That turns 'reasonable care' from a vibe into a **verifiable artifact**. Then we close the loop on **real-world outcomes** — did the broker accept it, did CBP liquidate it unchanged, was the refund granted, did it survive an audit — and use **offline reinforcement learning** on those sparse, ten-month-delayed signals to train a policy that *learns to file correctly from the field, not from a static benchmark*. That's the difference between an LLM that's usually right and a system that's **provably careful, learns from every filing, and measurably beats a human broker.** And the reason we can't just build this today is exactly what makes it defensible: you have to **formalize a body of law that's deliberately written to be ambiguous**, and you need a **large, proprietary dataset of real filing outcomes** that only exists once you're operating at scale — neither of which a competitor can shortcut by prompting a foundation model."

**SAY (close):** "And it all collapses into a copilot you can just talk to — it classifies, prices, and **cites the actual CBP rulings** behind its answer. The work of a customs broker, done by AI, certified by a human. **That's Customs Agent Suite.**"

---

## Recording tips
- **Tool:** OBS, ScreenStudio, Cap, or (Mac) QuickTime "New Screen Recording." Record the browser at **1920×1080**.
- **Pacing:** scroll slowly through each screen; never sit on a static frame more than ~2s.
- **Browser:** full-screen the app, hide the bookmarks bar, use `localhost:3000`.
- **Voice:** measured, confident, ~150 wpm. (Record silent and add narration after if you prefer.)
- **Before you record:** open the **Workflow** page once (or click "Run automation") so the auto-pilot has the ISF + 7501 drafted into the Broker queue's **Filings** section — that makes the Q2 automation beat show real output.
- **Need it shorter?** Trim the Factory Finder line in Q3 to reach ~3:45; the four answers still land in full.
