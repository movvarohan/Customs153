"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

interface SkuRow {
  customer_id: string;
  sku: string;
  canonical_description: string;
  current_hts_code: string;
  current_hts_code_8: string;
  source: "agent" | "broker";
  current_classification_id: string | null;
  last_classified_at: string;
}

export default function BrokerCopilotPage() {
  const [rows, setRows] = useState<SkuRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/broker/sku-memory`, { cache: "no-store" });
      if (!r.ok) {
        setError(`backend ${r.status}: ${await r.text()}`);
        return;
      }
      const j = (await r.json()) as { rows: SkuRow[] };
      setRows(j.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirm = useCallback(
    async (description: string, hts_code: string, action: "confirm" | "correct") => {
      setBusy(description);
      try {
        const r = await fetch(`${API_BASE_URL}/api/broker/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description, hts_code }),
        });
        if (!r.ok) {
          setError(`${action} failed: ${r.status} ${await r.text()}`);
          return;
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const agentRows = rows?.filter((r) => r.source === "agent") ?? [];
  const brokerRows = rows?.filter((r) => r.source === "broker") ?? [];

  return (
    <div className="space-y-8">
      <header>
        <div className="mb-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
          Broker partner view
        </div>
        <h1 className="text-3xl font-bold text-navy">Classification queue</h1>
        <p className="mt-2 max-w-2xl text-muted">
          What the licensed broker partner sees. Every line the agent classified for this importer
          appears here. Confirm to add the broker's signature to the record; edit to override and
          push the correction back into the per-importer SKU memory so the agent gets it right next
          time.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-warn/40 bg-white px-3 py-2 text-sm text-warn">
          {error}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
          Pending broker review ({agentRows.length})
          <span className="ml-2 text-[11px] font-normal normal-case text-muted">
            agent-only predictions — no broker signature yet
          </span>
        </h2>
        {agentRows.length === 0 ? (
          <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
            No pending classifications. Process an invoice on{" "}
            <code className="rounded bg-navy-50 px-1 text-[11px]">/process-invoice</code> and rows
            will appear here.
          </div>
        ) : (
          <ClassificationGrid
            rows={agentRows}
            edits={edits}
            setEdits={setEdits}
            busy={busy}
            confirm={confirm}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
          Broker-confirmed SKU memory ({brokerRows.length})
          <span className="ml-2 text-[11px] font-normal normal-case text-muted">
            these become a hint to the classifier on the next shipment
          </span>
        </h2>
        {brokerRows.length === 0 ? (
          <div className="rounded-card border border-cardline bg-white p-4 text-sm text-muted shadow-card">
            Confirm or correct a pending row above to see it move here.
          </div>
        ) : (
          <ClassificationGrid
            rows={brokerRows}
            edits={edits}
            setEdits={setEdits}
            busy={busy}
            confirm={confirm}
          />
        )}
      </section>

      <p className="text-[11px] italic text-muted">
        Demo single-tenant note: all rows are keyed to a placeholder "demo" customer. Production
        scopes per importer-of-record.
      </p>
    </div>
  );
}

function ClassificationGrid({
  rows,
  edits,
  setEdits,
  busy,
  confirm,
}: {
  rows: SkuRow[];
  edits: Record<string, string>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: string | null;
  confirm: (description: string, hts_code: string, action: "confirm" | "correct") => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-cardline bg-white shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-cardline bg-navy-50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
            <th className="py-3 pl-4 pr-3">Description</th>
            <th className="py-3 pr-3">Agent code</th>
            <th className="py-3 pr-3">Broker code (edit to override)</th>
            <th className="py-3 pr-3">Last seen</th>
            <th className="py-3 pr-4">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const edit = edits[r.sku] ?? r.current_hts_code;
            const dirty = edit !== r.current_hts_code;
            const valid = /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(edit);
            const isBusy = busy === r.canonical_description;
            return (
              <tr
                key={r.sku}
                className={classNames(
                  "border-b border-cardline/60 align-top last:border-b-0",
                  i % 2 === 1 && "bg-navy-50/30",
                )}
              >
                <td className="py-3 pl-4 pr-3 text-navy">{r.canonical_description}</td>
                <td className="py-3 pr-3 font-mono text-navy">{r.current_hts_code_8}</td>
                <td className="py-3 pr-3">
                  <input
                    value={edit}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [r.sku]: e.target.value }))
                    }
                    className={classNames(
                      "w-40 rounded-md border bg-white px-2 py-1 font-mono text-xs",
                      valid ? "border-cardline" : "border-warn/60",
                    )}
                    placeholder="XXXX.XX.XX.XX"
                  />
                  {!valid && (
                    <div className="mt-0.5 text-[10px] text-warn">10-digit dotted form required</div>
                  )}
                </td>
                <td className="py-3 pr-3 text-[11px] text-muted">
                  {new Date(r.last_classified_at).toLocaleString()}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!valid || isBusy}
                      onClick={() =>
                        confirm(r.canonical_description, edit, dirty ? "correct" : "confirm")
                      }
                      className={classNames(
                        "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                        dirty
                          ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                          : "bg-accent text-white hover:bg-accent-700",
                        (!valid || isBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {dirty ? "Save correction" : "Confirm"}
                    </button>
                    {r.source === "broker" && !dirty && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-700">
                        signed
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
// quiet unused-import warning on fmtMoney (kept for parity with other pages)
void fmtMoney;
