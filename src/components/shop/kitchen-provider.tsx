"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readKitchen } from "@/app/(shop)/kitchen-actions";
import { closedButton, menuNotice, nextChange, pickupSlots, type KitchenSnapshot, type KitchenStatus } from "@/lib/kitchen";
import { formatKes } from "@/lib/format";

type KitchenContext = {
  status: KitchenStatus;
  open: boolean;
  /** The server's clock, carried forward: never the phone's own time. */
  now: () => Date;
  /** Reads the status again and returns it (the old one if the read failed). */
  refresh: () => Promise<KitchenStatus>;
};

const Ctx = createContext<KitchenContext | null>(null);

// setTimeout can't wait longer than about 24.8 days.
const MAX_WAIT = 2 ** 31 - 1;

/**
 * Holds what the server last said about the kitchen. Reads it again when the tab regains focus
 * and at the next moment the clock alone changes it, so the button comes on at opening time
 * without a reload (spec-2.2 "Opening while someone's on the page").
 */
export function KitchenProvider({ initial, children }: { initial: KitchenSnapshot; children: React.ReactNode }) {
  const [snap, setSnap] = useState(() => ({ status: initial.status, offset: Date.parse(initial.now) - Date.now() }));
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const now = useCallback(() => new Date(Date.now() + snapRef.current.offset), []);

  const refresh = useCallback(async () => {
    const next = await readKitchen().catch(() => null);
    if (!next) return snapRef.current.status;
    const fresh = { status: next.status, offset: Date.parse(next.now) - Date.now() };
    snapRef.current = fresh;
    setSnap(fresh);
    return next.status;
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const at = nextChange(snap.status, now());
    if (at === null) return;
    // A second late, so the server's answer has already changed when we ask.
    const timer = setTimeout(() => void refresh(), Math.min(at - now().getTime() + 1000, MAX_WAIT));
    return () => clearTimeout(timer);
  }, [snap, now, refresh]);

  const value = useMemo(() => ({ status: snap.status, open: snap.status.state === "open", now, refresh }), [snap, now, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKitchen() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKitchen must be used inside KitchenProvider");
  return ctx;
}

/** Pickup times from the server's status and clock. */
export function usePickupSlots() {
  const { status, now } = useKitchen();
  return useMemo(() => pickupSlots(status, now()), [status, now]);
}

/**
 * The menu's closed notice, under the header. Deeper teal while closed; a quiet line in the last
 * 30 minutes before last orders. No motion: it is there on page load (spec-2.2 Motion).
 */
export function KitchenNotice({ className = "" }: { className?: string }) {
  const { status, now } = useKitchen();
  const notice = menuNotice(status, now());
  // The live region stays in the page, so a notice appearing later is announced.
  return (
    <div role="status" className={notice ? className : undefined}>
      {notice?.tone === "quiet" && <p className="text-[15px] font-semibold text-teal-deeper">{notice.text}</p>}
      {notice?.tone === "closed" && (
        <p className="rounded-[var(--r-md)] bg-teal-deeper px-4 py-3.5 text-[15px] leading-snug text-white">{notice.text}</p>
      )}
    </div>
  );
}

/** The main button while closed: off, with the total still showing (spec-2.2 "Checkout and cart"). */
export function ClosedButton({ totalKes, className }: { totalKes: number; className: string }) {
  const { status } = useKitchen();
  return (
    <button type="button" disabled aria-disabled="true" className={className}>
      {closedButton(status)} · {formatKes(totalKes)}
    </button>
  );
}
