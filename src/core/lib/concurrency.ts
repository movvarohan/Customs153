// Bounded-concurrency map. Pure utility: takes an array of items and a
// per-item async function, runs at most `concurrency` of them in flight
// simultaneously, and returns an array of PromiseSettledResult in input
// order. A single rejection never blocks the rest.
//
// Caller decides what to do with rejections — the helper never throws.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  if (concurrency < 1) throw new Error(`mapWithConcurrency: concurrency must be >= 1, got ${concurrency}`);
  const out: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]!, i);
        out[i] = { status: "fulfilled", value };
      } catch (err) {
        out[i] = { status: "rejected", reason: err };
      }
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
