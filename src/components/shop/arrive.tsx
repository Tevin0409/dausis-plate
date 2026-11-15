"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const FLAG = "dp-arrive";

/** Call just before opening an order from Place order or Find my order: that page fades in. */
export function markArrival() {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {}
}

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * The status page's arrival (spec-2.8b Motion): fade with an 8 px rise, `--dur-small`, `--ease-out`.
 * Only after Place order or Find my order, never on a plain load or a refresh. Reduced motion: opacity.
 */
export function Arrive({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let arrived = false;
    try {
      arrived = sessionStorage.getItem(FLAG) === "1";
      sessionStorage.removeItem(FLAG);
    } catch {}
    const el = ref.current;
    if (!arrived || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.animate(
      [
        { opacity: 0, transform: reduce ? "none" : "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: parseFloat(token("--dur-small", "180ms")), easing: token("--ease-out", "ease-out") },
    );
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** The band's headline: fades in (6 px) when a refresh brings a new status, never on first load. */
export function StatusHeadline({ text, sub }: { text: string; sub: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div key={text} className={`mt-3 flex flex-col gap-1 ${mounted ? "note-in" : ""}`}>
      <h1 className="font-display text-[30px] leading-[1.1]">{text}</h1>
      <span className="text-[15px] text-on-teal-soft">{sub}</span>
    </div>
  );
}
