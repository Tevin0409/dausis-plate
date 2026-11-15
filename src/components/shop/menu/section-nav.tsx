"use client";
import { useEffect, useRef, useState } from "react";
import { useKitchen } from "../kitchen-provider";
import { hoursCard } from "@/lib/kitchen";

export type NavSection = { id: string; label: string; count: number };

/**
 * The current section: the last one whose top is at or above `line` px from the top of the
 * viewport; at the very bottom of the page, the last section (spec-2.8 "The rail"). One passive
 * scroll listener, at most one read per frame.
 */
function useActiveSection(ids: string[], line: number) {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    const list = key.split(",").filter(Boolean);
    let frame = 0;
    const read = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = list[0] ?? "";
      if (atBottom) current = list[list.length - 1] ?? current;
      else
        for (const id of list) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= line) current = id;
        }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [key, line]);
  return active;
}

/** Phone: the sticky jump bar (DESIGN.md "Jump bar"). The active link changes instantly. */
export function JumpBar({ sections }: { sections: NavSection[] }) {
  const active = useActiveSection(
    sections.map((s) => s.id),
    90,
  );
  const bar = useRef<HTMLDivElement>(null);
  // Keep the active link in view inside the bar, without moving the page.
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    const host = bar.current;
    if (!el || !host) return;
    const { offsetLeft, offsetWidth } = el;
    if (offsetLeft < host.scrollLeft || offsetLeft + offsetWidth > host.scrollLeft + host.clientWidth)
      host.scrollLeft = offsetLeft - 16;
  }, [active]);
  if (sections.length < 2) return null;
  return (
    <nav aria-label="Menu sections" className="sticky top-0 z-[5] border-b border-sand bg-cream lg:hidden">
      <div ref={bar} className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2 [overscroll-behavior-x:contain]">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-id={s.id}
            aria-current={active === s.id ? "location" : undefined}
            className={`press flex min-h-11 flex-none select-none items-center rounded-full px-4 text-[15px] font-semibold touch-manipulation ${
              active === s.id ? "bg-teal-tint text-teal-deeper" : "text-ink-soft"
            }`}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** Computer: the left rail, with each section's count and the hours card (spec-2.8 "The rail"). */
export function Rail({ sections, address, onMenu = true }: { sections: NavSection[]; address: string | null; onMenu?: boolean }) {
  const active = useActiveSection(
    onMenu ? sections.map((s) => s.id) : [],
    90,
  );
  const { status } = useKitchen();
  const card = hoursCard(status);
  return (
    <nav
      aria-label="Menu sections"
      className="sticky top-4 hidden max-h-[calc(100dvh-32px)] flex-col gap-1 self-start overflow-y-auto pt-7 [overscroll-behavior:contain] lg:flex"
    >
      {sections.map((s) => {
        const current = onMenu && active === s.id;
        return (
          <a
            key={s.id}
            href={onMenu ? `#${s.id}` : `/#${s.id}`}
            aria-current={current ? "location" : undefined}
            className={`rail-link press flex min-h-11 select-none items-center justify-between rounded-[var(--r-sm)] px-3 text-[15px] font-semibold touch-manipulation ${
              current ? "bg-teal-tint text-teal-deeper" : "text-ink-soft"
            }`}
          >
            <span className="min-w-0 truncate">{s.label}</span>
            <span className="text-[13px] font-semibold tabular-nums">{s.count}</span>
          </a>
        );
      })}
      <div className="mt-4 rounded-[var(--r-md)] bg-paper p-3.5 text-[13.5px] leading-snug text-ink-soft ring-1 ring-sand">
        <p className="font-semibold text-ink">{card.lead}</p>
        {card.rest && <p>{card.rest}</p>}
        {address && <p className="mt-1.5">{address}</p>}
      </div>
    </nav>
  );
}
