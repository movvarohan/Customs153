// HTS parser. Takes raw rows from USITC's exportList JSON dump and produces
// one chunk per tariff line (4-, 6-, 8- or 10-digit code), enriched with the
// section, chapter, and indent-stack ancestor context so the embedding text
// carries enough signal for retrieval.
//
// The USITC dump is a flat ordered array of rows. Each row has:
//   - htsno: the HTS code (formatted "XXXX", "XXXX.XX", "XXXX.XX.XX", or
//     "XXXX.XX.XX.XX") — empty string for "superior" structural rows.
//   - indent: the visual nesting level in the schedule (string, "0" at root).
//   - description: the human-readable line text, often ending in ":".
//   - superior: "true" on intermediate header rows.
//   - general/special/other: duty rate text.
//
// USITC does NOT emit explicit "Section X" or "Chapter NN" rows, so chapter
// context is derived from the first two digits of the htsno and section
// context from a static chapter→section map. Legal section/chapter notes
// are not in this dump and are left null here — see TODO at the bottom.

export interface RawHtsRow {
  htsno?: string;
  indent?: string | number;
  description?: string;
  superior?: string;
  units?: string[];
  general?: string;
  special?: string;
  other?: string;
  footnotes?: unknown[];
}

export interface HtsChunk {
  /** Canonical HTS code as it appears in the source ("8518.30.20.00"). */
  htsCode: string;
  /** Number of digits in the code (4, 6, 8, or 10). */
  digitLevel: 4 | 6 | 8 | 10;
  /** Indent level reported by USITC, kept verbatim. */
  indentLevel: number;
  description: string;
  /** 4-digit heading this code falls under, e.g. "8518". null only for 4-digit rows. */
  parentHeading: string | null;
  /** Section roman numeral, e.g. "XVI". */
  section: string | null;
  /** Two-digit chapter, e.g. "85". */
  chapter: string;
  /** Human-readable path with full hierarchy. */
  fullPath: string;
  sectionNotes: string | null;
  chapterNotes: string | null;
  generalDuty: string | null;
  units: string[];
  /** What we hand to the embedding model. */
  embeddingText: string;
}

export function parseHtsSchedule(rows: RawHtsRow[]): HtsChunk[] {
  const chunks: HtsChunk[] = [];
  // Stack of ancestors at strictly-decreasing indent levels. Each entry may
  // be a tariff line (with htsno) or a "superior" structural row.
  type StackEntry = { indent: number; htsno: string | null; description: string };
  let stack: StackEntry[] = [];
  let currentChapter: string | null = null;

  for (const row of rows) {
    const indent = parseIndent(row.indent);
    const htsRaw = (row.htsno ?? "").trim();
    const desc = cleanDesc(row.description);

    // Pop the stack down to entries strictly less indented than us.
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }

    if (htsRaw) {
      // Tariff line. Push first so it's available as parent for deeper rows,
      // and so the chunk-builder doesn't accidentally include itself as an
      // ancestor.
      stack.push({ indent, htsno: htsRaw, description: desc });

      const level = digitLevelOf(htsRaw);
      if (level !== null) {
        currentChapter = htsRaw.slice(0, 2);
        const section = SECTION_FOR_CHAPTER[currentChapter] ?? null;
        const ancestors = stack.slice(0, -1); // everything before this row

        chunks.push({
          htsCode: htsRaw,
          digitLevel: level,
          indentLevel: indent,
          description: desc,
          parentHeading: level === 4 ? null : htsRaw.slice(0, 4),
          section,
          chapter: currentChapter,
          fullPath: buildFullPath({ section, chapter: currentChapter, ancestors, code: htsRaw, desc }),
          sectionNotes: null,
          chapterNotes: null,
          generalDuty: trimOrNull(row.general),
          units: row.units ?? [],
          embeddingText: buildEmbeddingText({
            section,
            chapter: currentChapter,
            ancestors,
            code: htsRaw,
            desc,
          }),
        });
      }
    } else if (desc) {
      // Superior / structural row — keep it on the stack so child tariff lines
      // pick up its label (e.g. "Other:", "Of cotton:") as ancestor context.
      stack.push({ indent, htsno: null, description: desc });
    }
  }

  return chunks;
}

// ── helpers ────────────────────────────────────────────────────────────────

function cleanDesc(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").replace(/[:\s]+$/, "").trim();
}

function trimOrNull(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length === 0 ? null : t;
}

function parseIndent(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function digitLevelOf(code: string): 4 | 6 | 8 | 10 | null {
  const digits = code.replace(/\./g, "");
  if (digits.length === 4) return 4;
  if (digits.length === 6) return 6;
  if (digits.length === 8) return 8;
  if (digits.length === 10) return 10;
  return null;
}

interface PathArgs {
  section: string | null;
  chapter: string;
  ancestors: Array<{ htsno: string | null; description: string }>;
  code: string;
  desc: string;
}

function buildFullPath(a: PathArgs): string {
  const segments: string[] = [];
  if (a.section) segments.push(`Section ${a.section}`);
  segments.push(`Chapter ${a.chapter}`);
  for (const anc of a.ancestors) {
    if (!anc.description) continue;
    segments.push(anc.htsno ? `${anc.htsno}: ${anc.description}` : anc.description);
  }
  segments.push(`${a.code}: ${a.desc}`);
  return segments.join(" > ");
}

function buildEmbeddingText(a: PathArgs): string {
  const lines: string[] = [];
  lines.push(`HTS ${a.code}: ${a.desc}`);
  const ancestorLines: string[] = [];
  for (const anc of a.ancestors) {
    if (!anc.description) continue;
    ancestorLines.push(anc.htsno ? `  ${anc.htsno} — ${anc.description}` : `  · ${anc.description}`);
  }
  if (ancestorLines.length > 0) {
    lines.push("");
    lines.push("Within:");
    lines.push(...ancestorLines);
  }
  lines.push("");
  lines.push(`Chapter ${a.chapter}${a.section ? ` (Section ${a.section})` : ""}`);
  return lines.join("\n");
}

// Static HTS chapter → section map. Section I covers chapters 01–05, etc.
// Source: USITC HTS table of contents (sections I–XXII).
const SECTION_FOR_CHAPTER: Record<string, string> = (() => {
  const ranges: Array<[string, number, number]> = [
    ["I", 1, 5],
    ["II", 6, 14],
    ["III", 15, 15],
    ["IV", 16, 24],
    ["V", 25, 27],
    ["VI", 28, 38],
    ["VII", 39, 40],
    ["VIII", 41, 43],
    ["IX", 44, 46],
    ["X", 47, 49],
    ["XI", 50, 63],
    ["XII", 64, 67],
    ["XIII", 68, 70],
    ["XIV", 71, 71],
    ["XV", 72, 83],
    ["XVI", 84, 85],
    ["XVII", 86, 89],
    ["XVIII", 90, 92],
    ["XIX", 93, 93],
    ["XX", 94, 96],
    ["XXI", 97, 97],
    ["XXII", 98, 99],
  ];
  const out: Record<string, string> = {};
  for (const [section, lo, hi] of ranges) {
    for (let c = lo; c <= hi; c++) {
      out[String(c).padStart(2, "0")] = section;
    }
  }
  return out;
})();

// TODO(CLAUDE.md §2 "HTS classification agent"):
//   The USITC legal section and chapter notes are NOT in this JSON dump.
//   Pull them from the official Notes PDFs (or scrape via ctx.browser from
//   hts.usitc.gov), index them as their own chunks, and use them as
//   retrieval context when applying GRI 1.
