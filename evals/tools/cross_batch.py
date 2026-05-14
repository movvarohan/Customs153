#!/usr/bin/env python3
"""Run a batch of CROSS searches and emit a compact summary.

Input: lines of "key|query" on stdin.
Output: for each query, key + top results with assigned tariffs.
Usage:
  echo "case1|cotton scarf" | python3 cross_batch.py
  cat queries.txt | python3 cross_batch.py
"""
import json, sys, urllib.parse, urllib.request, ssl

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

def search(q, page_size=10):
    enc = urllib.parse.quote(q)
    url = f"https://rulings.cbp.gov/api/search?term={enc}&collection=ALL&pageSize={page_size}"
    with urllib.request.urlopen(url, context=CTX, timeout=15) as r:
        return json.loads(r.read())

def fetch_ruling(num):
    url = f"https://rulings.cbp.gov/api/ruling/{num}"
    with urllib.request.urlopen(url, context=CTX, timeout=15) as r:
        return json.loads(r.read())

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            key, q = line.split("|", 1)
        else:
            key, q = line, line
        try:
            d = search(q.strip(), page_size=12)
        except Exception as e:
            print(f"=== {key} ===\nERROR: {e}\n")
            continue
        print(f"=== {key} :: q={q.strip()!r} hits={d.get('totalHits',0)} ===")
        for r in d.get("rulings", [])[:10]:
            num = r["rulingNumber"].ljust(10)
            date = r["rulingDate"][:10]
            tariffs = ",".join(r.get("tariffs", []))[:80]
            subj = r.get("subject", "")[:90]
            print(f"  {num} {date} [{tariffs}] {subj}")
        print()

if __name__ == "__main__":
    main()
