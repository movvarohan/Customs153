# Customs Agent Suite — Demo Script (≈4:20)

Built to answer the four required questions, with the live product as the backbone.
Read the **SAY** lines as voiceover while you perform the **SHOW** actions. Keep the screen moving.

**Where each question is answered (tell the grader up front, or use as chapter markers):**

| Q | Topic | Time |
|---|---|---|
| **Q1** | Why we built it — bottlenecks & inspiration | 0:00 – 0:45 |
| **Q2** | How it works — [1] research/method · [2] architecture · [3] agents | 0:45 – 2:55 |
| **Q3** | Use cases, impact, who uses it | 2:55 – 3:40 |
| **Q4** | What we'd add next | 3:40 – 4:20 |

---

## Q1 — Why we built this  *(0:00 – 0:45)*

**SHOW:** Home page; slowly scroll the hero and the "Why now" stats (42% / ~14,500 / 5–15%).

**SAY (hook):** "Every year, U.S. importers overpay billions in customs duties — and rack up penalties they never see coming. We built **Customs Agent Suite** to fix that."

**SAY (the bottlenecks we identified):** "We found three. **First, classification** — every imported product needs a precise ten-digit HTS code, and **forty-two percent** of customs penalties come from getting it wrong. It's legal reasoning, not a lookup. **Second, people** — there are only about **fourteen thousand** licensed customs brokers in the entire country, serving millions of importers; the expertise simply doesn't scale. **Third, timing** — tariffs exploded in 2025, Section 301, 232, reciprocal duties, and small importers have no way to keep up."

**SAY (the inspiration / key insight):** "The insight that started the project: you can't *legally* remove the licensed broker — but you can let an AI do the work and have the broker certify it. That one constraint is what makes this defensible, and it's exactly what no one was building for small importers."

---

## Q2 — How it works  *(0:45 – 2:55)*

### [1] Research & method  *(0:45 – 1:25)*
**SHOW:** Open **Methodology** — the accuracy table, prompt versions, retrieval/eval.

**SAY:** "On the research side, this is a **retrieval-augmented, evaluation-driven** system, with a learning loop. **One — retrieval:** we embedded the entire U.S. tariff schedule and tens of thousands of CBP binding rulings into a **vector database**, so the classifier reasons over the actual law, grounded in real precedent — not the model's memory. **Two — our own benchmark:** we built a **gold-standard evaluation set from real CBP rulings**, each with a legally-correct code, and we **optimize the whole system against it** — measuring top-one and top-three accuracy with a **hundred-percent citation-grounding rate**. That benchmark discipline is the part most projects skip. **Three — a learning loop:** every correction a licensed broker makes is written back into a **per-customer memory**, so the same product is classified the same way every time, and the system gets sharper with use. That growing, broker-verified dataset is also our roadmap to **fine-tuning a specialized customs model.**"

### [2] Product & architecture  *(1:25 – 2:00)*
**SHOW:** Scroll the agent pipeline on Methodology; (optionally flash the repo structure).

**SAY:** "Architecturally it's built clean. The business logic is **pure and infrastructure-agnostic**, behind typed interfaces — today it runs on Node, SQLite, and the filesystem; the *same code* ports to Cloudflare Workers, D1, and Vectorize by swapping adapters, not rewriting logic. And critically, the **duty math is a deterministic engine** — base rate, Section 301, Section 232, fees — with **no language model in the calculation**. So the dollar figures are always exact and auditable, never hallucinated."

### [3] Automation & agent systems  *(2:00 – 2:55)*
**SHOW:** Open **Workflow** (auto-pilot panel + the two drafted approvals), then **Broker queue** — click "Approve filing," expand a classification to show the duty stack + cited reasoning.

**SAY:** "The intelligence is a system of **ten specialized agents** — extraction, classification, duty calculation, refund-finding, sourcing research, and more — each a foundation-model call with **tools, structured output validated against a schema, and automatic retry**. Hard codes go through an **adversarial debate**: an advocate argues for the code, a challenger attacks it, a judge rules — and a separate verifier checks it against **live CBP rulings**. We don't fine-tune; reliability comes from grounding every claim in retrieval, deterministic math, and citations. Then it's orchestrated: a background scheduler runs the whole shipment lifecycle as an **autonomous conveyor** — watch, with *zero clicks* it's already drafted the security filing and the customs entry, and routed them here, to a licensed broker, who approves with the full reasoning in front of them. The AI does the work; a human is always accountable."

---

## Q3 — Use cases, impact & who uses it  *(2:55 – 3:40)*

**SHOW:** Command center → **Policy Lab** (click "Reshore to Vietnam," show the economics) → **Factory Finder** cards.

**SAY:** "Who is this for? The wedge is **Amazon FBA sellers and DTC brands importing from China** — importers too small to afford a great broker, but big enough to overpay badly. The impact is concrete: **recover five to fifteen percent** of duty paid, stop missing the correction and protest deadlines that quietly expire money, and make CFO-grade sourcing decisions under tariff volatility — like the Vietnam reroute here, **six hundred thousand dollars a year** in savings, mapped against real factories. Zoom out, and the societal value is real: it **democratizes scarce customs expertise**, raises compliance accuracy so fewer importers get penalized, and gives small businesses the supply-chain intelligence that today only the Fortune 500 can afford."

---

## Q4 — What we'd add next  *(3:40 – 4:20)*

**SHOW:** **Copilot** — type *"What's the HTS code and landed duty for Bluetooth earbuds from China?"*, send, let it answer; end on the home dashboard.

**SAY:** "Where it goes next. Near-term, we bring **filing fully in-house** with our own broker license and direct **ACE integration**, add real-time **carrier tracking**, and automate **drawback and export filings**. The long-term moat is a **data flywheel**: every broker correction makes our gold eval set larger and more proprietary — and eventually that becomes the training data to **fine-tune our own specialized customs model**. And it all collapses into a copilot you can just talk to — it classifies, prices, and **cites the actual CBP rulings** behind its answer. The work of a customs broker, done by AI, certified by a human. **That's Customs Agent Suite.**"

---

## Recording tips
- **Tool:** OBS, ScreenStudio, Cap, or (Mac) QuickTime "New Screen Recording." Record the browser at **1920×1080**.
- **Pacing:** scroll slowly through each screen; never sit on a static frame more than ~2s.
- **Browser:** full-screen the app, hide the bookmarks bar, use `localhost:3000`.
- **Voice:** measured, confident, ~150 wpm. (Record silent and add narration after if you prefer.)
- **Before you record:** open the **Workflow** page once (or click "Run automation") so the auto-pilot has the ISF + 7501 drafted into the Broker queue's **Filings** section — that makes the Q2 automation beat show real output.
- **Need it shorter?** Trim the Factory Finder line in Q3 to reach ~3:45; the four answers still land in full.
