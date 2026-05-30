"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, classNames, readNDJSON } from "@/lib/api";
import { RichText } from "@/components/RichText";

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tools: { name: string; input: Record<string, unknown>; summary?: string }[] };

const SUGGESTIONS = [
  "What's the HTS code for a clear silicone iPhone case from China, and how much duty on a $4,000 shipment?",
  "Classify a stainless steel insulated water bottle and tell me if there's a cheaper way to source it.",
  "I import LED desk lamps from China. What code, what duty on $10k, and any CBP rulings that back it up?",
  "Is a bamboo cutting board 4419.11? What rulings support that?",
];

const TOOL_LABEL: Record<string, string> = {
  classify_product: "Classifying",
  calculate_duty: "Calculating duty",
  tariff_engineering: "Finding tariff-engineering options",
  search_cross_rulings: "Searching CBP CROSS rulings",
};

export default function CopilotPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setErr(null);
      setInput("");
      const history: Turn[] = [...turns, { role: "user", content: q }];
      setTurns([...history, { role: "assistant", content: "", tools: [] }]);
      setBusy(true);
      try {
        const wire = history.map((t) => ({ role: t.role, content: t.content }));
        const r = await fetch(`${API_BASE_URL}/api/copilot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: wire }),
        });
        if (!r.ok) {
          setErr(`backend ${r.status}: ${await r.text()}`);
          return;
        }
        for await (const ev of readNDJSON<{ type: string; [k: string]: unknown }>(r)) {
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return prev;
            if (ev.type === "text_delta") {
              last.content += String(ev.delta ?? "");
            } else if (ev.type === "tool_call") {
              last.tools = [...last.tools, { name: String(ev.name), input: (ev.input as Record<string, unknown>) ?? {} }];
            } else if (ev.type === "tool_result") {
              const t = [...last.tools];
              for (let i = t.length - 1; i >= 0; i--) {
                const ti = t[i];
                if (ti && ti.name === ev.name && ti.summary === undefined) {
                  t[i] = { ...ti, summary: String(ev.summary) };
                  break;
                }
              }
              last.tools = t;
            } else if (ev.type === "error") {
              setErr(String(ev.message));
            }
            return [...next.slice(0, -1), { ...last }];
          });
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [turns, busy],
  );

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Customs copilot
        </div>
        <h1 className="text-3xl font-bold text-navy">Ask the agent anything</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Talk to it in plain English. It can&apos;t state an HTS code, a duty figure, or a CBP ruling from
          memory — it has to use its tools, so you watch it classify, price duty, run tariff-engineering,
          and search CBP&apos;s rulings database live, then explain the answer.
        </p>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      <div className="min-h-[280px] space-y-4">
        {turns.length === 0 && (
          <div className="rounded-card border border-cardline bg-white p-4 shadow-card">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">Try asking</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((sg) => (
                <button
                  key={sg}
                  onClick={() => send(sg)}
                  className="rounded-md border border-cardline bg-navy-50/50 px-3 py-2 text-left text-xs text-navy transition hover:border-accent/40 hover:bg-accent-50/50"
                >
                  {sg}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-card rounded-tr-sm bg-navy px-4 py-2.5 text-sm text-white">{t.content}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] space-y-2">
                {t.tools.length > 0 && (
                  <div className="space-y-1">
                    {t.tools.map((tool, k) => (
                      <div key={k} className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-50/40 px-2.5 py-1.5 text-[11px]">
                        <span className={classNames("inline-block h-1.5 w-1.5 rounded-full", tool.summary ? "bg-accent" : "animate-pulse bg-amber-400")} aria-hidden />
                        <span className="font-semibold text-accent-700">{TOOL_LABEL[tool.name] ?? tool.name}</span>
                        <span className="truncate font-mono text-muted">
                          {tool.input.description ? String(tool.input.description).slice(0, 38) : tool.input.hts_code_8 ? String(tool.input.hts_code_8) : tool.input.query ? String(tool.input.query).slice(0, 38) : ""}
                        </span>
                        {tool.summary && <span className="ml-auto shrink-0 font-mono text-navy">→ {tool.summary}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {t.content && (
                  <div className="rounded-card rounded-tl-sm border border-cardline bg-white px-4 py-2.5 text-sm leading-relaxed text-navy shadow-card">
                    <RichText text={t.content} />
                    {busy && i === turns.length - 1 && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent/70 align-middle" aria-hidden />}
                  </div>
                )}
                {!t.content && t.tools.length === 0 && busy && i === turns.length - 1 && (
                  <div className="rounded-card border border-cardline bg-white px-4 py-2.5 text-sm text-muted shadow-card">Thinking…</div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask about a product, a code, duty, savings, or a ruling…"
          className="flex-1 rounded-md border border-cardline bg-white px-4 py-3 text-sm text-navy shadow-card focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white shadow-card transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
