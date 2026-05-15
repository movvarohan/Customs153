# Retrieval diagnostic — the 37 stubborn v3.2 failures

**Question.** For the 37 cases Sonnet v3.2 gets genuinely wrong at 8-digit (audit-confirmed; not accept-set-defensible), was the correct code actually in the top-50 retrieved candidates? If yes → the model had the answer and missed it (a verifier can help). If no → retrieval never surfaced it (a verifier cannot help; retrieval must improve).

**Method.** Pure analysis on saved data — no model calls. Candidates pulled from `audit_log` (every classification trace stores its 50 retrieved candidates). Retrieval is deterministic per description, so the candidate set is identical across runs. A case counts as "retrieval got it" if any candidate's 8-digit prefix matches the gold `expected_hts_8` (or any `accept_set` code, for disputed cases). All 37 had an audit trace; 0 unresolved.

## Headline

| outcome | count | share |
|---|---:|---:|
| **retrieval GOT it** — correct 8-digit was in the top-50, model picked wrong anyway | **20** | 54% |
| **retrieval MISSED it** — correct 8-digit not in the top-50 at all | **17** | 46% |

It is a near-even split — **not** a clean signal in either direction.

## Rank of the correct code (the 20 retrieval got)

| rank band | in band | cumulative |
|---|---:|---:|
| top-5 | 9 | 9 |
| rank 6–10 | 4 | 13 |
| rank 11–25 | 4 | 17 |
| rank 26–50 | 3 | 20 |

**13 of the 20 were in the top-10**, 9 in the top-5. Where retrieval got it, it got it *prominently* — the model had the correct line sitting near the top of its candidate list and still chose another. That is a strong reasoning-failure signal, not a retrieval-depth problem.

## By chapter — retrieval bottleneck vs reasoning bottleneck

**Pure retrieval bottleneck** (correct code never retrieved — a verifier categorically cannot fix these):

| chapter | missed | cases |
|---|---:|---|
| 40 rubber | 3 | yoga mat, mouse pad, bike repair kit |
| 33 cosmetics | 2 | sheet mask, vitamin-C serum |
| 95 toys/festive | 2 | (TPE) yoga mat alt, Halloween décor |
| 17 sugar | 1 | granola bar |
| 68 stone | 1 | cat litter |
| 84 machinery | 1 | wireless mouse |
| (also 1 each in 39, 42, 44, 63, 85) | | |

**Pure reasoning bottleneck** (retrieval surfaced the correct code, model missed it):

| chapter | got | cases |
|---|---:|---|
| 82 tools | 2 | bbq spatula (r7), pumpkin kit (r28) |
| 49, 61, 64, 69, 70, 71, 76, 91 | 1 each | wall calendar (r3), wool scarf (r4), running shoes (r12), ceramic plate (r7), glass vase (r4), pearl necklace (r4), aluminum pan (r1), quartz watch (r37) |
| (also 2 in 39, 2 in 42, 2 in 85, 2 in 94) | | |

**Mixed** (both failure modes present): ch 39, 42, 44, 63, 85, 94.

## Per-case detail

**Retrieval got it (20)** — `case · chapter · rank`:
n34_aluminum_pan·76·r1 · n40_robot_vacuum·85·r1 · n21_wall_calendar·49·r3 · n54_throw_pillow·94·r3 · a32_pearl_necklace·71·r4 · a39_wool_scarf·61·r4 · n31_glass_vase·70·r4 · n45_smart_speaker·85·r4 · n19_wood_coaster·44·r5 · n53_office_chair·94·r6 · n14_leather_wallet·42·r7 · n30_ceramic_plate·69·r7 · n38_bbq_spatula·82·r7 · n26_bed_sheet·63·r11 · a28_handbag_generic·42·r12 · n27_running_shoes·64·r12 · n10_silicone_utensils·39·r14 · n37_pumpkin_kit·82·r28 · n11_silicone_food_wrap·39·r31 · n52_quartz_watch·91·r37

**Retrieval missed it (17)**:
a07_iphone_case·39 · a13_smartwatch·85 · a14_yoga_mat·95 · a17_votive·94 · a18_jewelry_box·42 · a21_rubber_gloves·40 · a23_wireless_mouse·84 · a24_mouse_pad·40 · a25_tablet_case·42 · a33_halloween_decor·95 · a36_bike_repair·40 · n01_granola_bar·17 · n07_sheet_mask·33 · n08_vitc_serum·33 · n18_wine_rack·44 · n55_pet_bed·63 · n59_cat_litter·68

## What the numbers say about the next session

The split is 54/46 — close enough that **neither lever is a slam dunk, and the two failure populations barely overlap**, so they are not substitutes:

- **Verifier headroom is ~20 cases** (the retrieval-got-it set). A second-pass verifier can only ever help cases where the correct code is in the candidate set — it re-reads what retrieval already surfaced. 13 of those 20 are top-10, so the signal a verifier would work from is strong. But note: the verifier already built and evaluated last session rescued only 5 and broke 5 on the full set — net zero. So the 20-case headroom is real, but converting it needs a *better* verifier than the one already tried (hence the user's "CROSS-grounded verifier" framing — a verifier that checks the predicted line against actual CROSS rulings, not just the HTS text the model already saw).

- **Retrieval headroom is ~17 cases** (the retrieval-missed-it set) — a hard wall for *any* verifier. These need retrieval work: chapter-note-aware indexing, hybrid BM25 + dense, or a reranker. The misses cluster in chapters where the deciding text is a chapter/section note or an exclusion (ch 40 rubber-vs-plastic, ch 33 cosmetic-vs-textile-substrate, ch 95 festive/toy exclusions) — exactly the content a notes-aware re-index would surface.

**Per the user's stated decision rule** ("if retrieval got it for *most* of the 37 → verifier"): 20/37 is a bare majority, so the rule points — weakly — at the **CROSS-grounded verifier** as the next session. But the honest read is that this is a 54/46 split, not a "most": ~46% of the stubborn failures are untouchable by any verifier, and the cleanest single result here is that **a verifier and a retrieval upgrade address almost disjoint case sets** — whichever is done first, the other still has ~17–20 cases of headroom left. If sequencing matters: the verifier is cheaper to attempt (no re-indexing, no embedding recompute) and has slightly more headroom, but the prior verifier result (5 rescue / 5 break) is a caution that the headroom is hard to convert.
