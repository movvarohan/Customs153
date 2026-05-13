// TODO(CLAUDE.md "Eval methodology"):
//   Iterates gold-standard.jsonl, calls classifier agent for each product
//   description, computes top-1@10, top-1@8, top-3@8, citation grounding rate,
//   per-chapter breakdown. Writes JSON report into evals/reports/<timestamp>.json.

async function main(): Promise<void> {
  throw new Error("not implemented");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
