import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customs-Agent — AI-native customs operations",
  description:
    "Send us your last 6 months of entries. We'll find duties you overpaid and classifications you should challenge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-navy">
        <header className="border-b border-cardline bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 text-navy">
              <span className="inline-block h-2 w-2 rounded-sm bg-accent" aria-hidden />
              <span className="font-semibold tracking-[0.18em] text-[12px] uppercase">Customs-Agent</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
              <Link href="/process-invoice" className="hover:text-navy">Process invoice</Link>
              <Link href="/find-refunds" className="hover:text-navy">Find refunds</Link>
              <Link href="/" className="hover:text-navy">About</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="border-t border-cardline">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted">
            customs-agent is an AI operations platform for customs work. We pair with a licensed customs broker who exercises responsible
            supervision and control under 19 CFR Part 111. We do not provide legal advice and are not ourselves a licensed customs broker.
          </div>
        </footer>
      </body>
    </html>
  );
}
