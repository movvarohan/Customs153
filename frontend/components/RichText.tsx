import { Fragment, type ReactNode } from "react";

// Lightweight, dependency-free renderer for the short markdown-ish prose the
// LLM agents produce. Handles **bold**, `code`, bullet lists (- / • / *),
// numbered lists, paragraph breaks, and the two LLM artifacts that show up in
// classifier reasoning:
//   • run-on "Step N: ..." sequences with no paragraph breaks
//   • inline " - <item> - <item>" bullets at GRI-6 descent
// Strips stray asterisks so text never shows raw markdown. Not a full
// markdown engine on purpose.

// Pre-normalise: insert blank-line breaks before each "Step N <sep>" so the
// paragraph splitter below promotes them to their own block, and lift inline
// hyphen-bullet runs (" - X - Y") to real newline-prefixed bullets.
function normalise(text: string): string {
  let t = text.trim();
  // "Step N: ", "Step N — ", "Step N. ", "Step N - " (with hyphen + space)
  t = t.replace(/(?<=\S)\s+(?=Step\s+\d+\s*(?::|—|\.\s+|-\s))/g, "\n\n");
  // Inline " - <text>" bullets. Only treat as a bullet when the item starts
  // with something that looks like a bullet item — a code/number/letter
  // followed by ": " (e.g. " - 8518.30.10.00: Line telephone handsets"),
  // not a sentence dash.
  t = t.replace(/\s+-\s+(?=[\w.()/-]+:\s)/g, "\n- ");
  return t;
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on **bold** and `code`, keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold text-navy">{part.slice(2, -2)}</strong>);
    } else if (/^`[^`]+`$/.test(part)) {
      out.push(<code key={`${keyBase}-c${i}`} className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[0.92em] text-navy">{part.slice(1, -1)}</code>);
    } else if (part) {
      // Drop any stray markdown asterisks/underscores that slipped through.
      out.push(<Fragment key={`${keyBase}-t${i}`}>{part.replace(/\*+/g, "").replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")}</Fragment>);
    }
  });
  return out;
}

// Renders "Step N <sep> <title>. <body>" as a small navy-caps header and
// indented body. Falls through to a normal paragraph if no Step marker.
function renderBlock(block: string, bi: number, indent: boolean): ReactNode {
  const head = block.match(/^(Step\s+\d+)\s*(?::|—|\.|-)\s*([^.\n]*\.)\s*([\s\S]*)$/);
  const label = head?.[1];
  const title = head?.[2]?.trim().replace(/\.$/, "");
  const body = (head?.[3] ?? block).trim();
  if (label) {
    return (
      <div key={bi}>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-navy">
          {label}
          {title && <span className="ml-1.5 normal-case text-muted">— {title}</span>}
        </div>
        {body && <p className="mt-1">{renderInline(body, `${bi}-body`)}</p>}
      </div>
    );
  }
  return <p key={bi} className={indent ? "" : ""}>{renderInline(block, `${bi}`)}</p>;
}

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  const blocks = normalise(text).split(/\n{2,}/);

  return (
    <div className={["space-y-2 leading-relaxed", className].join(" ")}>
      {blocks.map((block, bi) => {
        const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const isBullet = lines.length > 0 && lines.every((l) => /^[-•*]\s+/.test(l));
        const isNumbered = lines.length > 0 && lines.every((l) => /^\d+[.)]\s+/.test(l));

        if (isBullet) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^[-•*]\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (isNumbered) {
          return (
            <ol key={bi} className="list-decimal space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\d+[.)]\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </ol>
          );
        }
        return renderBlock(lines.join(" "), bi, false);
      })}
    </div>
  );
}
