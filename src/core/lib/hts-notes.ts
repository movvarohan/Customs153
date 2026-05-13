// Loader and parser for USITC chapter / section notes.
//
// USITC's reststop API exposes the legal notes as raw HTML:
//   https://hts.usitc.gov/reststop/getChapterNotes?doc=<NN>
//   https://hts.usitc.gov/reststop/getSectionNotes?doc=<NN>
// Both take a chapter number; the section endpoint returns the section that
// the chapter belongs to. We download them with scripts/fetch-hts.ts and
// store one file per chapter under data/hts/notes/.
//
// At parse time we want plain text, with the exclusionary "does not cover"
// content surfaced first — that's what disambiguates 7310 (steel containers)
// from 9617 (vacuum vessels) and 4008 (rubber sheets) from 3918 (plastic
// floor coverings) and so on. We cap the result so each chunk's embedding
// text stays in the 400–700-token range.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface HtsNotesBundle {
  /** Plain-text chapter notes per two-digit chapter ("85" → "..."). */
  chapter: Map<string, string>;
  /** Plain-text section notes per two-digit chapter (key is chapter, not section). */
  section: Map<string, string>;
}

export async function loadHtsNotes(notesDir: string): Promise<HtsNotesBundle> {
  const bundle: HtsNotesBundle = { chapter: new Map(), section: new Map() };
  for (let n = 1; n <= 99; n++) {
    const key = String(n).padStart(2, "0");
    const cPath = path.join(notesDir, `chapter-${key}.html`);
    const sPath = path.join(notesDir, `section-for-${key}.html`);
    const ch = await readIfExists(cPath);
    const sc = await readIfExists(sPath);
    if (ch !== null) bundle.chapter.set(key, condense(ch, "chapter"));
    if (sc !== null) bundle.section.set(key, condense(sc, "section"));
  }
  return bundle;
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Strip HTML to plain text and prioritize exclusionary content.
 *
 * We want the "does not cover" clauses up front because those are the
 * disambiguators retrieval needs. After the exclusions we append the
 * definitional notes, capped to keep per-chunk embedding text under budget.
 */
function condense(html: string, scope: "chapter" | "section"): string {
  const text = htmlToText(html);
  const exclusion = extractExclusion(text, scope);
  if (exclusion) {
    const rest = text.replace(exclusion, "").trim();
    const restCapped = rest.slice(0, 600).trim();
    return [exclusion.trim(), restCapped].filter(Boolean).join("\n\n").slice(0, 1500);
  }
  return text.slice(0, 1000).trim();
}

function extractExclusion(text: string, scope: "chapter" | "section"): string | null {
  const phrase = scope === "chapter" ? "does not cover" : "does not cover";
  const re = new RegExp(`\\b(?:this\\s+(?:chapter|section)\\s+)?${phrase}[\\s\\S]*?(?=\\n\\s*\\d+\\.\\s+[A-Z]|\\n\\n[A-Z]|$)`, "i");
  const m = re.exec(text);
  if (!m) return null;
  return m[0].slice(0, 900).trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, "\n  - ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>(?:\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(?:div|ul|ol|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
