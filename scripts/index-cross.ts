// TODO(CLAUDE.md §2):
//   Ingest CBP CROSS binding rulings from data/cross-rulings/, embed each
//   ruling's product description + reasoning, and upsert into ctx.crossIndex.
//   Source: scraped via ctx.browser (no public CROSS API).

export {};

async function main(): Promise<void> {
  throw new Error("not implemented");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
