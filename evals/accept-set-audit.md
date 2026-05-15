# Accept-set audit — v3.2 predictions vs the 97-case gold set

**Method.** For each of v3.2's 43 wrong-at-8-digit predictions, the predicted code was checked against real CBP practice: is there a CROSS ruling assigning that code to a materially similar product, or does HTS text genuinely permit it? Searches and rulings were pulled from `rulings.cbp.gov` via `evals/tools/cross.sh` / `cross_batch.py`. A code was added to a case's `accept_set` only when a real ruling on a materially similar product supports it.

## Result

- **43** v3.2 wrong-at-8-digit predictions audited.
- **3 accept-set additions** made (genuine CBP-practice splits).
- **3 stale-code gold corrections** made (gold code does not exist in the HTS-2026 schedule — separate from accept-set work, reported here for transparency).
- **1 description fix** (internal value-tier contradiction).
- The remaining **36** were left unchanged — the predicted code is not defensible (no supporting ruling; wrong chapter/heading; wrong material; or a value tier the description rules out).

## v3.2 top-1 @ 8-digit on the same predictions

| gold set | top-1 @ 8-digit |
|---|---|
| before audit | 54/97 — **55.7%** |
| + 3 accept-set additions | 57/97 — **58.8%** |
| + 3 stale-code corrections | 60/97 — **61.9%** |

The 6 flips are all WRONG→RIGHT; no case regressed (accept-set additions and code corrections can only add matches).

## Accept-set additions — audit trail (spot-checkable)

| case | product | v3.2 predicted | gold expected (kept) | added to accept_set | CROSS support — fetch at rulings.cbp.gov/ruling/<N> |
|---|---|---|---|---|---|
| a03_usbc_cable | USB-C to USB-C charging cable | `8544.42.90` | `8544.42.20` | **`8544.42.90`** | **N281995** — "USB/charging cord" → 8544.42.9090. **N007536** — "USB Cable" → 8544.42.9000. (Gold's .20 is also CROSS-backed: N258119, N250764. Genuine split — connector cables go to .20 *or* .90 depending on the ruling.) |
| a11_mug | Glazed earthenware coffee mug | `6912.00.44` | `6912.00.41` | **`6912.00.44`** | **N262709** — "stoneware ceramic mug" → 6912.00.4400. **D83458** — "ceramic mug" → 6912.00.4400. **C85125** — "ceramic mugs" → 6912.00.4400. (Materially identical: a ceramic/earthenware coffee mug. .41 = eo-nomine "Mugs and other steins"; .44/.48 = CBP-practice lines.) |
| a31_xmas_tree | Plastic artificial Christmas tree | `9505.10.40` | `9505.10.25` | **`9505.10.40`** | **HQ 086299** — *expressly* modifies a prior NY ruling and reclassifies "an artificial Christmas tree, made primarily of plastic" from 9505.10.2500 to **9505.10.4000**, holding that 9505.10.25 is for Christmas *ornaments* only and the tree itself is "Other … of plastics". A Headquarters ruling directly on point. (Modern NY rulings N268807/N302865 still use .25 — genuine split.) |

## Stale-code gold corrections (NOT accept-set additions — reported for transparency)

These three cases carried HTS codes from the pre-2022-HS schedule that **no longer exist** in the HTS-2026 schedule shipped in `data/hts/raw/hts-2026.json`. The classifier's prediction was the correct *current* code; the gold was simply out of date. `expected_hts_8` was corrected (not accept-set-expanded — the old code is wrong, not "an alternative").

| case | old gold (stale) | corrected to | evidence |
|---|---|---|---|
| n04_olive_oil | `1509.10.20` | `1509.20.20` | HS 2022 restructured heading 1509. HTS-2026 schedule has 1509.20 "Extra virgin olive oil", 1509.20.20 "under 18 kg container"; **no 1509.10 exists** (0 rows). v3.2 predicted 1509.20.20. |
| n17_picture_frame | `4414.00.00` | `4414.90.00` | HS 2022 split heading 4414 into 4414.10 "Of tropical wood" / 4414.90 "Other". HTS-2026 schedule: `4414.10.00.00`, `4414.90.00.00`; **no 4414.00 exists**. Pine is not HTS-defined tropical wood → 4414.90. v3.2 predicted 4414.90.00. |
| n41_led_bulb | `8539.50.00` | `8539.52.00` | HS 2022 created 8539.52 "Light-emitting diode (LED) lamps". HTS-2026 schedule: `8539.51.00`, `8539.52.00.*`; **no 8539.50 exists**. v3.2 predicted 8539.52.00. |

## Description fix (internal inconsistency)

| case | issue | fix |
|---|---|---|
| n31_glass_vase | Description said "valued **under $0.30** each" but `expected_hts_8` `7013.99.50` is the **">$0.30 but ≤$3"** value tier — a contradiction, and the cited rulings (D87915, H87220, N241995) all classified articles in that >$0.30 tier. | Description value changed to "valued **$1.50** each" so the case is internally consistent and answerable. Code unchanged. (Does not affect the v3.2 re-score: v3.2 predicted 7013.99.40, still ≠ .50.) |

## Cases examined and left unchanged (sample of the strict rejections)

| case | v3.2 predicted | why NOT added |
|---|---|---|
| a13_smartwatch | 9102.12.40 | CBP HQ (H273382 and follow-ons) classify smartwatches at 8517.62; 9102 is settled-wrong. |
| a14_yoga_mat | 3926.90.75 | 3926.90.75 is inflatable articles; a TPE foam mat is not inflatable. CBP uses 9506.91 (N260624). |
| a23_wireless_mouse | 9017.20.80 | 9017 is drawing/marking instruments; no ruling puts a mouse there. CBP: 8471.60. |
| a32_pearl_necklace | 7117.90.55 | B82838 used .55 only for a sub-20¢/dozen toy necklace; a32 is a real necklace with a silver-plated clasp — not materially similar. Modern rulings unanimously use .75. |
| n01_granola_bar | 1904.20.10 | H87925's 1904.20.10 was for *loose* muesli in bags; n01 is a *bar*. CBP's bar ruling N004034 → 1704.90.35. Not materially similar. |
| n10_silicone_utensils | 8215.20.00 | L83133/I88237 used 8215.20.00 for *heterogeneous* utensil sets (wood+ceramic+steel+plastic); n10 is a uniform silicone set — closest rulings (N290525, N288725) use 3924.10.40. |
| n19_wood_coaster | 4419.20.90 | 4419.20 is "of tropical wood" (a defined HTS list); mango is not on it. R04475 ("mango wood coaster") → the 4419.90 residual. |
| n21_wall_calendar | 4910.00.60 | 4910.00.60 rulings (085104, A86136) are *textile* and *wooden* calendars; n21 is a paper calendar → 4910.00.20. |
| n40_robot_vacuum | 8508.60.00 | Five CROSS rulings (N319849, N322925, N312025, N326460, N322828) all classify robotic vacuum cleaners at 8508.11.00. None use 8508.60. |
| n45_smart_speaker | 8543.70.91 | N306364 ("a smart speaker") and H319100 use 8518.22; 8543.70 is residual and unused for smart speakers. |
| n54_throw_pillow | 6304.99.40 | 6304 excludes articles of heading 9404; a *stuffed* pillow is 9404.90.20 (N300966, N287328, N300569). |

(Full 36-case rejection list is implicit in `evals/hts-classification/gold.jsonl` — every wrong-at-8 case not listed above as changed was examined and left as-is.)

## Files changed

- `evals/tools/build_gold.py` — the 3 accept-set additions, 3 code corrections, 1 description fix.
- `evals/hts-classification/gold.jsonl` — regenerated (status counts now verified=77, corrected=12, disputed=8, unverifiable=3).
- `evals/GOLD_REVIEW.md` — regenerated.
