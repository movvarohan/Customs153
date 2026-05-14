#!/usr/bin/env bash
# Tiny CROSS API helper. Sandbox cert validation breaks (clock skew), so -k.
# Usage:
#   cross.sh search "<query>"     -> list rulings + tariffs
#   cross.sh ruling <number>      -> first 3000 chars of ruling text
set -euo pipefail
case "${1:-}" in
  search)
    q="${2:?query required}"
    enc=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$q")
    curl -sk "https://rulings.cbp.gov/api/search?term=${enc}&collection=ALL&pageSize=20" \
      | python3 -c '
import json,sys
d=json.load(sys.stdin)
for r in d.get("rulings",[])[:20]:
  num=r["rulingNumber"]; date=r["rulingDate"][:10]
  tariffs=r.get("tariffs",[]); subj=r.get("subject","")[:90]
  print(num.ljust(10), date, "tariffs=", tariffs, "::", subj)
print("-- total hits:", d.get("totalHits",0))
'
    ;;
  ruling)
    n="${2:?ruling number required}"
    curl -sk "https://rulings.cbp.gov/api/ruling/$n" \
      | python3 -c '
import json,sys
d=json.load(sys.stdin)
t=d.get("text","")
print(t[:3000])
'
    ;;
  *) echo "usage: $0 {search <query> | ruling <number>}" >&2; exit 2;;
esac
