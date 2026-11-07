"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * "Closed early today…" at the top of every dashboard screen (spec-2.2 "Other dashboard screens").
 * It enters from 8 px above when it's noticed on the board's poll or after Reopen, never on page
 * load, and leaves the same way.
 */
export function ClosedEarlyStrip({ closedEarly, owner }: { closedEarly: boolean; owner: boolean }) {
  const [shown, setShown] = useState(closedEarly);
  const onSettings = usePathname() === "/dashboard/settings";
  const [phase, setPhase] = useState<"still" | "in" | "out">("still");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (closedEarly) {
      setShown(true);
      setPhase("in");
    } else if (shown) {
      setPhase("out");
    }
    // `shown` is read, not watched: only a change in the server's answer moves the strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedEarly]);

  // Settings says the same in its status strip and closed card, with nothing above the strip (spec-2.2).
  if (!shown || onSettings) return null;
  return (
    <div
      role="status"
      data-phase={phase}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && phase === "out") {
          setShown(false);
          setPhase("still");
        }
      }}
      className="early-strip mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--r-md)] bg-teal-deeper px-4 py-3 text-[15px] leading-snug text-white print:hidden"
    >
      <span className="min-w-0 flex-1">Closed early today. No new orders. Orders on the board still need finishing.</span>
      {owner && (
        <Link href="/dashboard/settings" className="press -my-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 touch-manipulation select-none">
          Settings
        </Link>
      )}
    </div>
  );
}
