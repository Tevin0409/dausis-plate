"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { DONE_ROWS, HEAD, PHONE_VIEWS, phoneView, STALE_AFTER_MS, TABLET_VIEWS, tabletView, TITLES, type Status } from "@/lib/board";
import { timeLabel } from "@/lib/format";
import { useBoard } from "./board-notices";

// spec-2.4 "Layouts". One grid for every width; the server renders every column and this part
// decides which show:
// - below 600: one column chosen by five view buttons (default New), and the page scrolls;
// - 600–1279: New on the left, four view buttons and one view on the right (default Cooking);
// - from 1280: four columns side by side, Done below.
// The view is in the URL (?view=ready) through replaceState, so switching is instant and a refresh keeps it.

export type Column = { status: Status; count: number; node: React.ReactNode };


const PLACE: Record<string, string> = {
  new: "min-[600px]:col-start-1 min-[600px]:row-start-1 min-[600px]:row-span-2 min-[1280px]:row-span-1",
  preparing: "min-[600px]:col-start-2 min-[600px]:row-start-2 min-[1280px]:row-start-1",
  ready: "min-[600px]:col-start-2 min-[600px]:row-start-2 min-[1280px]:col-start-3 min-[1280px]:row-start-1",
  on_the_way: "min-[600px]:col-start-2 min-[600px]:row-start-2 min-[1280px]:col-start-4 min-[1280px]:row-start-1",
  completed: "min-[600px]:col-start-2 min-[600px]:row-start-2 min-[1280px]:col-start-1 min-[1280px]:col-span-4 min-[1280px]:row-start-2",
};

// ── The ticket entrance: only for tickets that weren't in the last render (spec Motion row 1).
const EnterContext = createContext<React.RefObject<Set<string> | null> | null>(null);

export function BoardLayout({ columns, keys }: { columns: Column[]; keys: string[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const view = params.get("view");
  const pv = phoneView(view);
  const tv = tabletView(view);
  const grid = useRef<HTMLDivElement>(null);
  const prev = useRef<Set<string> | null>(null);

  // After each render, the tickets on screen become "the last render" for the next one.
  const keyList = keys.join(",");
  useEffect(() => {
    prev.current = new Set(keyList ? keyList.split(",") : []);
  }, [keyList]);

  // The columns fill to the tab bar or the viewport's foot: the grid's top, measured, goes in
  // --board-top and globals.css does the rest (`.board`).
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => el.style.setProperty("--board-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    const main = document.getElementById("main");
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const choose = (s: Status) => {
    const next = new URLSearchParams(params.toString());
    next.set("view", s);
    window.history.replaceState(null, "", `${pathname}?${next.toString()}`);
  };
  const count = (s: Status) => columns.find((c) => c.status === s)?.count ?? 0;

  return (
    <EnterContext.Provider value={prev}>
      <div
        ref={grid}
        className="board grid gap-3 max-[599px]:pb-[var(--strip-h)] min-[600px]:grid-cols-2 min-[1280px]:grid-cols-4 min-[1280px]:gap-x-[14px] min-[1280px]:gap-y-[18px] min-[1280px]:pb-[var(--strip-h)]"
      >
        <ViewButtons
          views={PHONE_VIEWS}
          current={pv}
          count={count}
          onChoose={choose}
          className="sticky top-[env(safe-area-inset-top,0px)] z-20 -mx-4 grid grid-cols-5 gap-1 bg-cream px-4 py-2 min-[600px]:hidden"
        />
        <ViewButtons
          views={TABLET_VIEWS}
          current={tv}
          count={count}
          onChoose={choose}
          className="hidden min-[600px]:col-start-2 min-[600px]:row-start-1 min-[600px]:grid min-[600px]:grid-cols-4 min-[600px]:gap-2 min-[1280px]:hidden"
        />
        {columns.map((c) => {
          const phone = c.status === pv ? "flex" : "hidden";
          const tablet = c.status === "new" || c.status === tv ? "min-[600px]:flex" : "min-[600px]:hidden";
          const scroll =
            c.status === "completed"
              ? "min-[600px]:overflow-y-auto min-[600px]:overscroll-contain min-[1280px]:overflow-visible"
              : "min-[600px]:overflow-y-auto min-[600px]:overscroll-contain min-[600px]:pb-[var(--strip-h)]";
          return (
            <section
              key={c.status}
              data-status={c.status}
              aria-label={c.status === "completed" ? "Done today" : TITLES[c.status]}
              className={`relative min-h-0 min-w-0 flex-col gap-2.5 ${phone} ${tablet} min-[1280px]:flex ${scroll} ${PLACE[c.status]}`}
            >
              {c.node}
            </section>
          );
        })}
      </div>
    </EnterContext.Provider>
  );
}

function ViewButtons({
  views,
  current,
  count,
  onChoose,
  className,
}: {
  views: Status[];
  current: Status;
  count: (s: Status) => number;
  onChoose: (s: Status) => void;
  className: string;
}) {
  return (
    <div role="group" aria-label="Show column" className={className}>
      {views.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={s === current}
          onClick={() => onChoose(s)}
          className={`press flex min-h-[60px] min-w-0 touch-manipulation flex-col items-center justify-center rounded-[var(--r-md)] px-1 py-1.5 select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${HEAD[s]} ${
            s === current ? "!ring-2 !ring-ink ring-inset" : ""
          }`}
        >
          <span className="text-[22px] leading-none font-bold tabular-nums">{count(s)}</span>
          <span className="mt-1 text-center text-[12.5px] leading-tight font-semibold">{TITLES[s]}</span>
        </button>
      ))}
    </div>
  );
}

/** A ticket or Done row. It enters (8 px, `.ticket-in`) only if it wasn't in the last render. */
export function TicketShell({
  as: Tag = "article",
  orderKey,
  orderId,
  className,
  children,
}: {
  as?: "article" | "li";
  orderKey: string;
  orderId: string;
  className: string;
  children: React.ReactNode;
}) {
  const prev = useContext(EnterContext);
  const [entering, setEntering] = useState(() => !!prev?.current && !prev.current.has(orderKey));
  useEffect(() => {
    if (!entering) return;
    // Dropped after it has run, so showing a hidden view later doesn't replay it.
    const t = setTimeout(() => setEntering(false), 400);
    return () => clearTimeout(t);
  }, [entering]);
  return (
    <Tag id={`order-${orderId}`} tabIndex={-1} className={`${entering ? "ticket-in " : ""}${className}`}>
      {children}
    </Tag>
  );
}

/** The type filters, keeping the view. */
export function BoardFilters() {
  const params = useSearchParams();
  const pathname = usePathname();
  const mode = params.get("mode");
  const filters = [
    { id: null, label: "All" },
    { id: "dine_in", label: "Dine-in" },
    { id: "pickup", label: "Pickup" },
    { id: "delivery", label: "Delivery" },
  ] as const;
  return (
    <nav aria-label="Order type" className="flex flex-wrap gap-2">
      {filters.map((f) => {
        const next = new URLSearchParams(params.toString());
        if (f.id) next.set("mode", f.id);
        else next.delete("mode");
        const q = next.toString();
        const on = (mode ?? null) === f.id;
        return (
          <Link
            key={f.label}
            href={q ? `${pathname}?${q}` : pathname}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`press flex min-h-11 touch-manipulation items-center rounded-full px-4 text-sm select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${
              on ? "bg-ink font-semibold text-white" : "bg-paper font-medium ring-1 ring-line-deep ring-inset"
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Done's rows: the first 8, then "Show all N" (instant). A row whose Mark paid Undo is still live
 * stays shown even when it sorts past the first 8, so the Undo is never lost (QA RQA24-03).
 */
export function DoneList({ rows }: { rows: { id: string; node: React.ReactNode }[] }) {
  const [all, setAll] = useState(false);
  const paidUndos = useBoard()?.paidUndos;
  const shown = all ? rows : rows.filter((r, i) => i < DONE_ROWS || paidUndos?.has(r.id));
  return (
    <>
      <ul className="flex flex-col divide-y divide-sand rounded-[var(--r-md)] bg-paper shadow-[var(--shadow-card)]">{shown.map((r) => r.node)}</ul>
      {!all && rows.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="press min-h-11 self-start touch-manipulation rounded-full px-4 text-sm font-bold text-teal-deep select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
        >
          Show all {rows.length}
        </button>
      )}
    </>
  );
}

/**
 * "Updated 14:02", or the amber "Not updated since 14:02. Check the connection." once the page
 * is 75 s old. Ages are counted from when this render arrived, so the tablet's clock can't skew it.
 */
export function Freshness({ renderedAt }: { renderedAt: string }) {
  const [arrived, setArrived] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [seen, setSeen] = useState(renderedAt);
  if (seen !== renderedAt) {
    setSeen(renderedAt);
    setArrived(Date.now());
    setStale(false);
  }
  useEffect(() => {
    const check = () => setStale(Date.now() - arrived > STALE_AFTER_MS);
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [arrived]);
  const at = timeLabel(renderedAt);
  return stale ? (
    <span role="status" className="inline-flex min-h-6 items-center rounded-full bg-amber-tint px-2.5 text-[14px] font-bold text-amber-ink">
      Not updated since {at}. Check the connection.
    </span>
  ) : (
    <span className="text-sm text-ink-soft">Updated {at}</span>
  );
}
