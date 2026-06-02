"use client";

import { useCallback, useState } from "react";
import { API_BASE_URL, classNames } from "@/lib/api";
import { RiskPanel, type RiskProfile } from "@/components/RiskPanel";

interface SupplierInput {
  name: string;
  city: string;
  province: string;
  country: string;
}

const EMPTY_SUPPLIER: SupplierInput = { name: "", city: "", province: "", country: "CN" };

const SAMPLES: Array<{ label: string; importer: string; importer_ein: string; suppliers: SupplierInput[]; country_of_origin: string; hts_codes: string[] }> = [
  {
    label: "Atlas Retail (clean importer · 2 XUAR suppliers)",
    importer: "Atlas Retail Holdings LLC",
    importer_ein: "47-2890154",
    country_of_origin: "CN",
    hts_codes: ["8504.40.95.40", "8544.42.90.90", "9617.00.10.00"],
    suppliers: [
      { name: "Shenzhen Brightway Electronics Co. Ltd.", city: "Shenzhen", province: "Guangdong", country: "CN" },
      { name: "Urumqi Northwest Trading Co. Ltd.",       city: "Urumqi",   province: "Xinjiang",  country: "CN" },
      { name: "Aksu Industrial Cotton Holdings (Branch)",city: "Aksu",     province: "Xinjiang",  country: "CN" },
    ],
  },
  {
    label: "Direct sanctions hit (Huawei Technologies)",
    importer: "Acme Imports LLC",
    importer_ein: "12-3456789",
    country_of_origin: "CN",
    hts_codes: ["8517.62.00.90"],
    suppliers: [
      { name: "Huawei Technologies Co. Ltd.", city: "Shenzhen", province: "Guangdong", country: "CN" },
    ],
  },
  {
    label: "Aluminum extrusions importer (AD/CVD scope)",
    importer: "PNW Building Supply Co.",
    importer_ein: "82-7392841",
    country_of_origin: "CN",
    hts_codes: ["7610.10.00.10"],
    suppliers: [
      { name: "Foshan Aluminum Mfg. Co. Ltd.", city: "Foshan", province: "Guangdong", country: "CN" },
    ],
  },
];

export default function RiskScreenPage() {
  const [importer, setImporter] = useState("");
  const [importerEin, setImporterEin] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("CN");
  const [htsRaw, setHtsRaw] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierInput[]>([{ ...EMPTY_SUPPLIER }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<RiskProfile | null>(null);

  const loadSample = useCallback((s: typeof SAMPLES[number]) => {
    setImporter(s.importer);
    setImporterEin(s.importer_ein);
    setCountryOfOrigin(s.country_of_origin);
    setHtsRaw(s.hts_codes.join(", "));
    setSuppliers(s.suppliers.length > 0 ? s.suppliers : [{ ...EMPTY_SUPPLIER }]);
    setProfile(null);
    setErr(null);
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setProfile(null);
    try {
      const hts_codes = htsRaw
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        importer: importer.trim(),
        importer_ein: importerEin.trim() || null,
        country_of_origin: countryOfOrigin.trim() || "CN",
        hts_codes,
        suppliers: suppliers
          .filter((s) => s.name.trim().length > 0)
          .map((s) => ({
            name: s.name.trim(),
            city: s.city.trim() || undefined,
            province: s.province.trim() || undefined,
            country: s.country.trim() || undefined,
          })),
      };
      const r = await fetch(`${API_BASE_URL}/api/risk/screen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ? String(j.error) : `backend ${r.status}`);
        return;
      }
      setProfile(j as RiskProfile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [importer, importerEin, countryOfOrigin, htsRaw, suppliers]);

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-card border border-cardline bg-navy text-white shadow-card">
        <div className="p-6">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-50">
            Compliance · OFAC · BIS · UFLPA · AD/CVD
          </div>
          <h1 className="text-3xl font-bold">Risk &amp; compliance screen</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            Screen any importer and its suppliers against three federal lists — OFAC SDN, BIS Entity List, UFLPA Entity
            List — plus XUAR region scrutiny, active antidumping / countervailing-duty cases on filed HTS codes, and an
            entity-graph anomaly scan. Deterministic; every finding carries a citation back to the underlying public
            source. Add HTS codes to also screen for AD/CVD scope.
          </p>
        </div>
      </header>

      <section className="rounded-card border border-cardline bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-navy">Parties to screen</h2>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => loadSample(s)}
                className="rounded border border-cardline bg-navy-50/40 px-2 py-1 text-[11px] font-medium text-navy transition hover:bg-navy-50"
              >
                Load: {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Importer name" hint="As filed with CBP">
            <input
              value={importer}
              onChange={(e) => setImporter(e.target.value)}
              placeholder="Atlas Retail Holdings LLC"
              className="w-full rounded-md border border-cardline bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Importer EIN" hint="Optional, helps disambiguate">
            <input
              value={importerEin}
              onChange={(e) => setImporterEin(e.target.value)}
              placeholder="47-2890154"
              className="w-full rounded-md border border-cardline bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Country of origin" hint="ISO-2; for AD/CVD scope">
            <input
              value={countryOfOrigin}
              onChange={(e) => setCountryOfOrigin(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="CN"
              className="w-full rounded-md border border-cardline bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="HTS codes on the filing" hint="Comma-separated; optional. Triggers AD/CVD scope check.">
            <input
              value={htsRaw}
              onChange={(e) => setHtsRaw(e.target.value)}
              placeholder="8504.40.95.40, 8544.42.90.90, 9617.00.10.00"
              className="w-full rounded-md border border-cardline bg-white px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Suppliers</div>
            <button
              type="button"
              onClick={() => setSuppliers((cur) => [...cur, { ...EMPTY_SUPPLIER }])}
              className="rounded border border-accent/40 bg-accent-50 px-2 py-1 text-[11px] font-semibold text-accent-700 transition hover:bg-accent-100"
            >
              + Add supplier
            </button>
          </div>
          <div className="space-y-2">
            {suppliers.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_180px_180px_80px_28px]">
                <input
                  value={s.name}
                  onChange={(e) => setSuppliers((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Supplier name"
                  className="rounded-md border border-cardline bg-white px-2 py-1.5 text-[13px] focus:border-accent focus:outline-none"
                />
                <input
                  value={s.city}
                  onChange={(e) => setSuppliers((cur) => cur.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))}
                  placeholder="City"
                  className="rounded-md border border-cardline bg-white px-2 py-1.5 text-[13px] focus:border-accent focus:outline-none"
                />
                <input
                  value={s.province}
                  onChange={(e) => setSuppliers((cur) => cur.map((x, j) => (j === i ? { ...x, province: e.target.value } : x)))}
                  placeholder="Province/state"
                  className="rounded-md border border-cardline bg-white px-2 py-1.5 text-[13px] focus:border-accent focus:outline-none"
                />
                <input
                  value={s.country}
                  onChange={(e) => setSuppliers((cur) => cur.map((x, j) => (j === i ? { ...x, country: e.target.value.toUpperCase().slice(0, 2) } : x)))}
                  placeholder="CN"
                  className="rounded-md border border-cardline bg-white px-2 py-1.5 text-[13px] focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSuppliers((cur) => (cur.length === 1 ? [{ ...EMPTY_SUPPLIER }] : cur.filter((_, j) => j !== i)))}
                  className="rounded border border-cardline bg-white text-muted transition hover:bg-warn/10 hover:text-warn"
                  aria-label="Remove supplier"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={run}
            disabled={busy || importer.trim().length === 0}
            className={classNames(
              "rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700",
              (busy || importer.trim().length === 0) && "cursor-not-allowed opacity-50",
            )}
          >
            {busy ? "Screening…" : "Run risk screen"}
          </button>
          {err && <span className="text-[12px] text-warn">{err}</span>}
        </div>
      </section>

      {profile && <RiskPanel risk={profile} />}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-muted">{hint}</div>}
    </label>
  );
}
