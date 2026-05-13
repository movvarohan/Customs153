// HTS parser. Takes raw rows from USITC's exportList JSON dump and produces
// one chunk per tariff line (4-, 6-, 8- or 10-digit code), enriched with the
// section, chapter, indent-stack ancestor context, AND the legal section /
// chapter notes (especially exclusionary clauses). The embedding text is
// ordered so retrieval can disambiguate between competing chapters: full
// hierarchy first → chunk description → exclusionary notes → background.
//
// USITC does NOT emit explicit "Section X" or "Chapter NN" rows in the
// exportList JSON, so chapter context is derived from the first two digits
// of the htsno and section context from a static chapter→section map.
// Legal notes come from the separate getChapterNotes / getSectionNotes
// reststop endpoints — see src/core/lib/hts-notes.ts.

import type { HtsNotesBundle } from "./hts-notes";

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

export interface ParseOptions {
  notes?: HtsNotesBundle;
}

export function parseHtsSchedule(rows: RawHtsRow[], opts: ParseOptions = {}): HtsChunk[] {
  const chunks: HtsChunk[] = [];
  type StackEntry = { indent: number; htsno: string | null; description: string };
  let stack: StackEntry[] = [];

  for (const row of rows) {
    const indent = parseIndent(row.indent);
    const htsRaw = (row.htsno ?? "").trim();
    const desc = cleanDesc(row.description);

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }

    if (htsRaw) {
      stack.push({ indent, htsno: htsRaw, description: desc });

      const level = digitLevelOf(htsRaw);
      if (level !== null) {
        const chapter = htsRaw.slice(0, 2);
        const section = SECTION_FOR_CHAPTER[chapter] ?? null;
        const ancestors = stack.slice(0, -1);
        const chapterNotes = opts.notes?.chapter.get(chapter) ?? null;
        const sectionNotes = opts.notes?.section.get(chapter) ?? null;

        chunks.push({
          htsCode: htsRaw,
          digitLevel: level,
          indentLevel: indent,
          description: desc,
          parentHeading: level === 4 ? null : htsRaw.slice(0, 4),
          section,
          chapter,
          fullPath: buildFullPath({ section, chapter, ancestors, code: htsRaw, desc }),
          sectionNotes,
          chapterNotes,
          generalDuty: trimOrNull(row.general),
          units: row.units ?? [],
          embeddingText: buildEmbeddingText({
            section,
            chapter,
            ancestors,
            code: htsRaw,
            desc,
            chapterNotes,
            sectionNotes,
            includeNotes: true,
          }),
        });
      }
    } else if (desc) {
      stack.push({ indent, htsno: null, description: desc });
    }
  }

  return chunks;
}

/**
 * Build the lean embedding text for a chunk (no notes). Exposed for the
 * with-vs-without-notes diagnostic in scripts/test-retrieval.ts.
 */
export function buildLeanEmbeddingText(chunk: HtsChunk): string {
  // We rebuild from the chunk's own state without re-running the parser.
  // The ancestor stack isn't stored on the chunk, so we use the fullPath as
  // a fallback hierarchy descriptor.
  const lines: string[] = [];
  lines.push(`HTS ${chunk.htsCode}: ${chunk.description}`);
  lines.push("");
  lines.push(chunk.fullPath);
  lines.push("");
  lines.push(`Chapter ${chunk.chapter}${chunk.section ? ` (Section ${chunk.section})` : ""}`);
  return lines.join("\n");
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

interface EmbedArgs extends PathArgs {
  chapterNotes: string | null;
  sectionNotes: string | null;
  includeNotes: boolean;
}

// Per-chunk budgets for embedding text. Voyage tokenizes roughly 4 chars
// per token, so 2400 chars ≈ 600 tokens fits the 400–700-token target.
const CHAR_BUDGET_CHAPTER_NOTES = 900;
const CHAR_BUDGET_SECTION_NOTES = 600;

function buildEmbeddingText(a: EmbedArgs): string {
  const lines: string[] = [];

  // (a) Full hierarchy path — most specific first.
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

  // (c) Chapter notes — exclusionary content first per condense().
  if (a.includeNotes && a.chapterNotes) {
    lines.push("");
    lines.push(`Chapter ${a.chapter} notes:`);
    lines.push(a.chapterNotes.slice(0, CHAR_BUDGET_CHAPTER_NOTES));
  }

  // (d) Section notes — only if short enough not to crowd out chapter notes.
  if (a.includeNotes && a.sectionNotes) {
    lines.push("");
    lines.push(`Section ${a.section ?? ""} notes:`);
    lines.push(a.sectionNotes.slice(0, CHAR_BUDGET_SECTION_NOTES));
  }

  return lines.join("\n");
}

// Static HTS chapter → section map. Section I covers chapters 01–05, etc.
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
