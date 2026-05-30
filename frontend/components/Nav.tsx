"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { classNames } from "@/lib/api";

interface Item { href: string; label: string; desc: string }
interface Group { label: string; items: Item[] }

// The 12 surfaces, organized into four task-based groups so the top bar stays
// clean and the relationships between surfaces are obvious.
const GROUPS: Group[] = [
  {
    label: "Workspace",
    items: [
      { href: "/copilot", label: "Copilot", desc: "Ask anything — classify, price, engineer duty" },
      { href: "/process-invoice", label: "Process invoice", desc: "Extract → classify → price a live entry" },
      { href: "/find-refunds", label: "Find refunds", desc: "Scan past entries for recoverable duty" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/control-room", label: "Control room", desc: "Watch the agent fleet work in real time" },
      { href: "/simulator", label: "Policy lab", desc: "Model tariff shocks across the catalog" },
      { href: "/catalog", label: "Catalog", desc: "Portfolio duty + sourcing strategy" },
    ],
  },
  {
    label: "Broker & monitoring",
    items: [
      { href: "/broker", label: "Broker queue", desc: "Licensed-broker review & approval" },
      { href: "/regulatory", label: "Reg watch", desc: "Federal Register / CSMS tariff alerts" },
      { href: "/audit-broker", label: "Audit broker", desc: "Guided ACE portal data pull" },
    ],
  },
  {
    label: "Trust",
    items: [
      { href: "/methodology", label: "Methodology", desc: "Eval set, accuracy, how we classify" },
      { href: "/audit-trail", label: "Audit trail", desc: "Reasonable-care logging & sources" },
      { href: "/", label: "About", desc: "What this platform is" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement | null>(null);

  // Close on route change, outside click, and Escape.
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <nav ref={ref} className="flex items-center gap-1 text-sm">
      {GROUPS.map((g) => {
        const groupActive = g.items.some((it) => isActive(pathname, it.href));
        const isOpen = open === g.label;
        return (
          <div
            key={g.label}
            className="relative"
            onMouseEnter={() => setOpen(g.label)}
            onMouseLeave={() => setOpen((cur) => (cur === g.label ? null : cur))}
          >
            <button
              type="button"
              onClick={() => setOpen((cur) => (cur === g.label ? null : g.label))}
              aria-expanded={isOpen}
              className={classNames(
                "flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition",
                isOpen
                  ? "bg-navy-50 text-navy"
                  : groupActive
                    ? "text-navy"
                    : "text-muted hover:bg-navy-50/60 hover:text-navy",
              )}
            >
              {g.label}
              <svg
                width="11" height="11" viewBox="0 0 12 12" aria-hidden
                className={classNames("transition-transform", isOpen ? "rotate-180" : "", groupActive ? "text-accent" : "text-muted/70")}
              >
                <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {groupActive && <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>

            {isOpen && (
              <div className="absolute left-0 top-full z-50 pt-2">
                <div className="w-72 overflow-hidden rounded-card border border-cardline bg-white p-1.5 shadow-lg">
                  {g.items.map((it) => {
                    const active = isActive(pathname, it.href);
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        className={classNames(
                          "block rounded-lg px-3 py-2 transition",
                          active ? "bg-accent-50" : "hover:bg-navy-50",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={classNames("text-[13px] font-semibold", active ? "text-accent-700" : "text-navy")}>
                            {it.label}
                          </span>
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted">{it.desc}</div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
