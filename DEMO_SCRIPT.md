# Customs Agent Suite — Demo Script (≈3:45)

**How to use:** read the **SAY** lines as voiceover while you perform the **SHOW** actions.
Keep the screen *moving* (scroll slowly, don't freeze). Record at 1080p, app at `localhost:3000`.
The demo data is pre-seeded and the workflow auto-pilot has already drafted filings, so everything is live.

---

### 0:00 — Cold open  *(SHOW: the home page, full screen)*
**SAY:** "Every year, U.S. importers overpay billions in customs duties — and most never find out. This is **Customs Agent Suite**: an AI system that does the work of a licensed customs broker, end to end."

### 0:12 — The problem & the wedge  *(SHOW: scroll the hero, then the "Why now" stats: 42% / ~14,500 / 5–15%)*
**SAY:** "The timing is everything. Tariffs exploded in 2025 — Section 301, reciprocal duties, Section 232. **Forty-two percent** of customs penalties trace back to a single wrong product code. And there are only about **fourteen thousand** licensed brokers for millions of importers — the bottleneck is human. So we built an AI operations layer that *pairs* with a licensed broker: the AI does the analysis, the human certifies it. And the wedge is irresistible — send us six months of your entries, and we'll find the duty you overpaid, **for free**."

### 0:40 — Command center  *(SHOW: scroll to the "Operations snapshot" dashboard; hover the tiles)*
**SAY:** "Every importer lands on a live command center — annual duty exposure, classifications waiting on review, open refund windows, and the exact actions due today. One pane of glass over the entire operation."

### 1:00 — The hero feature: refund audit  *(SHOW: open "Find refunds")*
**SAY:** "This is what converts them. The agent re-classifies every historical line **from scratch** — applying the General Rules of Interpretation in their legal order — re-prices the duty under the correct code, and flags every overpayment. It outputs a polished savings report, typically recovering **five to fifteen percent** of the duty paid, pre-drafted as Post Summary Corrections, ready for a broker to file."

### 1:25 — Autonomous workflow  *(SHOW: open "Workflow"; let the conveyor + auto-pilot panel + the 2 drafted approvals show)*
**SAY:** "Once they're a customer, the whole lifecycle becomes one **autonomous conveyor** — ingest, security filing, customs entry, broker review, filing. A background agent fires every draft the instant its deadline approaches. Watch — with *zero* clicks, it has already assembled the ISF and the CBP **7501** entry from the importer's own data and routed them for approval. Days of broker paperwork, compressed to seconds — and every dollar figure is **deterministic**, never a hallucination."

### 1:50 — Broker in the loop  *(SHOW: open "Broker queue"; click "Approve filing"; expand a classification to show the duty stack + flags)*
**SAY:** "A licensed broker is always in the loop, because their signature is what makes a filing legal. Each line carries its real duty exposure, a confidence score, and risk flags — Section 301, anti-dumping. The broker approves, or opens the full duty stack and the **cited legal reasoning** behind every code. The AI does the work; the human stays accountable."

### 2:12 — Logistics coordination  *(SHOW: open "Coordination"; expand a shipment to reveal the milestone timeline)*
**SAY:** "Brokerage is also coordination. We track every in-flight shipment across the forwarder, the carrier, the trucker, and the warehouse — and enforce the deadlines that cost real money: the security filing **before loading**, the entry **before arrival**, and the container's **last free day** before demurrage."

### 2:30 — Deadline intelligence  *(SHOW: open "Deadlines"; expand one entry's lifecycle bar)*
**SAY:** "Customs is a game of clocks. Every entry has a correction window before liquidation, and a protest window after. We watch them all, so a recoverable refund never silently expires."

### 2:42 — Policy Lab  *(SHOW: open "Policy lab"; click the "301 + reciprocal stack" preset, then "Reshore to Vietnam"; scroll to the economics)*
**SAY:** "For strategy, the Policy Lab simulates any tariff shock across the **entire catalog**, instantly. Stack a 301 hike with a reciprocal tariff — the duty bill rebuilds, line by line. Reroute to Vietnam, and it weighs the duty saved against the higher cost of goods: here, **over six hundred thousand dollars a year**, paying back in half a month. A CFO-grade decision in one click."

### 3:05 — Sourcing & Factory Finder  *(SHOW: "Catalog" sourcing, then "Factory finder" with the researched cards)*
**SAY:** "It even reasons about second-order effects — using **live web research** to find where production could move, naming real factories, grounding labor costs in World Bank data, and mapping landed cost across countries. The Factory Finder goes deeper, vetting specific factories: their certifications, whether they're even taking new clients, and whether each is a fast **tactical bridge** or a **long-term partner**."

### 3:24 — Rigor & architecture  *(SHOW: open "Methodology"; show the accuracy table + the 10-agent pipeline)*
**SAY:** "And none of this is a black box. We built a **gold-standard evaluation set** from real CBP rulings and grade every classification — top-one and top-three accuracy, with a **hundred-percent citation-grounding rate**. Ten specialized agents, behind a clean, swappable architecture that ports to the cloud without touching the business logic. Engineered for the **reasonable-care** standard the law actually demands."

### 3:42 — Copilot & close  *(SHOW: open "Copilot"; type "What's the HTS code and landed duty for Bluetooth earbuds from China?" and send; let it answer)*
**SAY:** "And it all collapses into a copilot. Ask in plain English — it classifies, prices, and cites the **actual CBP rulings** behind its answer. The work of a customs broker, done by AI, certified by a human. **That's Customs Agent Suite.**"

---

## Recording tips
- **Tool:** OBS, ScreenStudio, Cap, or (Mac) QuickTime "New Screen Recording." Record the browser at **1920×1080**.
- **Pacing:** keep scrolling slowly through each screen; never sit on a static frame for more than ~2s.
- **Browser:** full-screen the app window, hide bookmarks bar, use the forwarded `localhost:3000`.
- **Voice:** read at a measured, confident pace (~150 wpm). If you'd rather not record voice live, record silent video and add narration after.
- **Trims if you need it shorter:** drop "Sourcing & Factory Finder" or "Coordination" to reach ~3:00; the rest still tells the full story.
- **Data is ready:** auto-pilot has already drafted the ISF + 7501 into the Broker queue's "Filings" section, so the workflow story shows real output with no waiting.
