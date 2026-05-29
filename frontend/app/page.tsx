import Link from "next/link";

export default function Landing() {
  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="grid items-center gap-12 pt-6 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-4 inline-block rounded-full bg-accent-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-700">
            For SMB importers
          </p>
          <h1 className="mb-5 text-[44px] font-bold leading-[1.05] tracking-tight text-navy">
            Send us your last 6 months of entries.
            <br />
            <span className="text-accent">We&apos;ll find what you overpaid.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            We re-classify every line item from scratch using current CBP practice, calculate the duty under both the filed and corrected
            HTS codes, and surface every Post Summary Correction with quantified savings — with the full legal reasoning attached. Then a
            licensed broker reviews and files for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Link
              href="/find-refunds"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-4 text-base font-semibold text-white shadow-card transition hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-700/30"
            >
              Run a refund analysis
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/process-invoice"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-navy"
            >
              or process a single invoice
              <span aria-hidden className="transition group-hover:translate-x-0.5">›</span>
            </Link>
          </div>
        </div>

        {/* Visual: PDF cover-page-style card */}
        <div className="rounded-card border border-cardline bg-white p-6 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-700 ring-1 ring-inset ring-accent-600/20">
              Recoverable duty found
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
              from a recent entry audit
            </span>
          </div>
          <div className="mb-1 text-2xl font-bold text-navy">$582.90 recoverable</div>
          <div className="mb-4 text-xs text-muted">CN-AMA-7195891-13 · entry date 2025-07-31 · within PSC window · confidence high</div>
          <div className="mb-3 text-sm font-semibold text-navy">Product as filed</div>
          <div className="mb-4 text-sm leading-relaxed text-muted">
            20W USB-C PD fast wall charger, compact dual-port. Quantity 250 @ $12.80 each.
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-md bg-navy-50 p-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Filed classification</div>
              <div className="text-base font-semibold text-navy">8507.60.00</div>
              <div className="text-xs text-muted">duty paid: $4,949.77</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Our proposed</div>
              <div className="text-base font-semibold text-accent">8504.40.70</div>
              <div className="text-xs text-muted">duty under our code: $4,366.87</div>
            </div>
          </div>
          <div className="mt-4 text-sm leading-relaxed text-muted">
            <span className="font-semibold text-navy">Why we believe this is misclassified:</span> A wall charger is a static converter
            (heading 8504, power supplies), not an electric storage battery (heading 8507). Filing under 8507 added Section 301 China
            tariffs that don&apos;t apply at the same rate.
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-2 text-2xl font-bold text-navy">How it works</h2>
        <p className="mb-8 max-w-2xl text-muted">
          Two surfaces, one engine. The same classifier runs over your entries to find recoverable duties, and over your incoming invoices
          to draft new entries — with a licensed broker as the final signoff.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              n: "1",
              t: "AI does the classification work",
              b: "We read seller descriptions verbatim, retrieve the closest tariff lines from a Voyage-embedded copy of the full HTS, and reason through the General Rules of Interpretation explicitly. Every classification cites the lines it relied on.",
            },
            {
              n: "2",
              t: "Deterministic duty math",
              b: "We compute base ad-valorem, Section 301 (China), Section 232 (steel/aluminum), MPF, and HMF for both the filed and proposed code. No LLM in the math itself. Recoverable amount = filed minus ours.",
            },
            {
              n: "3",
              t: "A licensed broker reviews and files",
              b: "The broker partner reviews each finding's full reasoning trace, confirms against the actual product, and files the Post Summary Correction or protest. We don't represent you before CBP — they do, on the record.",
            },
          ].map((step) => (
            <div key={step.n} className="rounded-card border border-cardline bg-white p-6 shadow-card">
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent-50 text-sm font-bold text-accent-700">
                {step.n}
              </div>
              <h3 className="mb-2 text-base font-semibold text-navy">{step.t}</h3>
              <p className="text-sm leading-relaxed text-muted">{step.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section className="rounded-card border border-cardline bg-navy-50 p-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy">Legal posture</h3>
        <p className="text-sm leading-relaxed text-muted">
          We are <strong className="text-navy">not</strong> a licensed customs broker. We are an AI operations platform that pairs with a
          licensed broker partner. All filings go through the broker partner under their license and ABI permit; the broker exercises
          responsible supervision and control as required by 19 CFR Part 111. No classification on this site is final until the licensed
          broker signs off.
        </p>
      </section>
    </div>
  );
}
