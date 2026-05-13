// TODO(CLAUDE.md "Out of scope for MVP" — "Real-time tariff rate API"):
//   Loads data/tariff-rates/<version>.json, validates with schemas/duty.ts,
//   writes to KV CACHE under "tariff:<version>" and updates "tariff:current".
//   Run weekly when we publish a new versioned table.

async function main(): Promise<void> {
  throw new Error("not implemented");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
