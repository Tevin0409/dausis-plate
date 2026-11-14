"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { callWaiterFromMenu, menuWaiterStatus } from "@/app/(shop)/table-actions";
import { BellIcon, CheckIcon } from "@/components/icons";
import { timeLabel } from "@/lib/format";
import { MENU_ANSWERED_FOR_MS, REQUEST_POLL_MS, type WaiterStatus } from "@/lib/table-requests";

/**
 * Call waiter from the menu at a table (spec-2.9 Q1 B). The table comes from the QR cookie on the
 * server; this shows the table's latest waiter call: Sent while open, "Answered 12:54." for ten
 * minutes after staff mark it done. It polls every 10 s only while a call is open.
 * "Sent 12:52. Staff have been told." only on the phone that asked (remembered for this tab by the
 * call's time); any other open call reads "Someone at your table asked at 12:52." (another phone,
 * or the order page).
 */
const MINE_KEY = "dp_waiter_asked_at";
const readMine = () => {
  try {
    return sessionStorage.getItem(MINE_KEY);
  } catch {
    return null;
  }
};
/** `onBand`: inside 2.8's teal menu band, so the line and the focus ring use the band's colours. */
export function MenuCallWaiter({ initial, onBand = false }: { initial: WaiterStatus; onBand?: boolean }) {
  const [status, setStatus] = useState<WaiterStatus>(initial);
  const [error, setError] = useState<string | null>(null);
  const [spoken, setSpoken] = useState("");
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [mine, setMine] = useState<string | null>(null);
  useEffect(() => setMine(readMine()), []);
  const open = !!status && !status.answered_at;
  const latest = useRef(0);

  const check = useCallback(async () => {
    const asked = ++latest.current;
    const s = await menuWaiterStatus().catch(() => undefined);
    // Keep the last known state when a read fails; drop a reply that a newer one overtook.
    if (s === undefined || asked !== latest.current) return;
    setStatus((was) => {
      if (was && !was.answered_at && s?.answered_at) setSpoken("Answered.");
      return s;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(check, REQUEST_POLL_MS);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [open, check]);

  // "Answered 12:54." goes away by itself after ten minutes.
  const answeredAt = status?.answered_at ? Date.parse(status.answered_at) : null;
  useEffect(() => {
    if (answeredAt === null) return;
    const left = answeredAt + MENU_ANSWERED_FOR_MS - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(id);
  }, [answeredAt]);
  const answeredRecently = answeredAt !== null && now - answeredAt < MENU_ANSWERED_FOR_MS;

  const tap = () => {
    if (open || pending) return;
    setError(null);
    start(async () => {
      try {
        const r = await callWaiterFromMenu();
        if (!r.ok) {
          setError(r.line);
          return;
        }
        latest.current++;
        setStatus({ asked_at: r.askedAt, answered_at: null });
        if (r.created) {
          try {
            sessionStorage.setItem(MINE_KEY, r.askedAt);
          } catch {}
          setMine(r.askedAt);
        }
        setSpoken("Waiter called.");
      } catch {
        setError("Couldn’t send. Try again, or wave to a waiter.");
      }
    });
  };

  const byMe = open && mine !== null && Date.parse(mine) === Date.parse(status.asked_at);
  const line = open
    ? byMe
      ? `Sent ${timeLabel(status.asked_at)}. Staff have been told.`
      : `Someone at your table asked at ${timeLabel(status.asked_at)}.`
    : answeredRecently && status?.answered_at ? `Answered ${timeLabel(status.answered_at)}.` : null;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${onBand ? "items-start" : "items-end max-[599px]:items-start"}`}>
      <button
        type="button"
        onClick={tap}
        aria-pressed={open}
        aria-busy={pending || undefined}
        aria-describedby={line || error ? "menu-waiter-line" : undefined}
        className={`press inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 ${onBand ? "focus-visible:outline-white" : "focus-visible:outline-teal-deep"} ${
          open ? "bg-teal-tint text-teal-deeper ring-1 ring-teal-deep/30 ring-inset" : "border border-sand-deep bg-white text-ink"
        } ${pending ? "cursor-wait" : ""}`}
      >
        {open ? <CheckIcon size={16} className="shrink-0 text-teal-deep" /> : <BellIcon size={18} className="shrink-0 text-teal-deep" />}
        {open ? "Waiter called" : "Call waiter"}
      </button>
      {(line || error) && (
        <p id="menu-waiter-line" role={error ? "alert" : undefined} className={`note-in text-[13px] font-semibold ${error ? (onBand ? "text-blush" : "text-coral-ink") : onBand ? "text-on-teal-soft" : "text-ink-soft"}`}>
          {error ?? line}
        </p>
      )}
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}
