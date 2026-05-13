# Classifier evals

See CLAUDE.md → "Eval methodology" for the source of truth.

## Gold-standard set

`gold-standard.jsonl` — held-out CBP CROSS rulings. One JSON object per line:

```json
{"rulingNumber": "NY N123456", "productDescription": "...", "correctHts10": "8518.30.2000"}
```

We do not commit the full set into git (large, and the source rulings are public domain
but voluminous). The file is materialized by `scripts/index-cross.ts` with a hold-out
flag, or pulled from the REFERENCE R2 bucket.

## Running

```bash
pnpm eval:classifier
```

Writes a timestamped report into `reports/`. Targets for MVP:

- > 80% top-1 at 8-digit
- > 90% top-3 at 8-digit
- 100% citation grounding rate

Every classifier change must be measured against this set before merging.
