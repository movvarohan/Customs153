#!/usr/bin/env python3
"""Compute refund-finder precision/recall against `_ground_truth_correct_hts`.

Usage:
  refund_precision_recall.py <sample.json> <findings.json>

Where:
  sample.json   — the input HistoricalEntries file (carries _ground_truth_correct_hts)
  findings.json — the PSC findings output (refund_opportunities + uncertain_cases)

Definitions:
  Ground truth misclassifications: lines where filed_hts != truth (at 8-digit).
  Predicted as misclassifications: refund_opportunities surfaced by the finder.

Precision = (correctly surfaced misclassifications) / (total surfaced)
Recall    = (correctly surfaced misclassifications) / (total ground-truth misclassifications)

"Correctly surfaced" means the predicted classification matches the
ground-truth classification at 8 digits.
"""
from __future__ import annotations
import json
import sys


def strip_to_8(code: str) -> str:
    digits = "".join(c for c in code if c.isdigit())
    return digits[:8]


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sample_path, findings_path = sys.argv[1], sys.argv[2]

    with open(sample_path) as f:
        sample = json.load(f)
    with open(findings_path) as f:
        findings = json.load(f)

    # Build the truth set: (entry_number, line_index) -> {filed_8, truth_8}
    truth = {}
    gt_misclassified = set()
    for e in sample["entries"]:
        for i, li in enumerate(e["line_items"]):
            key = (e["entry_number"], i)
            filed_8 = strip_to_8(li["hts_code_as_filed"])
            truth_8 = strip_to_8(li.get("_ground_truth_correct_hts", li["hts_code_as_filed"]))
            truth[key] = {"filed_8": filed_8, "truth_8": truth_8}
            if filed_8 != truth_8:
                gt_misclassified.add(key)

    # Surfaced refund opportunities — the PSC finder's "we say misclassified"
    surfaced = []
    for opp in findings.get("refund_opportunities", []):
        key = (opp["entry_number"], opp["line_index"])
        pred_8 = strip_to_8(opp["hts_predicted_8"]) if "hts_predicted_8" in opp else strip_to_8(opp["hts_predicted"])
        surfaced.append((key, pred_8))

    tp = 0
    fp = 0
    for key, pred_8 in surfaced:
        t = truth.get(key)
        if t is None:
            continue
        if key in gt_misclassified and pred_8 == t["truth_8"]:
            tp += 1
        else:
            fp += 1

    surfaced_keys = {k for k, _ in surfaced}
    fn = len(gt_misclassified - surfaced_keys)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / len(gt_misclassified) if len(gt_misclassified) > 0 else 0.0

    print(f"sample           : {sample_path}")
    print(f"findings         : {findings_path}")
    print(f"ground-truth misclassifications : {len(gt_misclassified)}")
    print(f"surfaced (TP+FP)                : {len(surfaced)}")
    print(f"  TP (correct pred, right call) : {tp}")
    print(f"  FP (wrong call OR wrong pred) : {fp}")
    print(f"  FN (missed)                   : {fn}")
    print(f"precision : {precision*100:.1f}%")
    print(f"recall    : {recall*100:.1f}%")


if __name__ == "__main__":
    main()
