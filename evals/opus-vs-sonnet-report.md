# Model swap eval — Sonnet 4.5 vs Opus 4.7

**Setup.** Identical except the model: same v3.2 prompt, same retrieval, same top-50 candidates, same scorer, same post-audit 97-case gold set. Swapped via `DEFAULT_MODEL=claude-opus-4-7` (the eval and `scripts/find-refunds.ts` both already read that env var). **No wrapper changes were needed** — Opus 4.7 handles the existing tool-use `input_schema` identically to Sonnet; the 97-case run scored 97/97 with 0 errors.

Sonnet baseline = the v3.2 predictions (`classifier-2026-05-14T12-15-15-067Z.json`), re-scored against the post-audit gold via `evals/tools/rescore.py` so the comparison is apples-to-apples. Opus run = `classifier-2026-05-15T19-52-29-242Z.json`.

## Gold-set accuracy (97 scored cases)

| metric | Sonnet 4.5 (v3.2) | Opus 4.7 | Δ |
|---|---:|---:|---:|
| top-1 @ 10-digit | 42.3% (41/97) | 44.3% (43/97) | +2.0 pp |
| top-1 @ 8-digit | 61.9% (60/97) | **64.9% (63/97)** | +3.0 pp |
| top-3 @ 8-digit | 72.2% (70/97) | 75.3% (73/97) | +3.1 pp |
| top-1 @ 6-digit | 63.9% (62/97) | 69.1% (67/97) | +5.2 pp |
| chapter-correct | 86.6% (84/97) | 88.7% (86/97) | +2.1 pp |
| citation grounding | 99.0% (96/97) | 100% (97/97) | +1.0 pp |

Opus is consistently but modestly better — every metric up 1–5 pp.

## Confidence calibration (n / top1@8 / top3@8 / top1@6)

| bucket | Sonnet 4.5 | Opus 4.7 |
|---|---|---|
| high | n=78 · 72% / 79% / 74% | n=82 · 73% / 84% / 77% |
| medium | n=15 · 27% / 47% / 27% | n=7 · 43% / 57% / 43% |
| low | n=4 · 0% / 25% / 0% | n=8 · 0% / 0% / 12% |

Opus's calibration is **more decisive / more bimodal**: it commits 82 cases to "high" and 8 to "low", leaving only 7 in "medium" (Sonnet: 78 / 4 / 15). High-confidence accuracy is essentially the same (72→73%). The notable difference is the **"low" bucket: Opus 0/8 at top-1 @ 8-digit** — when Opus says "low" it is genuinely a no-confidence prediction, and there are twice as many of them, cleanly flagged. For broker triage that's a real (if minor) plus: "low" is a trustworthy "do not rely on this" signal.

## Per-chapter (top-1 @ 8-digit) — only chapters that moved

| chapter | Sonnet | Opus |
|---|---|---|
| 42 (leather goods) | 4/8 | 5/8 |
| 49 (printed matter) | 1/2 | 2/2 |
| 70 (glass) | 2/3 | 3/3 |
| 85 (electrical) | 8/11 | 9/11 |
| 94 (furniture) | 1/4 | 2/4 |
| 39 (plastics) | 2/5 | 1/5 |
| 65 (headgear) | 2/2 | 1/2 |

+5 chapters gained, 2 lost — net +3, consistent with the headline. The persistent zero/weak chapters (15, 17, 40 at 0/3, 44, 64, 68, 71) are **unchanged** — Opus does not crack them.

## HEADLINE: the 37 stubborn failures

The audit confirmed 37 cases as genuinely wrong for Sonnet v3.2 at 8-digit (the 43 original failures minus 3 accept-set additions minus 3 stale-code corrections; the user's "36" is these minus n31, whose description was corrected during the audit).

**Of those 37 stubborn cases, Opus gets 6 right** (16%):

| case | expected | note |
|---|---|---|
| n14_leather_wallet | 4202.31.60 | genuine same-input rescue |
| n21_wall_calendar | 4910.00.20 | genuine same-input rescue |
| n40_robot_vacuum | 8508.11.00 | genuine same-input rescue |
| n45_smart_speaker | 8518.22.00 | genuine same-input rescue |
| n54_throw_pillow | 9404.90.20 | genuine same-input rescue |
| n31_glass_vase | 7013.99.50 | **not a clean rescue** — n31's description was corrected in the audit ("under $0.30" → "$1.50"), so Opus saw a cleaner input than Sonnet's saved prediction did |

So the **genuine same-input rescue count is 5 of 37 (14%)**.

**Opus also regressed 3 cases** (Sonnet right → Opus wrong at 8-digit): `a12_plastic_container`, `a30_helmet_kit`, `n46_usb_charger` — all clean same-input regressions.

**Net at 8-digit: 60 → 63 (+3).** Opus does not unlock the hard cases. The 31 it still misses are the same blind spots Sonnet has — food chapters, plastics, value/material tiers where the deciding attribute is genuinely absent or the candidate retrieval doesn't surface the controlling note. Those failures are **gold/retrieval-bound, not model-capability-bound**, and a bigger model doesn't move them.

## Refund finder precision/recall (3 sample files, 10 ground-truth misclassifications)

| | Sonnet 4.5 (v3.2) | Opus 4.7 |
|---|---|---|
| **lenient** (correctly flagged as misclassified) | TP=7 FP=4 FN=3 · **P=63.6% R=70.0%** | TP=6 FP=5 FN=4 · **P=54.5% R=60.0%** |
| **strict** (predicted 8-digit == truth 8-digit) | TP=4 FP=7 · P=36.4% R=40.0% | TP=6 FP=5 · **P=54.5% R=60.0%** |

Mixed, and on a small sample (10 misclassifications). Opus is **better at strict** (the recoverable-amount math is more accurate — it picks the exact 8-digit line more often) but **worse at lenient** — it missed one more genuine misclassification (FN 3→4) and added a false positive. For a refund finder, lenient recall is the operationally important metric (did we catch the overpayment at all), and Opus dropped it 70% → 60%. The per-sample story: amazon-fba and vietnam-apparel are a wash; india-houseware is where Opus lost ground (0 TP vs Sonnet's 1, and 2 missed vs 1).

## Latency and cost

**Latency** — 5-case timed, sequential, cold: Sonnet 24.8 s/classification, Opus 15.2 s/classification. **n=5 and noisy** — the per-case variance is dominated by occasional validation retries (a retry doubles the Claude call) and the Voyage embedding round-trip, not model speed. Honest read: **per-classification latency is comparable**; the model swap is not a meaningful latency factor in either direction.

**Cost** — Opus 4.7 is ≈5× Sonnet 4.5 per token (assumed pricing: Sonnet ~$3/$15 per Mtok in/out, Opus ~$15/$75). Per classification ≈ 7.5k input tokens (5.7k system prompt + ~1.8k candidate list) + ~0.8k output:

| | per classification | 97-case eval | 3-sample refund run (49 lines) |
|---|---:|---:|---:|
| Sonnet 4.5 | ≈ $0.034 | ≈ $3.3 | ≈ $1.7 |
| Opus 4.7 | ≈ $0.17 | ≈ $16.7 | ≈ $8.5 |

Cost is the one large, deterministic difference: **~5× across the board.**

## Recommendation (not a decision)

**Keep Sonnet 4.5 as the default. Do not ship Opus, and do not split.**

Reasoning:
- The accuracy edge is real but small: +3 pp top-1 @ 8-digit (60→63 cases). For 5× the cost that is a poor trade.
- The headline test fails: Opus rescues only 5–6 of 37 stubborn cases (14–16%). It does **not** crack the hard failures — those are gold-coverage and retrieval limits, not model limits. A bigger model is the wrong lever; the next real win is in retrieval (surfacing the controlling chapter note) and gold/eval coverage.
- The refund finder — the revenue feature — got **worse** on the operationally important metric (lenient recall 70% → 60%; it missed an extra genuine misclassification). Opus's strict-accuracy gain there is nice for the recoverable-dollar math but secondary to "did we catch the overpayment at all".
- The **split option** (Opus for hard cases, Sonnet otherwise) doesn't pay off: you'd buy ~5–6 extra correct cases for 5× cost on the routed slice, and you'd first need a reliable "is this case hard" router — net new complexity, as the task itself flagged, for a marginal gain.
- The one genuine Opus advantage — cleaner, more decisive low-confidence calibration (a trustworthy 0/8 "low" bucket) — is a nice-to-have for broker triage, not worth a 5× cost increase on its own.

If there is appetite to spend on accuracy, the data points at retrieval and gold coverage, not the model. Revert to Sonnet 4.5 (no code change needed — the default is already `claude-sonnet-4-5`; the Opus run used only the `DEFAULT_MODEL` env override).
