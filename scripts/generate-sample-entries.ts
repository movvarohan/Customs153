// Generate three synthetic historical-entry files into data/sample-entries/.
// Deterministic — no LLM calls. Each profile has a pool of product templates
// with realistic descriptions and a TRUE 10-digit HTS. Some entries are
// "filed correctly" (filed = true); the rest are filed with a planted
// MISCLASSIFICATION pattern whose tariff rate is HIGHER than the true rate,
// so re-classification surfaces a refund opportunity.
//
// The _ground_truth_correct_hts field is the only place the generator's
// intent leaks. The PSC finder does not read it; the eval script does.

import { promises as fs } from "node:fs";
import path from "node:path";
import { calculateDuty } from "@/core/agents/duty-calculator";
import { buildLocalContext } from "@/adapters/local";
import type { HistoricalEntriesT, HistoricalEntryT, HistoricalLineItemT } from "@/core/schemas/refund";

const OUT_DIR = path.resolve("data/sample-entries");
/** As-of for entry-date distribution. Matches CLAUDE.md current date. */
const AS_OF = new Date("2026-05-13T00:00:00Z");

interface ProductTemplate {
  pattern_id: string;
  descriptions: string[];
  true_hts: string;         // dotted 10-digit
  misclassified_hts: string | null; // dotted 10-digit; null = no planted error pattern
  unit_value_cents_range: [number, number];
  qty_range: [number, number];
}

interface Profile {
  importer: string;
  country: string;
  port: string;
  entries_target: number;
  misclass_rate: number; // 0..1
  templates: ProductTemplate[];
  out_file: string;
}

// ── Profile 1: Amazon FBA seller importing from China ──────────────────────
const FBA_TEMPLATES: ProductTemplate[] = [
  {
    pattern_id: "smartwatch_misclass",
    descriptions: [
      "Smart fitness watch with heart rate monitor, GPS, color touchscreen, BT 5.0",
      "Smartwatch waterproof IP68 with sleep tracking, Wi-Fi sync",
      "Smartwatch with phone notifications, blood oxygen sensor, 1.4 inch AMOLED",
    ],
    true_hts: "8517.62.00.90",       // 0% base + 25% s301 = 25%
    misclassified_hts: "9102.12.80.00", // 4.6% base + 25% s301 = 29.6%  → ~4.6% recoverable
    unit_value_cents_range: [2200, 4500],
    qty_range: [200, 800],
  },
  {
    pattern_id: "computer_mouse_misclass",
    descriptions: [
      "Wireless USB mouse 2.4GHz with ergonomic design and AAA battery",
      "Bluetooth optical computer mouse, silent click, rechargeable",
      "Vertical ergonomic wireless computer mouse 4-button",
    ],
    true_hts: "8471.60.20.00",
    misclassified_hts: "9017.20.80.40",
    unit_value_cents_range: [500, 1800],
    qty_range: [300, 1200],
  },
  {
    pattern_id: "phone_charger_misclass",
    descriptions: [
      "USB-C 65W GaN power adapter wall charger for laptops",
      "20W USB-C PD fast wall charger compact dual-port",
      "30W USB-C wall charger universal voltage with foldable prongs",
    ],
    true_hts: "8504.40.95.40",       // 0% + 25% = 25%   (static converter — power supply)
    misclassified_hts: "8507.60.00.20", // 3.4% + 25% = 28.4%  → ~3.4% recoverable
    unit_value_cents_range: [400, 1500],
    qty_range: [250, 1500],
  },
  {
    pattern_id: "bamboo_board_misclass",
    descriptions: [
      "Bamboo end-grain cutting board 18x12 inch food-safe finish",
      "Bamboo chopping board large with drip groove and juice channel",
      "Bamboo cheese & charcuterie board with handle 14 inch round",
    ],
    true_hts: "4419.11.00.00",       // 0% + 25% = 25%
    misclassified_hts: "4419.19.10.00", // 3.2% + 25% = 28.2%  → ~3.2% recoverable
    unit_value_cents_range: [800, 2500],
    qty_range: [200, 1000],
  },
  {
    pattern_id: "earthenware_mug_misclass",
    descriptions: [
      "Ceramic earthenware coffee mug 12oz printed logo",
      "Earthenware mug stoneware-style 16oz matte glaze",
      "Glazed earthenware ceramic mug with handle, retail 11oz",
    ],
    true_hts: "6912.00.44.00",       // 9.8% + 25% = 34.8%
    misclassified_hts: "6911.10.45.00", // 23.9% + 25% = 48.9%  → ~14% recoverable (BIG)
    unit_value_cents_range: [250, 1100],
    qty_range: [500, 4000],
  },
  // CORRECTLY-FILED templates (no planted misclass — finder should agree).
  {
    pattern_id: "bluetooth_headphones_correct",
    descriptions: [
      "Wireless Bluetooth over-ear headphones with rechargeable battery",
      "BT 5.3 ANC headphones foldable with carrying case",
      "Bluetooth earbuds true wireless with charging case",
    ],
    true_hts: "8518.30.20.00",
    misclassified_hts: null,
    unit_value_cents_range: [900, 4500],
    qty_range: [200, 1000],
  },
  {
    pattern_id: "usbc_cable_correct",
    descriptions: [
      "USB-C to USB-C charging cable 6 ft braided PD 100W",
      "USB-C cable 1m fast charging data sync",
      "USB-C cable 2m heavy-duty 240W EPR rated",
    ],
    true_hts: "8544.42.90.90",
    misclassified_hts: null,
    unit_value_cents_range: [100, 800],
    qty_range: [500, 5000],
  },
  {
    pattern_id: "led_desk_lamp_correct",
    descriptions: [
      "LED desk lamp dimmable touch control USB-powered",
      "Adjustable arm LED desk lamp warm white aluminum base",
      "LED book reading lamp clip-on rechargeable",
    ],
    true_hts: "9405.21.60.10",
    misclassified_hts: null,
    unit_value_cents_range: [800, 3500],
    qty_range: [150, 600],
  },
];

// ── Profile 2: Vietnam apparel importer ────────────────────────────────────
const APPAREL_TEMPLATES: ProductTemplate[] = [
  {
    pattern_id: "tshirt_as_shirt_misclass",
    descriptions: [
      "Men's short sleeve crew neck cotton t-shirt knitted white size L",
      "Men's cotton crew tee navy knit jersey 180gsm",
      "Men's cotton t-shirt black knit basic crew M",
    ],
    true_hts: "6109.10.00.04",       // 16.5% base, no s301 (VN)
    misclassified_hts: "6105.10.00.10", // 19.7% base  → ~3.2% recoverable
    unit_value_cents_range: [300, 700],
    qty_range: [800, 3000],
  },
  {
    pattern_id: "cotton_blouse_misfiled_mmf",
    descriptions: [
      "Women's cotton woven blouse short sleeve button down",
      "Women's 100% cotton blouse Mandarin collar size M",
      "Women's cotton poplin blouse fitted long sleeve",
    ],
    true_hts: "6206.30.30.10",       // 15.7% base
    misclassified_hts: "6206.40.30.00", // 26.5% base  → ~10.8% recoverable (BIG)
    unit_value_cents_range: [500, 1500],
    qty_range: [400, 2000],
  },
  // CORRECTLY-FILED apparel
  {
    pattern_id: "denim_jeans_correct",
    descriptions: [
      "Men's 5-pocket denim jeans cotton 14oz indigo",
      "Men's slim-fit jeans 100% cotton stretch denim",
      "Men's straight-leg jeans selvedge denim 13.5oz",
    ],
    true_hts: "6203.42.07.10",
    misclassified_hts: null,
    unit_value_cents_range: [800, 2200],
    qty_range: [300, 1500],
  },
  {
    pattern_id: "leather_belt_correct",
    descriptions: [
      "Men's full-grain leather belt 1.5 inch metal pin buckle",
      "Women's reversible leather belt with rotating buckle",
      "Men's tooled leather belt western style 38mm",
    ],
    true_hts: "4203.30.00.00",
    misclassified_hts: null,
    unit_value_cents_range: [600, 2200],
    qty_range: [200, 1000],
  },
  {
    pattern_id: "scarf_correct",
    descriptions: [
      "Woven polyester fashion scarf 30x150cm with fringe",
      "Cotton voile scarf lightweight printed 70x180cm",
      "Viscose blend pashmina-style scarf 70x200cm",
    ],
    true_hts: "6214.30.00.00",
    misclassified_hts: null,
    unit_value_cents_range: [200, 800],
    qty_range: [500, 3000],
  },
];

// ── Profile 3: India houseware importer ────────────────────────────────────
const HOUSEWARE_TEMPLATES: ProductTemplate[] = [
  {
    pattern_id: "earthenware_mug_as_porcelain",
    descriptions: [
      "Hand-painted ceramic earthenware coffee mug 12oz",
      "Glazed ceramic mug stoneware-body cobalt blue 16oz",
      "Earthenware ceramic mug printed traditional motif",
    ],
    true_hts: "6912.00.44.00",       // 9.8% base
    misclassified_hts: "6911.10.45.00", // 23.9% base  → ~14% recoverable (BIG)
    unit_value_cents_range: [180, 320],
    qty_range: [200, 800],
  },
  {
    pattern_id: "dhurrie_as_tufted",
    descriptions: [
      "Cotton dhurrie rug hand-woven flat-weave 3x5 ft",
      "Cotton dhurrie rug striped multi-color 4x6 ft hand-loomed",
      "Cotton dhurrie carpet handwoven rectangular 5x7 ft",
    ],
    true_hts: "5702.10.90.00",       // 0% base (free, hand-woven non-pile)
    misclassified_hts: "5703.30.20.00", // 6% base  → ~6% recoverable
    unit_value_cents_range: [3500, 8500],
    qty_range: [40, 200],
  },
  // CORRECTLY-FILED houseware
  {
    pattern_id: "brass_candle_holder_correct",
    descriptions: [
      "Brass candle holder traditional Diya stand polished finish",
      "Solid brass votive candle holder etched lotus pattern",
      "Brass candle stand hand-tooled 6-arm centerpiece",
    ],
    true_hts: "9405.50.30.00",
    misclassified_hts: null,
    unit_value_cents_range: [800, 4500],
    qty_range: [100, 500],
  },
  {
    pattern_id: "sheesham_board_correct",
    descriptions: [
      "Sheesham wood cutting board 14x10 inch with juice groove",
      "Indian rosewood serving board with brass inlay",
      "Sheesham wood charcuterie board 18 inch rectangular",
    ],
    true_hts: "4419.19.10.00",
    misclassified_hts: null,
    unit_value_cents_range: [2500, 6500],
    qty_range: [50, 300],
  },
  {
    pattern_id: "glass_tealight_correct",
    descriptions: [
      "Clear glass tea-light holder cut and pressed 3 inch",
      "Embossed glass votive candle holder decorative 4 inch",
      "Hand-blown glass tealight cup with ribbed pattern",
    ],
    true_hts: "7013.99.35.00",
    misclassified_hts: null,
    unit_value_cents_range: [200, 800],
    qty_range: [200, 1500],
  },
];

const PROFILES: Profile[] = [
  {
    importer: "Atlas Retail Holdings LLC (Amazon FBA seller)",
    country: "CN",
    port: "Long Beach, CA",
    entries_target: 20,
    misclass_rate: 0.30,
    templates: FBA_TEMPLATES,
    out_file: "amazon-fba.json",
  },
  {
    importer: "Meridian Apparel Imports Inc.",
    country: "VN",
    port: "Los Angeles, CA",
    entries_target: 15,
    misclass_rate: 0.30,
    templates: APPAREL_TEMPLATES,
    out_file: "vietnam-apparel.json",
  },
  {
    importer: "Saraswati Houseware Trading Co.",
    country: "IN",
    port: "New York/Newark",
    entries_target: 10,
    misclass_rate: 0.30,
    templates: HOUSEWARE_TEMPLATES,
    out_file: "india-houseware.json",
  },
];

// ── Deterministic seedable PRNG (mulberry32) so eval runs are reproducible ─
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}
function randomDateWithinLast12Months(rng: () => number): string {
  const daysAgo = Math.floor(rng() * 365);
  const d = new Date(AS_OF.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function entryNumber(rng: () => number, importerPrefix: string, idx: number): string {
  const seq = String(1_000_000 + Math.floor(rng() * 9_000_000));
  return `${importerPrefix}-${seq}-${String(idx).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  // Minimal AppContext just for the duty calculator (Anthropic/Voyage dummy).
  const ctx = await buildLocalContext({
    dataDir: process.env.DATA_DIR ?? ".data",
    anthropicApiKey: "dummy",
    voyageApiKey: "dummy",
    config: {
      environment: "development",
      defaultModel: "claude-sonnet-4-5",
      cheapModel: "claude-haiku-4-5-20251001",
      hardModel: "claude-opus-4-7",
    },
  });

  for (const profile of PROFILES) {
    const rng = makeRng(hashString(profile.out_file));
    const importerPrefix = profile.country + "-" + profile.out_file.slice(0, 3).toUpperCase();
    const entries: HistoricalEntryT[] = [];

    let totalLines = 0;
    let totalPlanted = 0;

    for (let i = 0; i < profile.entries_target; i++) {
      const entryDate = randomDateWithinLast12Months(rng);
      // Most entries are single-line; a few have 2 lines.
      const lineCount = rng() < 0.2 ? 2 : 1;
      const lines: HistoricalLineItemT[] = [];
      for (let j = 0; j < lineCount; j++) {
        const tpl = pick(rng, profile.templates);
        const desc = pick(rng, tpl.descriptions);
        const unitValueCents = randInt(rng, tpl.unit_value_cents_range[0], tpl.unit_value_cents_range[1]);
        const qty = randInt(rng, tpl.qty_range[0], tpl.qty_range[1]);
        const totalValueCents = unitValueCents * qty;

        const usePlanted =
          tpl.misclassified_hts !== null && rng() < profile.misclass_rate;
        const filedHts = usePlanted ? tpl.misclassified_hts! : tpl.true_hts;
        if (usePlanted) totalPlanted++;

        // Compute duty_paid using the FILED HTS — so a planted misclass yields
        // genuine overpayment (since misclassified_hts has higher tariff rate).
        const dutyCalc = await calculateDuty(ctx, {
          hts_code: filedHts,
          country_of_origin: profile.country,
          customs_value_usd_cents: totalValueCents,
          transport_mode: "ocean",
        });

        lines.push({
          description: desc,
          quantity: qty,
          unit_value_usd_cents: unitValueCents,
          total_value_usd_cents: totalValueCents,
          hts_code_as_filed: filedHts,
          duty_paid_usd_cents: dutyCalc.total_duty_usd_cents,
          _ground_truth_correct_hts: tpl.true_hts,
        });
      }
      totalLines += lines.length;

      entries.push({
        entry_number: entryNumber(rng, importerPrefix, i + 1),
        entry_date: entryDate,
        port_of_entry: profile.port,
        country_of_origin: profile.country,
        line_items: lines,
      });
    }

    const out: HistoricalEntriesT = {
      importer: profile.importer,
      generated_at: new Date().toISOString(),
      entries,
    };
    const outPath = path.join(OUT_DIR, profile.out_file);
    await fs.writeFile(outPath, JSON.stringify(out, null, 2));
    console.log(
      `wrote ${outPath} — ${entries.length} entries, ${totalLines} line items, ${totalPlanted} planted misclassifications`,
    );
  }

  await ctx.db.close();
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
