"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { opensWhen, type KitchenStatus } from "@/lib/kitchen";
import { timeLabel } from "@/lib/format";
import { closeEarly, reopenToday } from "./actions";
import { btnDanger, btnQuiet, tileHeading } from "./ui";

/** Which card shows, from the status (spec-2.2 "Close early card"). Null: closing time has passed, or a closed day or date. */
function cardFor(s: KitchenStatus): "closed" | "early" | "today" | null {
  if (s.reason === "closed_early") return "closed";
  if (s.state === "open" || s.reason === "past_last_orders") return "early";
  if (s.reason === "before_opening") return "today";
  return null;
}

const pickupsLine = (n: number) => (n === 1 ? "1 pickup is still due later today." : `${n} pickups are still due later today.`);

export function CloseEarlyCard({ status, pickupsDue }: { status: KitchenStatus; pickupsDue: number }) {
  const card = cardFor(status);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, start] = useTransition();
  const [stale, setStale] = useState(false);
  const reportRefusal = useReportRefusal();
  const headingId = useId();
  // Where focus goes after the next render: Keep open on the confirm step, Reopen after closing,
  // Close early after Keep open or reopening.
  const focusNext = useRef<"keep" | "reopen" | "close" | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = { keep: keepRef, reopen: reopenRef, close: closeRef }[focusNext.current ?? "keep"];
    if (focusNext.current && target.current) {
      target.current.focus();
      focusNext.current = null;
    }
  });

  // Refused because the page was stale (Close early switched off): read the line, then refresh, and
  // the line moves to the note under the heading (spec-2.3).
  useEffect(() => {
    if (!stale || !error) return;
    const line = error;
    const t = setTimeout(() => reportRefusal(line), 3000);
    return () => clearTimeout(t);
  }, [stale, error, reportRefusal]);

  if (!card) return null;
  const after = opensWhen(status, "after_today");
  const opensLine = after ? `Opens ${after}.` : "No opening day is set.";

  function close() {
    setError(null);
    start(async () => {
      const res = await closeEarly().catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Couldn’t close. Customers can still order. Try again.");
        setStale(Boolean(res && !res.ok && res.stale));
        return;
      }
      setConfirming(false);
      focusNext.current = "reopen";
      setAnnounce("Closed for the rest of today.");
    });
  }

  function reopen() {
    setError(null);
    start(async () => {
      const res = await reopenToday().catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Couldn’t reopen. Customers still see closed. Try again.");
        setStale(Boolean(res && !res.ok && res.stale));
        return;
      }
      focusNext.current = "close";
      setAnnounce("Reopened. Customers can order again.");
    });
  }

  const live = (
    <p className="sr-only" aria-live="polite">
      {announce}
    </p>
  );
  const errorNote = error && (
    <p key={error} role="alert" className="note-in mt-3 text-sm font-semibold text-coral-ink">
      {error}
    </p>
  );

  if (card === "closed") {
    // Closed early turns the whole card deeper teal, so the state reads at a glance.
    const customers = status.next_opens_at ? `Closed now. Opens ${opensWhen(status)}.` : "Closed for now. Please check back soon.";
    return (
      <section aria-labelledby={headingId} className="rounded-[var(--r-lg)] bg-teal-deeper p-5 text-paper">
        <div key="closed" className="note-in">
          <h2 id={headingId} className={tileHeading}>
            Closed early today
          </h2>
          <p className="mt-1.5 text-[15px] leading-snug text-on-teal-soft">
            Since {status.closed_early_at ? timeLabel(status.closed_early_at) : "earlier today"}. Customers see “{customers}”
          </p>
          <button ref={reopenRef} type="button" onClick={reopen} disabled={pending} className={`${btnQuiet} mt-4 w-full min-[480px]:w-auto`}>
            {pending ? "Reopening…" : "Reopen now"}
          </button>
          {error && (
            <p key={error} role="alert" className="note-in mt-3 rounded-[var(--r-sm)] bg-paper px-3 py-2 text-sm font-semibold text-coral-ink">
              {error}
            </p>
          )}
        </div>
        {live}
      </section>
    );
  }

  return (
    <section aria-labelledby={confirming ? undefined : headingId} className="rounded-[var(--r-lg)] bg-blush p-5 text-ink">
      {confirming ? (
        <div key="confirm" role="group" aria-labelledby={`${headingId}-confirm`} className="note-in">
          <h2 id={`${headingId}-confirm`} className={tileHeading}>
            Close for the rest of today?
          </h2>
          <p className="mt-1.5 text-[15px] leading-snug">
            New orders stop now. Orders already on the board stay. You can reopen any time today.
            {pickupsDue > 0 && <span className="mt-1.5 block font-semibold text-coral-ink">{pickupsLine(pickupsDue)}</span>}
          </p>
          {/* Side by side, equal width, Keep open (the safe choice) on the left. */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              ref={keepRef}
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setError(null);
                focusNext.current = "close";
              }}
              className={btnQuiet}
            >
              Keep open
            </button>
            <button type="button" onClick={close} disabled={pending} className={btnDanger}>
              {pending ? "Closing…" : "Close now"}
            </button>
          </div>
          {errorNote}
        </div>
      ) : (
        <div key="idle" className={announce ? "note-in" : undefined}>
          <h2 id={headingId} className={tileHeading}>
            {card === "today" ? "Close today" : "Close early today"}
          </h2>
          <p className="mt-1.5 text-[15px] leading-snug">For a sell-out or an emergency. {opensLine}</p>
          <button
            ref={closeRef}
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
              focusNext.current = "keep";
            }}
            className={`${btnDanger} mt-4 w-full min-[480px]:w-auto`}
          >
            {card === "today" ? "Close today…" : "Close early…"}
          </button>
        </div>
      )}
      {live}
    </section>
  );
}
