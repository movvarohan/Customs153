import { Fragment, type ReactNode } from "react";

// Lightweight, dependency-free renderer for the short markdown-ish prose the
// LLM agents produce. Handles **bold**, `code`, bullet lists (- / • / *),
// numbered lists, and paragraph breaks — and strips stray asterisks so text
// never shows raw markdown. Not a full markdown engine on purpose.

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

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  const blocks = text.trim().split(/\n{2,}/);

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
        // Plain paragraph (join wrapped lines with spaces).
        return <p key={bi}>{renderInline(lines.join(" "), `${bi}`)}</p>;
      })}
    </div>
  );
}
