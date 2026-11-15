"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { FILTERS, type RatingFilter } from "@/lib/ratings";

const SEG =
  "press flex min-h-11 flex-none items-center rounded-full px-4 text-[15px] font-semibold whitespace-nowrap touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";

/** The four-part filter. It switches at once (no motion) and lives in the URL; at 375 it scrolls sideways,
 *  with the chosen part brought into view. */
export function FilterBar({ show }: { show: RatingFilter }) {
  const on = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    on.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [show]);
  return (
    <nav aria-label="Show ratings" className="-mx-4 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-full bg-sand p-1">
        {FILTERS.map((f) => {
          const current = f.key === show;
          return (
            <Link
              key={f.key}
              ref={current ? on : undefined}
              href={f.key === "all" ? "/dashboard/ratings" : `/dashboard/ratings?show=${f.key}`}
              aria-current={current ? "page" : undefined}
              scroll={false}
              className={`${SEG} ${current ? "bg-paper text-ink shadow-[var(--shadow-card)]" : "text-ink-soft hover:text-ink"}`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
