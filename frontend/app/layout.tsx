import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
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
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="border-t border-cardline">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted">
            customs-agent · AI-native customs operations · paired with a licensed customs broker partner under 19 CFR Part 111
          </div>
        </footer>
      </body>
    </html>
  );
}
