"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney, readNDJSON } from "@/lib/api";

type Status = "queued" | "running" | "done" | "error";

interface AgentNode {
  id: string;
  title: string;
  blurb: string;
  status: Status;
  result?: Record<string, unknown>;
}

const NODES: Omit<AgentNode, "status">[] = [
  { id: "classifier", title: "Classifier", blurb: "Retrieves 50 HTS candidates, walks GRI 1–6, cites sources" },
  { id: "duty", title: "Duty calculator", blurb: "Deterministic landed duty: base + 301 + 232 + MPF + HMF" },
  { id: "cross", title: "CROSS verifier", blurb: "Checks the code against live CBP binding rulings" },
  { id: "debate", title: "Adversarial debate", blurb: "Advocate vs challenger, a judge decides" },
  { id: "counterfactual", title: "Tariff engineering", blurb: "Finds legal ways to lower the duty" },
  { id: "audit", title: "Audit defense", blurb: "Simulates a CBP focused-assessment Q&A" },
];

const PRESETS = [
  "Clear silicone protective case that snaps onto an iPhone, with raised camera bezel",
  "Wireless Bluetooth over-ear headphones with rechargeable battery and noise cancellation",
  "Stainless steel double-wall vacuum-insulated water bottle, 750 ml, leakproof lid",
  "LED desk lamp with adjustable aluminum arm, USB-powered",
];

export default function ControlRoomPage() {
  const [description, setDescription] = useState(PRESETS[0]);
  const [running, setRunning] = useState(false);
  const [nodes, setNodes] = useState<AgentNode[]>(NODES.map((n) => ({ ...n, status: "queued" })));
  const [reasoning, setReasoning] = useState("");
  const [dossier, setDossier] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reasonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reasonRef.current) reasonRef.current.scrollTop = reasonRef.current.scrollHeight;
  }, [reasoning]);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    setReasoning("");
    setDossier(null);
    setNodes(NODES.map((n) => ({ ...n, status: "queued" })));
    try {
      const r = await fetch(`${API_BASE_URL}/api/control-room`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!r.ok) {
        setErr(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      for await (const ev of readNDJSON<{ type: string; [k: string]: unknown }>(r)) {
        if (ev.type === "reasoning_delta") {
          setReasoning((p) => p + String(ev.delta ?? ""));
        } else if (ev.type === "agent") {
          const id = ev.id as string;
          const status = ev.status as Status;
          setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, status, result: ev } : n)));
        } else if (ev.type === "done") {
          setDossier((ev.dossier as Record<string, unknown>) ?? null);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [description]);

  const doneCount = nodes.filter((n) => n.status === "done").length;

  return (
    <div className="space-y-8">
      <header>
        <div className="mb-2 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
          Agent control room
        </div>
        <h1 className="text-3xl font-bold text-navy">Run the whole fleet on one product</h1>
        <p className="mt-2 max-w-2xl text-muted">
          One product description, six agents working in concert: classification with cited GRI reasoning,
          deterministic duty math, a live check against CBP&apos;s own rulings database, an adversarial
          debate, tariff-engineering alternatives, and a simulated CBP audit defense. Watch them fire.
        </p>
        <div className="mt-4 space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-cardline bg-white px-3 py-2 text-sm text-navy"
            placeholder="Describe a product the way a seller would…"
          />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setDescription(p)}
                className="rounded-full border border-cardline bg-white px-2.5 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-navy"
              >
                {p.slice(0, 38)}…
              </button>
            ))}
          </div>
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? `Agents working… (${doneCount}/${NODES.length})` : "Launch the agent fleet"}
            <span aria-hidden>→</span>
          </button>
        </div>
      </header>

      {err && <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{err}</div>}

      {/* Pipeline */}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-2">
          {nodes.map((n, i) => (
            <div key={n.id} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={classNames(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition",
                    n.status === "queued" && "bg-navy-50 text-muted",
                    n.status === "running" && "animate-pulse bg-accent text-white",
                    n.status === "done" && "bg-accent text-white",
                    n.status === "error" && "bg-warn/20 text-warn",
                  )}
                >
                  {n.status === "done" ? "✓" : n.status === "error" ? "!" : i + 1}
                </div>
                {i < nodes.length - 1 && (
                  <div className={classNames("w-0.5 flex-1", n.status === "done" ? "bg-accent" : "bg-cardline")} />
                )}
              </div>
              <div
                className={classNames(
                  "mb-2 flex-1 rounded-card border bg-white p-4 shadow-card transition",
                  n.status === "running" && "border-accent ring-1 ring-accent/30",
                  n.status === "done" && "border-accent/40",
                  n.status === "error" && "border-warn/40",
                  n.status === "queued" && "border-cardline opacity-70",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-navy">{n.title}</h3>
                  <span
                    className={classNames(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      n.status === "queued" && "bg-navy-50 text-muted",
                      n.status === "running" && "bg-accent text-white",
                      n.status === "done" && "bg-accent-50 text-accent-700",
                      n.status === "error" && "bg-warn/20 text-warn",
                    )}
                  >
                    {n.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">{n.blurb}</p>
                {n.status === "done" && n.result && <AgentResult id={n.id} r={n.result} />}
                {n.status === "error" && (
                  <p className="mt-1 text-[11px] text-warn">{String(n.result?.message ?? "failed")}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Live reasoning + dossier */}
        <div className="space-y-4">
          <div className="rounded-card border border-cardline bg-white p-3 shadow-card">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {running && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
              Classifier reasoning (live)
            </div>
            <div ref={reasonRef} className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-navy">
              {reasoning || <span className="text-muted">Reasoning will stream here as the classifier thinks…</span>}
            </div>
          </div>
          {dossier && (
            <div className="rounded-card border border-accent bg-navy-50 p-5 shadow-card">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Consolidated dossier</div>
              <div className="mt-1 font-mono text-2xl font-bold text-navy">{String(dossier.hts_code ?? "—")}</div>
              <div className="mt-1 text-xs text-muted">
                {String(dossier.country ?? "")} · {String(dossier.confidence ?? "")} confidence
                {dossier.total_duty_usd_cents != null && (
                  <> · landed duty <span className="font-semibold text-accent-700">{fmtMoney(dossier.total_duty_usd_cents as number)}</span></>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Classified, duty-priced, cross-checked against CBP rulings, debated, tariff-engineered, and
                audit-defended — every step on the record.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentResult({ id, r }: { id: string; r: Record<string, unknown> }) {
  const line = (() => {
    switch (id) {
      case "classifier":
        return `${r.hts_code} · ${r.confidence} · GRI ${r.gri_rule_applied} · ${r.candidate_count} candidates, ${(r.citations as string[])?.length ?? 0} cited`;
      case "duty":
        return `Landed duty ${fmtMoney(r.total_duty_usd_cents as number)} across ${(r.components as unknown[])?.length ?? 0} components`;
      case "cross":
        return r.agrees
          ? `CBP rulings agree (${r.confidence}) — ${r.evidence_count} rulings, e.g. ${r.top_ruling ?? "—"}`
          : `CBP practice differs → ${r.suggested_hts_code ?? "mixed"} (${r.confidence}, ${r.evidence_count} rulings)`;
      case "debate":
        return `${r.winner} wins → ${r.final_hts_code} (advocate ${r.advocate_code} vs challenger ${r.challenger_code})`;
      case "counterfactual":
        return (r.best_savings_usd_cents as number) > 0
          ? `Best: ${r.best_label} — save ${fmtMoney(r.best_savings_usd_cents as number)} (${r.scenario_count} scenarios)`
          : `${r.scenario_count} scenarios considered; no material savings`;
      case "audit":
        return `${r.question_count} auditor questions answered · risk: ${String(r.primary_risk ?? "").slice(0, 80)}`;
      default:
        return "";
    }
  })();
  return <p className="mt-2 text-xs text-navy">{line}</p>;
}
