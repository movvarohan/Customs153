#!/usr/bin/env python3
"""Re-score a saved classifier-eval report against the current gold.jsonl.

The scorer logic mirrors evals/run-classifier-eval.ts scoreCase():
  - disputed cases: any code in accept_set counts at 8-digit
  - 6-digit credit: 8-correct OR honest-6-digit-fallback (precision_level=="6"
    AND code ends .00.00 AND missing_inputs non-empty AND 6-digit prefix matches)
  - top3 = predicted + alternative_codes_considered (8-digit slices)

Usage: rescore.py <report.json>  ->  prints metrics block
"""
import json, sys
from collections import defaultdict

def digits(s): return ''.join(c for c in s if c.isdigit())

gold = {}
for line in open('evals/hts-classification/gold.jsonl'):
    g = json.loads(line)
    gold[g['id']] = g

report = json.load(open(sys.argv[1]))
results = report['results']

n=0
t1_10=t1_8=t3_8=t1_6=chap=cg=0
buckets = defaultdict(lambda: {'n':0,'t1_8':0,'t3_8':0,'t1_6':0})
perchap = defaultdict(lambda: {'n':0,'c':0})
percase = {}  # id -> dict of match flags

for r in results:
    p = r.get('prediction')
    if not p: continue
    cid = r['case'].get('id')
    g = gold.get(cid)
    if not g or g['verification_status']=='unverifiable': continue
    n+=1
    pred10=digits(p['hts_code']); pred8=digits(p['hts_code_8'])[:8]; pred6=pred8[:6]
    exp8=digits(g['expected_hts_8'])[:8]; exp6=exp8[:6]
    exp10=digits(g['expected_hts_10']) if g.get('expected_hts_10') else None
    accept8={exp8}
    if g['verification_status']=='disputed':
        for a in g.get('accept_set',[]): accept8.add(digits(a)[:8])
    accept6={x[:6] for x in accept8}
    plevel=p.get('precision_level','10')
    top3=[pred8]+[digits(a['hts_code'])[:8] for a in p.get('alternative_codes_considered',[])]
    m1_10 = exp10 is not None and pred10==exp10
    m1_8  = pred8 in accept8
    m3_8  = any(t in accept8 for t in top3)
    hsf   = (plevel=='6' and pred8.endswith('00') and pred10.endswith('0000')
             and len(p.get('missing_inputs_for_precision',[]))>0 and pred6 in accept6)
    m1_6  = m1_8 or hsf
    m_chap= pred8[:2]==exp8[:2]
    grounded = r.get('citations_grounded', False)
    if m1_10:t1_10+=1
    if m1_8:t1_8+=1
    if m3_8:t3_8+=1
    if m1_6:t1_6+=1
    if m_chap:chap+=1
    if grounded:cg+=1
    b=buckets[p['confidence']]; b['n']+=1
    if m1_8:b['t1_8']+=1
    if m3_8:b['t3_8']+=1
    if m1_6:b['t1_6']+=1
    pc=perchap[exp8[:2]]; pc['n']+=1
    if m1_8:pc['c']+=1
    percase[cid]={'t1_8':m1_8,'t3_8':m3_8,'t1_6':m1_6}

print(f"== {sys.argv[1]} ==  model={report.get('model')}  scored={n}")
print(f"  top1@10 {t1_10}/{n} ({t1_10/n*100:.1f}%)")
print(f"  top1@8  {t1_8}/{n} ({t1_8/n*100:.1f}%)")
print(f"  top3@8  {t3_8}/{n} ({t3_8/n*100:.1f}%)")
print(f"  top1@6  {t1_6}/{n} ({t1_6/n*100:.1f}%)")
print(f"  chapter {chap}/{n} ({chap/n*100:.1f}%)")
print(f"  grounding {cg}/{n} ({cg/n*100:.1f}%)")
print("  confidence (n / t1@8 / t3@8 / t1@6):")
for k in ('high','medium','low'):
    b=buckets[k]
    if b['n']==0: print(f"    {k}: n=0"); continue
    print(f"    {k}: n={b['n']}  {b['t1_8']/b['n']*100:.0f}% / {b['t3_8']/b['n']*100:.0f}% / {b['t1_6']/b['n']*100:.0f}%")
print("  per-chapter t1@8:", " ".join(f"{c}:{v['c']}/{v['n']}" for c,v in sorted(perchap.items())))
# dump percase to a sidecar for cross-comparison
import os
side = sys.argv[1].replace('.json','.percase.json')
json.dump(percase, open(side,'w'))
print(f"  (per-case flags -> {side})")
