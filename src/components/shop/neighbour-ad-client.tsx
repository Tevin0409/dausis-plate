"use client";
import { useEffect } from "react";

// Once per page load: a router refresh (the order page polls) must not count the same view again.
const counted = new Set<string>();

function beacon(path: string, body: unknown) {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(path, new Blob([data], { type: "application/json" }))) return;
  } catch {
    // fall through to fetch
  }
  void fetch(path, { method: "POST", body: data, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
}

/** A view: the card at least half on screen for one second (spec 2.11 "Counting"). Renders nothing. */
export function AdSeen({ id, domId }: { id: string; domId: string }) {
  useEffect(() => {
    const el = document.getElementById(domId);
    if (!el || counted.has(id) || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          timer ??= setTimeout(() => {
            if (counted.has(id)) return;
            counted.add(id);
            beacon("/api/ads/view", { ids: [id] });
            io.disconnect();
          }, 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [id, domId]);
  return null;
}

/**
 * The ad's one link, in link style, never a button. A web link goes through /a/[id], which counts
 * the tap and redirects; a phone link dials and counts the tap with a beacon. Long-press stays on.
 */
export function AdLink({
  id,
  kind,
  tel,
  label,
  advertiser,
}: {
  id: string;
  kind: "web" | "tel";
  tel: string | null;
  label: string;
  advertiser: string;
}) {
  const cls =
    "press -mr-2 ml-auto inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-teal-deep underline underline-offset-4 touch-manipulation [overflow-wrap:anywhere]";
  if (kind === "tel" && tel)
    return (
      <a href={`tel:${tel}`} className={cls} aria-label={`${label}, call ${advertiser}`} onClick={() => beacon("/api/ads/tap", { id })}>
        {label}
      </a>
    );
  return (
    <a href={`/a/${id}`} target="_blank" rel="noopener noreferrer sponsored" className={cls}>
      {label}
      <span className="sr-only"> (opens {advertiser} in a new tab)</span>
    </a>
  );
}
