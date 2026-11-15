"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// The planner panel's frame (spec-2.5 "The planner panel", DESIGN.md "Sheet" and "The sheet gesture").
// Below 600 px it's a sheet from below with a grabber; from 600 a 420 px side panel from the right.
// role="dialog", labelled by its heading; Escape and the scrim close it; Tab stays inside; focus goes
// back to what opened it. It stays mounted while it leaves, so the exit can run.

const DISMISS_PX = 120;
const FLICK_PX = 20;
const FLICK_SPEED = 0.11; // px per ms, over the last 100 ms
const EXIT_FALLBACK_MS = 320;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PlannerSheet({
  open,
  onClose,
  labelledBy,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  /** The pinned action row; leave it out for a panel whose parts save on their own. */
  footer?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // Open → mount and arrive. Closed → leave, then unmount once the exit has run.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setMounted(true);
      setPhase("in");
      return;
    }
    if (!mounted) return;
    setPhase("out");
    const el = panel.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMounted(false);
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el) finish();
    };
    el?.addEventListener("transitionend", onEnd);
    const t = setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      el?.removeEventListener("transitionend", onEnd);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on open changes only
  }, [open]);

  // While it's up: the page behind doesn't scroll, and focus starts on the heading.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const heading = document.getElementById(labelledBy);
    heading?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = before;
    };
  }, [mounted, labelledBy]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // ── The grabber: 1:1 with the finger, rubber-banding upwards, dismiss past 120 px or on a flick.
  const drag = useRef<{ id: number; y0: number; dy: number; trail: { t: number; y: number }[] } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!panel.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0, trail: [{ t: e.timeStamp, y: e.clientY }] };
    panel.current.style.transition = "none";
    if (scrim.current) scrim.current.style.transition = "none";
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !panel.current) return;
    const raw = e.clientY - d.y0;
    d.dy = raw >= 0 ? raw : -Math.pow(-raw, 0.7);
    d.trail.push({ t: e.timeStamp, y: e.clientY });
    while (d.trail.length > 2 && e.timeStamp - d.trail[0]!.t > 100) d.trail.shift();
    panel.current.style.transform = `translateY(${d.dy}px)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - Math.max(0, d.dy) / panel.current.offsetHeight));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !panel.current) return;
    drag.current = null;
    const first = d.trail[0]!;
    const speed = (e.clientY - first.y) / Math.max(1, e.timeStamp - first.t);
    const p = panel.current;
    const s = scrim.current;
    if (d.dy > DISMISS_PX || (d.dy > FLICK_PX && speed > FLICK_SPEED)) {
      // The exit starts from where the finger left it and leaves the way it came.
      p.style.transition = "transform var(--dur-exit) var(--ease-out)";
      p.style.transform = "translateY(100%)";
      if (s) {
        s.style.transition = "opacity var(--dur-exit) var(--ease-out)";
        s.style.opacity = "0";
      }
      onClose();
      return;
    }
    // Snap back with sheet + drawer (the class's own transition).
    p.style.transition = "";
    p.style.transform = "";
    if (s) {
      s.style.transition = "";
      s.style.opacity = "";
    }
  };

  if (!mounted) return null;
  return (
    <div ref={host} className="planner-host fixed inset-0 z-50 h-dvh print:hidden" data-phase={phase} onKeyDown={onKeyDown}>
      <div ref={scrim} className="planner-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="planner-panel absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-24px)] flex-col rounded-t-[28px] bg-cream shadow-[0_-10px_30px_rgba(0,0,0,.18)] min-[600px]:inset-y-0 min-[600px]:left-auto min-[600px]:right-0 min-[600px]:max-h-none min-[600px]:w-[420px] min-[600px]:max-w-full min-[600px]:rounded-none min-[600px]:shadow-[-10px_0_30px_rgba(0,0,0,.14)]"
      >
        <div
          className="flex h-6 shrink-0 cursor-grab touch-none items-start justify-center pt-2.5 select-none min-[600px]:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        >
          <span className="h-[5px] w-10 rounded-full bg-sand-deep" />
        </div>
        <div className="planner-body min-h-0 flex-1 overflow-y-auto px-5 pb-5 min-[600px]:px-6 min-[600px]:pt-6">{children}</div>
        {footer != null ? (
          <div className="shrink-0 border-t border-sand bg-cream px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] min-[600px]:px-6 min-[600px]:pb-4">
            {footer}
          </div>
        ) : (
          <div aria-hidden="true" className="shrink-0 pb-[env(safe-area-inset-bottom,0px)]" />
        )}
      </div>
    </div>
  );
}
