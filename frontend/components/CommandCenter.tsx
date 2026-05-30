"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE_URL, classNames, fmtMoney } from "@/lib/api";

interface Snapshot {
  importer: string;
  annual_value_usd_cents: number;
  annual_duty_usd_cents: number;
  sku_count: number;
  pending_review: number;
  flagged: number;
  psc_open: number;
  urgent: number;
  actionable_duty_usd_cents: number;
  next_deadline_days: number | null;
}

// Live operations dashboard for the importer — the single pane of glass that
// aggregates the duty exposure, the broker queue, and the deadline tracker.
export function CommandCenter() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [catR, brkR, dlR] = await Promise.all([
          fetch(`${API_BASE_URL}/api/catalog`, { cache: "no-store" }),
          fetch(`${API_BASE_URL}/api/broker/queue`, { cache: "no-store" }),
          fetch(`${API_BASE_URL}/api/deadlines`, { cache: "no-store" }),
        ]);
        if (!catR.ok || !brkR.ok || !dlR.ok) { setFailed(true); return; }
        const cat = await catR.json();
        const brk = await brkR.json();
        const dl = await dlR.json();
        const urgentEntries = (dl.entries ?? []).filter((e: { urgency: string }) => e.urgency === "urgent");
        const actionable = (dl.entries ?? []).filter((e: { actionable: boolean }) => e.actionable);
        const nextDays = actionable.length > 0 ? Math.min(...actionable.map((e: { days_left: number }) => e.days_left)) : null;
        setSnap({
          importer: dl.summary?.importer ?? "Atlas Retail Holdings LLC",
          annual_value_usd_cents: cat.total_value_usd_cents,
          annual_duty_usd_cents: cat.total_duty_usd_cents,
          sku_count: cat.sku_count,
          pending_review: brk.summary?.pending ?? 0,
          flagged: brk.summary?.flagged ?? 0,
          psc_open: dl.summary?.psc_open ?? 0,
          urgent: urgentEntries.length,
          actionable_duty_usd_cents: dl.summary?.actionable_duty_usd_cents ?? 0,
          next_deadline_days: nextDays,
        });
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  if (failed) return null;

  const attention: Array<{ tone: "warn" | "amber" | "accent"; text: string; href: string; cta: string }> = [];
  if (snap) {
    if (snap.urgent > 0) attention.push({ tone: "warn", text: `${snap.urgent} ${snap.urgent === 1 ? "entry has" : "entries have"} a refund window closing within 30 days${snap.next_deadline_days != null ? ` (soonest: ${snap.next_deadline_days} days)` : ""}.`, href: "/deadlines", cta: "Review deadlines" });
    if (snap.pending_review > 0) attention.push({ tone: "amber", text: `${snap.pending_review} ${snap.pending_review === 1 ? "classification is" : "classifications are"} awaiting licensed-broker review.`, href: "/broker", cta: "Open broker queue" });
    if (snap.actionable_duty_usd_cents > 0) attention.push({ tone: "accent", text: `${fmtMoney(snap.actionable_duty_usd_cents)} of duty sits in still-actionable PSC/protest windows — audit it before it expires.`, href: "/find-refunds", cta: "Run refund audit" });
  }

  return (
    <section className="rounded-card border border-cardline bg-white p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Operations snapshot</h2>
          </div>
          <div className="mt-0.5 text-lg font-bold text-navy">{snap?.importer ?? "Loading…"}</div>
        </div>
        <Link href="/deadlines" className="text-xs font-semibold text-accent-700 hover:underline">Open deadline tracker →</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Annual duty exposure" value={snap ? fmtMoney(snap.annual_duty_usd_cents) : "…"} sub={snap ? `on ${fmtMoney(snap.annual_value_usd_cents)}` : ""} />
        <Tile label="SKUs classified" value={snap ? String(snap.sku_count) : "…"} sub="in SKU memory" />
        <Tile label="Pending broker review" value={snap ? String(snap.pending_review) : "…"} sub="awaiting signature" amber={!!snap && snap.pending_review > 0} />
        <Tile label="PSC windows open" value={snap ? String(snap.psc_open) : "…"} sub={snap?.urgent ? `${snap.urgent} urgent` : "entries"} warn={!!snap && snap.urgent > 0} />
        <Tile label="Duty in open windows" value={snap ? fmtMoney(snap.actionable_duty_usd_cents) : "…"} sub="still recoverable" accent />
      </div>

      {attention.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Needs attention</div>
          {attention.map((a, i) => (
            <div key={i} className={classNames(
              "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
              a.tone === "warn" ? "border-warn/40 bg-warn/5" : a.tone === "amber" ? "border-amber-300 bg-amber-50/50" : "border-accent/40 bg-accent-50/40",
            )}>
              <span className="text-navy">{a.text}</span>
              <Link href={a.href} className="shrink-0 text-xs font-semibold text-accent-700 hover:underline">{a.cta} →</Link>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { href: "/find-refunds", label: "Run refund audit" },
          { href: "/quote", label: "Instant quote" },
          { href: "/simulator", label: "Policy lab" },
          { href: "/catalog", label: "Catalog & sourcing" },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="rounded-md border border-cardline bg-white px-3 py-1.5 text-xs font-semibold text-navy transition hover:border-accent/40 hover:bg-accent-50">
            {q.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Tile({ label, value, sub, accent, warn, amber }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; amber?: boolean }) {
  return (
    <div className={classNames("rounded-md border p-3", accent ? "border-accent/50 bg-accent-50/30" : warn ? "border-warn/40" : amber ? "border-amber-300" : "border-cardline")}>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={classNames("mt-0.5 text-xl font-bold tabular-nums", accent ? "text-accent-700" : warn ? "text-warn" : "text-navy")}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}
