"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { classNames } from "@/lib/api";

const ITEMS: Array<{ href: string; label: string }> = [
  { href: "/control-room", label: "Control room" },
  { href: "/process-invoice", label: "Process invoice" },
  { href: "/find-refunds", label: "Find refunds" },
  { href: "/broker", label: "Broker queue" },
  { href: "/regulatory", label: "Reg watch" },
  { href: "/audit-broker", label: "Audit broker" },
  { href: "/methodology", label: "Methodology" },
  { href: "/audit-trail", label: "Audit trail" },
  { href: "/", label: "About" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-6 text-sm">
      {ITEMS.map((it) => {
        const active =
          it.href === "/"
            ? pathname === "/"
            : pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={classNames(
              "relative py-1 transition",
              active ? "font-semibold text-navy" : "text-muted hover:text-navy",
            )}
          >
            {it.label}
            <span
              aria-hidden
              className={classNames(
                "absolute -bottom-1 left-0 right-0 h-0.5 rounded-full transition",
                active ? "bg-accent" : "bg-transparent",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
