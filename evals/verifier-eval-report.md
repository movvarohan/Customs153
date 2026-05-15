# Verifier eval — verifier OFF (v3.2 baseline) vs verifier ON

**Mechanism.** After the first-pass classifier produces a code, a second Claude Sonnet call (`src/core/agents/verifier.ts`) receives only the product description, the predicted 10-digit code, and that code's HTS text (heading + subheading + the 8/10-digit line + the chapter/section note chunks the retriever surfaced). It checks whether the description contains specific affirmative evidence for every named criterion in the predicted line, and if not, proposes a more defensible code. On disagreement the classifier's output is revised to the verifier's code and confidence is capped at medium. Wired behind `ENABLE_VERIFIER=1`; off by default.

Run: 97-case gold set both ways + 3 sample refund files both ways. Model and retrieval unchanged; base classifier prompt is v3.2.

> Note: the verifier-ON gold run originally errored on 6 cases — 5 from a container-clock-skew TLS failure ("certificate is not yet valid"), 1 genuine classifier no-valid-response. All 6 were re-run after the clock recovered and merged (`evals/reports/verifier-on-merged.json`). Final dataset is 97/97 scored both ways.

## Gold-set accuracy (97 scored cases)

| metric | verifier OFF (v3.2) | verifier ON | Δ |
|---|---:|---:|---:|
| top-1 @ 10-digit | 39.2% (38/97) | 38.1% (37/97) | −1.0 pp |
| top-1 @ 8-digit | 55.7% (54/97) | 55.7% (54/97) | **0.0 pp** |
| top-3 @ 8-digit | 68.0% (66/97) | 63.9% (62/97) | −4.1 pp |
| top-1 @ 6-digit | 57.7% (56/97) | 55.7% (54/97) | −2.1 pp |
| chapter-correct | 86.6% (84/97) | 86.6% (84/97) | 0.0 pp |
| citation grounding | 99.0% (96/97) | 95.9% (93/97) | −3.1 pp |

## Rescue vs break — the headline number

**RESCUE (verifier flipped a v3.2 8-digit failure to correct): 5**

| expected | OFF → ON | case |
|---|---|---|
| 8517.62.00 | 9102.12.40 → 8517.62.00 | Smartwatch (verifier caught the watch-vs-data-device call) |
| 4202.21.60 | 4202.21.00 → 4202.21.90 | Women's leather handbag (disputed; .90 in accept_set) |
| 3304.99.50 | 3004.50.50 → 3304.99.50 | Vitamin C facial serum (cosmetic, not medicament) |
| 4202.31.60 | 4202.31.00 → 4202.31.60 | Men's leather wallet |
| 8518.22.00 | 8543.70.91 → 8518.22.00 | Voice-activated smart speaker |

**BREAK (verifier flipped a v3.2 8-digit-correct case to wrong): 5**

| expected | OFF → ON | case |
|---|---|---|
| 1902.20.00 | 1902.20.00 → 1902.30.00 | Frozen pork dumplings (stuffed → unstuffed pasta) |
| 6506.10.30 | 6506.10.30 → 6506.10.60 | Cycling helmet kit (athletic → other headgear) |
| 3926.90.75 | 3926.90.75 → 8907.90.00 | Pool float (plastic → **chapter 89, floating structures** — bad revision) |
| 9113.90.80 | 9113.90.80 → 4205.00.40 | Leather watch strap (watch strap → other leather article — bad revision) |
| 8504.40.95 | 8504.40.95 → 8504.40.70 | USB-C wall charger (residual → ADP power supply) |

**RESCUE : BREAK = 5 : 5.**

Per the decision rule set for this task — "if it rescues 12 and breaks 3, ship it; if it's 5 and 5, it's not worth the latency" — **this is the 5-and-5 case. Do not ship.**

Net at 8-digit is exactly zero. The 5 rescues are real (smartwatch, smart speaker, vitamin-C serum — all cases where the classifier picked a wrong chapter/heading and the verifier's criteria check pulled it back). But the 5 breaks include two genuinely bad revisions — the verifier moved a pool float to chapter 89 (ships and floating structures) and a watch strap to 4205 (other leather articles) — confidently-wrong second-guessing. The verifier doesn't only fix overreach; it also introduces its own.

Two of the 5 rescues (handbag, wallet) are cases where v3.2's *honest 6-digit fallback* returned `4202.21.00` / `4202.31.00`, and the verifier pushed them back to a committed 8-digit. So the verifier partially **undoes** the v3.2 6-digit-fallback design — it forces an 8-digit commitment where v3.2 deliberately abstained. On these two it scored, but that's the verifier working against the prior change, not with it.

## Confidence calibration (n / top1@8 / top3@8 / top1@6)

| bucket | OFF | ON |
|---|---|---|
| high | n=78 · 65% / 76% / 68% | n=59 · 68% / 78% / 68% |
| medium | n=15 · 20% / 40% / 20% | n=35 · 34% / 40% / 34% |
| low | n=4 · 0% / 25% / 0% | n=3 · 67% / 67% / 67% |

The one genuine positive: the verifier **improves calibration**. It moves 19 cases out of "high" (disagreement caps confidence at medium), and high-confidence accuracy ticks up 65% → 68%. The medium bucket grows and its accuracy improves 20% → 34%. So a broker filtering on "high confidence" gets a marginally cleaner set. But that is a calibration gain, not an accuracy gain — the codes themselves are no better.

## Per-chapter movement (top-1 @ 8-digit)

Chapters that changed: gained — ch 33 (2/4→3/4), ch 42 (4/8→6/8), ch 85 (6/11→7/11); lost — ch 19 (2/2→1/2), ch 39 (2/5→1/5), ch 65 (2/2→1/2), ch 91 (1/2→0/2). +4 gained / −4 lost — the same net-zero churn seen in the rescue/break list, just bucketed by chapter.

## Refund-finder precision/recall (3 sample files)

Aggregate, 10 ground-truth misclassifications, **lenient** scoring (correctly flagged as misclassified):

| | verifier OFF (v3.2) | verifier ON | Δ |
|---|---:|---:|---:|
| TP | 7 | 6 | −1 |
| FP | 4 | 6 | +2 |
| FN | 3 | 4 | +1 |
| precision | 63.6% | **50.0%** | −13.6 pp |
| recall | 70.0% | **60.0%** | −10.0 pp |

Per sample (lenient): amazon-fba 100%/60% → 75%/60% (verifier added a false positive); vietnam-apparel 60%/100% → 60%/100% (unchanged); india-houseware 33%/50% → **0%/0%** (verifier broke the one true positive and surfaced nothing correct). The verifier makes the refund finder strictly worse on these samples.

## Verdict

**Do not ship the verifier.**

- Gold-set 8-digit accuracy: **flat** (rescue:break = 5:5 — the explicit "not worth it" threshold).
- top-3 @ 8-digit: −4.1 pp. Citation grounding: −3.1 pp.
- Refund finder: precision −13.6 pp, recall −10.0 pp — a real regression.
- Cost: doubles classifier latency (every classification is now two Sonnet calls) and roughly doubles token spend.
- The only upside is better confidence calibration (high-bucket 65%→68%, fewer over-confident "high"s) — not worth a latency doubling and a refund-finder regression.

The verifier's premise is sound — re-reading the predicted line's named criteria does catch real overreach (smartwatch, smart speaker, serum). But it second-guesses correct calls just as often, and some of its revisions are worse than the original (pool float → ch 89). A second LLM pass with the same model and the same retrieval context inherits the same blind spots; it isn't an independent check.

If this is revisited: the verifier should only be allowed to *downgrade confidence and flag*, never to *rewrite the code* — i.e. keep the calibration win, drop the revision authority that produced the 5 breaks. That would be a strictly safe variant. But as specced (revise on disagreement), it's a wash on accuracy and a loss on the refund finder.

Code stays in the tree behind `ENABLE_VERIFIER=1` (off by default) so the experiment is reproducible, but it should not be enabled in the demo path.
