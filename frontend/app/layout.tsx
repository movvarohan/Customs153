import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customs Agent Suite — AI-native customs operations",
  description:
    "Send us your last 6 months of entries. We'll find duties you overpaid and classifications you should challenge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-navy">
        <header className="sticky top-0 z-40 border-b border-cardline bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5 text-navy">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-white shadow-sm" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5 2 4v4c0 3.4 2.5 5.6 6 6.5 3.5-.9 6-3.1 6-6.5V4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M5.5 8.2 7.2 10 10.5 6.3" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold tracking-tight">Customs Agent Suite</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted">AI-native customs operations</span>
              </span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="border-t border-cardline">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted">
            Customs Agent Suite · AI-native customs operations · paired with a licensed customs broker partner under 19 CFR Part 111
          </div>
        </footer>
      </body>
    </html>
  );
}
