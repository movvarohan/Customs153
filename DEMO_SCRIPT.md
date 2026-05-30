# Customs Agent Suite — Demo Script (≈5:20)

Built to answer the four required questions, with the live product as the backbone.
Read the **SAY** lines as voiceover while you perform the **SHOW** actions. Keep the screen moving.

**Where each question is answered (tell the grader up front, or use as chapter markers):**

| Q | Topic | Time |
|---|---|---|
| **Q1** | Why I built it — bottlenecks, scale, inspiration | 0:00 – 0:50 |
| **Q2** | How it works — [1] research/method · [2] architecture · [3] agents | 0:50 – 2:50 |
| **★** | The intelligence layer — my unique edge (sourcing, factories, map, simulation) | 2:50 – 3:40 |
| **Q3** | Use cases, impact, who uses it | 3:40 – 4:15 |
| **Q4** | What I'd add next — business **and** platform/technical | 4:15 – 5:20 |

> **Stats to cite on screen:** ≈$80B/yr in U.S. duties collected (CBP trade statistics) and **$2B+/yr in unclaimed duty drawback** (the most-cited industry figure — pull it from a drawback-specialist report or CBP and show the source). These are estimates; anchor them to a citation so they read as researched, not asserted.

---

# ▶ 3-MINUTE CUT  *(~760 words ≈ 3:40–4:00 at a brisk, confident pace)*

Written as flowing, plain sentences so it's easy to follow. Read at a steady, confident pace (~165 wpm) and use the screen transitions as natural breaths. SHOW cues are in **[brackets]** and aren't spoken. The fuller ~5-minute version is below if you want more detail.

**[SHOW: Home — hero + the "Why now" stats]**  *(Q1)*
"American importers pay over eighty billion dollars a year in duty, and more than two billion in refunds they're legally owed go unclaimed — claiming them is complicated, expensive, and bound by deadlines that quietly expire. Two things make this genuinely hard. Classification is legal reasoning, not lookup — forty-two percent of customs penalties come from a wrong code. And only about fourteen thousand licensed brokers serve millions of importers, so the expertise can't scale. The constraint I designed Customs Agent Suite around: you can't legally remove the licensed broker. So the AI does the work, and the broker certifies it."

**[SHOW: Methodology — accuracy table + agent pipeline]**  *(Q2: research + method)*
"It's a retrieval system, not a model I trained. I embedded the entire U.S. tariff schedule and tens of thousands of CBP binding rulings into a vector database, so the classifier reasons over the actual law, not memory. I built a gold-standard benchmark from real rulings to grade the pipeline end to end, and every classification has to cite an actual one — one-hundred-percent citation grounding by design. The duty math runs on a separate deterministic engine — base rate, Section 301, 232, fees — so the dollar figures are always exact and auditable, never hallucinated."

**[SHOW: Workflow auto-pilot → Broker queue: approve a filing, expand the duty stack → Coordination shipment timeline]**  *(Q2: agents)*
"On top sits a system of ten specialized agents — extraction, classification, duty calculation, refund-finding, sourcing research, and more — each a tool-using model call with structured output and automatic retry. The hardest codes go through an adversarial debate: advocate, challenger, judge — then a verifier cross-checks the answer against live CBP rulings. The whole shipment lifecycle runs as an autonomous pipeline — with zero clicks, it's already drafted the security filing and the customs entry, routed them to a licensed broker for one approval, and posted the shipment into a coordination view where the importer, broker, and freight side stay aligned on one timeline."

**[SHOW: Policy Lab reroute → Catalog landed-cost map → Factory Finder → Reg Watch]**  *(intelligence layer)*
"And I went beyond filing. When tariff rules change every month, classification alone isn't enough — you also have to know what to do about it. The Policy Lab simulates any tariff change across a catalog in one click. The sourcing engine maps where production could move. The Factory Finder profiles specific factories — certifications, capacity, whether they're taking new clients. And a Reg Watch agent monitors the Federal Register so a new exclusion reaches you the day it publishes. That's the part most customs tools don't try to do."

**[SHOW: Find-refunds → Deadlines → Command center]**  *(Q3)*
"And who is it for? Not just small Amazon sellers — that's where I'd start, but the honest target is anyone importing into the U.S. who doesn't have a Fortune-500-grade trade compliance team in-house, which is almost everyone. A nine-figure manufacturer hits the same tariff math as a DTC brand. What I built gives them what those internal teams have: a classifier they can trust, a refund finder that catches what their broker missed, a deadline tracker so nothing recoverable expires, and a strategic layer for sourcing and pricing decisions when policy moves."

**[SHOW: Copilot answering a question]**  *(Q4 + close)*
"What I'd build next. On the engineering side: turn the eval set into a CI gate so nothing ships unless it beats the benchmark; route easy classifications to a cheap model and the hard ones to a frontier model; and wire up direct ACE Importer Portal access so the historical audit is fully self-serve — an importer connects their account and the refund finder runs on their last two years of entries automatically. The bigger ambition is making classification provably correct. Today every classification already cites a real ruling and gets cross-checked against live CBP precedent in the broker queue — that's the foundation. The next step is going from cited precedent to a machine-checkable **proof** that the *legal procedure itself* was followed, attached to every entry — and that flips compliance from something you defend *after* an audit to something you verify *before* you file. The General Rules of Interpretation are already a formal legal decision procedure, so the concrete first step is to encode one HTS chapter — say Chapter 85, electronics — its chapter notes and GRI 1 through 6 as a symbolic checker the LLM has to satisfy, and measure how much accuracy lifts on that subset of the benchmark. Then scale chapter by chapter. That turns 'reasonable care' from a vibe into a verifiable artifact. And once you're filing at scale, you close the loop with real CBP outcomes — what the broker accepted, what customs liquidated unchanged — and train against that signal directly. You can't build that today: the law is deliberately ambiguous, and the outcome data only exists after years of filings. That's what makes it hard, and worth building. The work of a customs broker, done by AI, certified by a human. That's Customs Agent Suite."

---

# Extended version (~5 min — same content, fuller wording, more SHOW detail)

## Q1 — Why I built this  *(0:00 – 0:50)*

**SHOW:** Home page; slowly scroll the hero and the "Why now" stats (42% / ~14,500 / 5–15%).

**SAY (hook + the scale of the problem):** "Every year, U.S. importers pay over **eighty billion dollars** in tariffs — and **over two billion dollars** in refunds they're legally owed, from overpayments and duty drawback, go **unclaimed**. Not because the money isn't there, but because claiming it is **complicated, expensive, and bound by tight deadlines** — so most importers never even try. I built **Customs Agent Suite** to capture it, and to keep importers from overpaying in the first place."

**SAY (the bottlenecks I identified):** "I found three. **First, classification** — every imported product needs a precise ten-digit HTS code, and **forty-two percent** of customs penalties come from getting it wrong. It's legal reasoning, not a lookup. **Second, people** — there are only about **fourteen thousand** licensed customs brokers in the entire country, serving millions of importers; the expertise simply doesn't scale. **Third, timing** — tariffs exploded in 2025, Section 301, 232, reciprocal duties, and small importers have no way to keep up. So billions in recoverable duty just sits there, unclaimed, because no one is looking."

**SAY (the inspiration / key insight):** "The insight that started the project: you can't *legally* remove the licensed broker — but you can let an AI do the work and have the broker certify it. That one constraint is what makes this defensible, and it's exactly what no one was building for small importers."

---

## Q2 — How it works  *(0:50 – 2:50)*

### [1] Research & method  *(0:50 – 1:25)*
**SHOW:** Open **Methodology** — the accuracy table, prompt versions, retrieval/eval.

**SAY:** "On the research side, this is a **retrieval-augmented, evaluation-driven** system, with a learning loop. **One — retrieval:** I embedded the entire U.S. tariff schedule and tens of thousands of CBP binding rulings into a **vector database**, so the classifier reasons over the actual law, grounded in real precedent — not the model's memory. **Two — my own benchmark:** I built a **gold-standard evaluation set from real CBP rulings**, each with a legally-correct code, and I **optimize the whole system against it** — measuring top-one and top-three accuracy with a **hundred-percent citation-grounding rate**. That benchmark discipline is the part most projects skip. **Three — a learning loop:** every correction a licensed broker makes is written back into a **per-customer memory**, so the same product is classified the same way every time, and the system gets sharper with use. That growing, broker-verified dataset is also my roadmap to **fine-tuning a specialized customs model.**"

### [2] Product & architecture  *(1:25 – 2:00)*
**SHOW:** Scroll the agent pipeline on Methodology; (optionally flash the repo structure).

**SAY:** "Architecturally it's built clean. The business logic is **pure and infrastructure-agnostic**, behind typed interfaces — today it runs on Node, SQLite, and the filesystem; the *same code* ports to Cloudflare Workers, D1, and Vectorize by swapping adapters, not rewriting logic. And critically, the **duty math is a deterministic engine** — base rate, Section 301, Section 232, fees — with **no language model in the calculation**. So the dollar figures are always exact and auditable, never hallucinated."

### [3] Automation & agent systems  *(2:00 – 2:50)*
**SHOW:** Open **Workflow** (auto-pilot panel + the two drafted approvals), then **Broker queue** — click "Approve filing," expand a classification to show the duty stack + cited reasoning.

**SAY:** "The intelligence is a system of **ten specialized agents** — extraction, classification, duty calculation, refund-finding, sourcing research, and more — each a foundation-model call with **tools, structured output validated against a schema, and automatic retry**. Hard codes go through an **adversarial debate**: an advocate argues for the code, a challenger attacks it, a judge rules — and a separate verifier checks it against **live CBP rulings**. I don't fine-tune; reliability comes from grounding every claim in retrieval, deterministic math, and citations. Then it's orchestrated: a background scheduler runs the whole shipment lifecycle as an **autonomous conveyor** — watch, with *zero clicks* it's already drafted the security filing and the customs entry, and routed them here, to a licensed broker, who approves with the full reasoning in front of them. The AI does the work; a human is always accountable."

---

## ★ The intelligence layer — my unique edge  *(2:50 – 3:40)*

> This is the section that sets you apart. It explains **why** you built the sourcing engine, the factory finder, the map, the simulator, and the monitoring — and why no one else has them.

**SHOW (move fast, one feature each):** **Policy Lab** (click "Reshore to Vietnam," show the economics) → **Catalog** sourcing with the **landed-cost map** → **Factory Finder** cards (capabilities, "taking new clients?", bridge vs partner) → flash **Reg watch** and the **Control room**.

**SAY:** "Here's what actually sets it apart. Every other customs tool stops at filing the paperwork. I built a whole **strategic intelligence layer** on top — because an importer's real question in 2025 isn't just *what's my code*, it's *what do I do about these tariffs?* So I answer it. The **Policy Lab** simulates any tariff shock across your entire catalog in one click. The **sourcing engine** uses live web research to map where your production could move — naming real factories, grounding labor costs in **World Bank data**, and comparing total landed cost on an **interactive map**. The **Factory Finder** then vets those factories one by one — certifications, whether they're even taking new clients, and whether each is a fast tactical bridge or a long-term partner — and it even drafts the outreach email. **Reg watch** monitors the Federal Register so a new exclusion that saves you money reaches *you* first. And a **control room** lets you watch the entire agent fleet reason in real time. **Every feature here exists to answer one question a traditional broker can't:** not just *how do I file this*, but *how do I protect my margins as the rules change.* That's the difference between a filing tool and a strategic partner — and it's the whole reason I built the intelligence, the factories, the map, all of it."

---

## Q3 — Use cases, impact & who uses it  *(3:40 – 4:15)*

**SHOW:** Back to the **Command center**; let the live numbers and "needs attention" sit on screen.

**SAY:** "So who uses it? The wedge is **Amazon FBA sellers and DTC brands importing from China** — importers too small to afford a great broker, but big enough to overpay badly. A founder forwards their entries and gets a savings report in 48 hours; their operations lead lives in this command center; their CFO uses the Policy Lab before the next tariff headline. The impact is concrete: **recover five to fifteen percent** of duty paid, **stop billions in refunds from going unclaimed**, never miss a deadline, and make a sourcing call worth **hundreds of thousands a year**. And the societal value is real: it **democratizes scarce customs expertise**, raises compliance accuracy so fewer small businesses get penalized, and gives them the supply-chain intelligence that today only the Fortune 500 can afford."

---

## Q4 — What I'd add next  *(4:15 – 5:20)*

**SHOW:** **Copilot** — type *"What's the HTS code and landed duty for Bluetooth earbuds from China?"*, send, let it answer. While narrating the *platform* part, optionally flash the repo's `src/core` / `src/adapters` structure or an architecture diagram. End on the home dashboard.

**SAY (business front):** "Where it goes next, on two fronts. On the **business** side, I bring filing fully in-house with my own broker license and direct **ACE and ABI integration**, add real-time **carrier tracking**, and automate **duty drawback and export filings** — each one a new revenue line on top of the same engine."

**SAY (platform / technical front):** "On the **platform** side, the next work is about reliability, cost, and accuracy at scale. I harden the **evaluation harness into a CI gate** — no prompt or model change ships unless it beats the benchmark — with full **observability** on every agent's tool calls and confidence. I drive **cost and latency** down with model routing — a cheap model for the easy calls, a frontier model for the hard ones — plus prompt caching and batch inference for the refund fan-out. I tighten **retrieval** with hybrid keyword-plus-vector search and reranking, over a corpus that **auto-syncs** as the tariff tables and rulings change. And I close the **data flywheel** — every broker correction grows a proprietary, labeled dataset I **distill into a small, fine-tuned classifier** that's cheaper, faster, and mine."

**SAY (north star — the hard, valuable moonshot):** "And the real north star — years of work, but transformational: make classification **provably correct and self-improving**. The General Rules of Interpretation are a *formal legal decision procedure*, so I'd build a **neuro-symbolic reasoner** — the model reasoning *inside* a symbolic engine of the tariff hierarchy and the section and chapter legal notes — that emits a **machine-checkable proof** for every code: GRI 1 applied before GRI 3, essential-character analysis, exclusions checked. That turns 'reasonable care' from a vibe into a **verifiable artifact**. Then I close the loop on **real-world outcomes** — did the broker accept it, did CBP liquidate it unchanged, was the refund granted, did it survive an audit — and use **offline reinforcement learning** on those sparse, ten-month-delayed signals to train a policy that *learns to file correctly from the field, not from a static benchmark*. That's the difference between an LLM that's usually right and a system that's **provably careful, learns from every filing, and measurably beats a human broker.** And the reason I can't just build this today is exactly what makes it defensible: you have to **formalize a body of law that's deliberately written to be ambiguous**, and you need a **large, proprietary dataset of real filing outcomes** that only exists once you're operating at scale — neither of which a competitor can shortcut by prompting a foundation model."

**SAY (close):** "And it all collapses into a copilot you can just talk to — it classifies, prices, and **cites the actual CBP rulings** behind its answer. The work of a customs broker, done by AI, certified by a human. **That's Customs Agent Suite.**"

---

## Recording tips
- **Tool:** OBS, ScreenStudio, Cap, or (Mac) QuickTime "New Screen Recording." Record the browser at **1920×1080**.
- **Pacing:** scroll slowly through each screen; never sit on a static frame more than ~2s.
- **Browser:** full-screen the app, hide the bookmarks bar, use `localhost:3000`.
- **Voice:** measured, confident, ~150 wpm. (Record silent and add narration after if you prefer.)
- **Before you record:** open the **Workflow** page once (or click "Run automation") so the auto-pilot has the ISF + 7501 drafted into the Broker queue's **Filings** section — that makes the Q2 automation beat show real output.
- **Need it shorter?** Trim the Factory Finder line in Q3 to reach ~3:45; the four answers still land in full.
