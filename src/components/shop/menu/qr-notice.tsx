"use client";
import { useEffect, useState } from "react";
import { CloseIcon, InfoIcon } from "@/components/icons";

/**
 * spec-2.8b §3: a table QR that didn't work. There at first paint (no entrance), it fades out on
 * Dismiss and the space closes at once. `qr` leaves the URL so a reload doesn't bring it back.
 */
export function QrNotice() {
  const [state, setState] = useState<"shown" | "leaving" | "gone">("shown");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("qr")) return;
    url.searchParams.delete("qr");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    if (state !== "leaving") return;
    // transitionend is the signal; the timer covers reduced motion and a tab in the background.
    const t = setTimeout(() => setState("gone"), 260);
    return () => clearTimeout(t);
  }, [state]);

  function dismiss() {
    // The button is about to go: hand focus to the menu's first heading so it isn't lost.
    const next = document.querySelector<HTMLElement>("main section h2");
    if (next) {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
    setState("leaving");
  }

  if (state === "gone") return null;
  return (
    <div
      role="status"
      onTransitionEnd={(e) => e.target === e.currentTarget && state === "leaving" && setState("gone")}
      className={`mx-4 mt-5 flex items-start gap-3 rounded-[var(--r-lg)] bg-paper py-2 pl-4 pr-1 text-[15px] leading-snug text-ink-soft ring-1 ring-sand-deep lg:mx-0 lg:mt-7 ${
        state === "leaving" ? "notice-out" : ""
      }`}
    >
      <InfoIcon size={20} className="mt-[11px] flex-none text-teal-deep" />
      <p className="min-w-0 flex-1 py-2.5">
        <strong className="font-semibold text-ink">This table’s code didn’t work.</strong> Ask a waiter for help, or order here for pickup
        or delivery.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="press flex size-11 flex-none select-none items-center justify-center rounded-full text-ink-soft touch-manipulation hover:text-ink"
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
