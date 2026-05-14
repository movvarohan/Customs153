// Bounded async retry. Wraps a thunk with exponential backoff. Returns
// the value on success, or throws the LAST error after all attempts.
//
// Used to harden transient failures inside agent calls (Anthropic 5xx,
// network blips, model output validation that may resolve on retry).

export interface RetryOptions {
  /** Total number of attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff in ms. Wait = base * 2^(attempt-1). Default 1000. */
  baseMs?: number;
  /** Max backoff per wait, ms. Default 16_000. */
  maxMs?: number;
  /** Optional predicate: return false to abort retry early. Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional logger called on each retry. Default: silent. */
  onRetry?: (err: unknown, attempt: number, sleepMs: number) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 16_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err, attempt)) break;
      const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      opts.onRetry?.(err, attempt, wait);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
