// Frontend → backend client. The backend's NDJSON streaming endpoints
// emit one JSON object per newline; readNDJSON yields each one as soon
// as it's flushed.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/**
 * Read a fetch Response body as a stream of NDJSON objects. Yields each
 * parsed object in order. Tolerates partial chunks split mid-line.
 */
export async function* readNDJSON<T = unknown>(res: Response): AsyncGenerator<T, void, void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const ln of lines) {
        const trimmed = ln.trim();
        if (!trimmed) continue;
        yield JSON.parse(trimmed) as T;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer.trim()) as T;
  } finally {
    reader.releaseLock();
  }
}

export function fmtMoney(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents) / 100;
  return `${sign}${currency === "USD" ? "$" : ""}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${currency !== "USD" ? " " + currency : ""}`;
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
