"use client";
import { useState, useTransition } from "react";
import { PAGE_SIZE, type OwnerRating, type RatingDates, type RatingFilter } from "@/lib/ratings";
import { btnQuiet } from "../settings/ui";
import { loadMoreRatings } from "./actions";
import { OwnerRatingCard } from "./rating-card";

type Row = OwnerRating & { added?: boolean };

/** The list, newest first, 30 at a time. Cards from "Show 30 more" fade in (opacity only, no stagger). */
export function RatingsList({ show, dates, initial, seenAt, empty }: { show: RatingFilter; dates: RatingDates; initial: OwnerRating[]; seenAt: string | null; empty: string }) {
  const [seenFirst] = useState(seenAt); // a refresh brings the new visit time; "New" is against the last one
  const [more, setMore] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(initial.length === PAGE_SIZE);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const rows: Row[] = [...initial, ...more];

  function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setError(false);
    start(async () => {
      const res = await loadMoreRatings(show, last.sent_at, dates).catch(() => ({ ok: false }) as const);
      if (!res.ok) {
        setError(true);
        return;
      }
      // The database marked this visit seen when the page loaded, so "New" is worked out against the
      // previous visit here, the same rule list_ratings used for the first 30.
      const seen = seenFirst ? Date.parse(seenFirst) : null;
      const known = new Set(rows.map((r) => r.order_id));
      const fresh = res.rows
        .filter((r) => !known.has(r.order_id))
        .map((r) => ({ ...r, is_new: seen === null || Date.parse(r.sent_at) > seen, added: true }));
      setMore((m) => [...m, ...fresh]);
      setHasMore(res.rows.length === PAGE_SIZE);
    });
  }

  if (rows.length === 0) {
    return <p className="rounded-[var(--r-lg)] bg-paper p-5 text-[15px] text-ink-soft shadow-[var(--shadow-card)]">{empty}</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.order_id} className={r.added ? "fade-in" : undefined}>
            <OwnerRatingCard rating={r} />
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={loadMore} disabled={pending} className={btnQuiet}>
            {pending ? "Loading…" : `Show ${PAGE_SIZE} more`}
          </button>
          {error && (
            <p role="alert" className="note-in text-sm font-semibold text-coral-ink">
              Couldn’t load more. Try again.
            </p>
          )}
        </div>
      )}
    </>
  );
}
