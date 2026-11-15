// Slice 2.10: "★ 4.6 (38)" next to a dish. Shown only when the database gives an average
// (from the 3rd visible rating). The screen reader hears one sentence, not the glyphs.
import { ratingMeta } from "@/lib/ratings";

export function RatingMeta({ avg, count, className = "" }: { avg: number | null | undefined; count: number | null | undefined; className?: string }) {
  if (avg === null || avg === undefined || !count) return null;
  const m = ratingMeta(Number(avg), count);
  return (
    <span className={`relative inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink-soft ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[13px] flex-none fill-amber">
        <path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z" />
      </svg>
      <span aria-hidden="true">
        <span className="text-ink">{m.value}</span> ({m.count})
      </span>
      <span className="sr-only">{m.label}</span>
    </span>
  );
}
