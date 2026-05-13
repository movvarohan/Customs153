// TODO(CLAUDE.md "Stack" — Vectorize, "Scripts"):
//   One-time (and re-runnable) job that ingests the raw HTS schedule from
//   data/hts-schedule/, chunks chapter notes + headings, embeds via Workers AI,
//   and upserts into the HTS_INDEX Vectorize index.

async function main(): Promise<void> {
  throw new Error("not implemented");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
