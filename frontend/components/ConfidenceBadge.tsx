import { classNames } from "@/lib/api";

export function ConfidenceBadge({ value }: { value: "high" | "medium" | "low" }) {
  const palette: Record<string, string> = {
    high: "bg-accent-50 text-accent-700 ring-accent-700/20",
    medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
    low: "bg-navy-50 text-muted ring-navy-200/40",
  };
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ring-inset",
        palette[value],
      )}
    >
      {value}
    </span>
  );
}
