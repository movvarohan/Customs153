// TODO(CLAUDE.md "Scripts"):
//   Re-runnable job that ingests the raw HTS schedule from data/hts-schedule/,
//   chunks chapter notes + headings, embeds via ctx.embeddings, and upserts
//   into ctx.htsIndex (local vector store today, Vectorize later).

export {};

async function main(): Promise<void> {
  throw new Error("not implemented");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
