"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/dashboard/switch";
import { saveHours } from "./actions";
import { btnLink, btnPrimary, btnQuiet, field, hint, tile, tileHeading } from "./ui";

export type Day = { weekday: number; is_open: boolean; opens: string; closes: string };

const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first (spec-2.2 "Weekly hours"); weekday is Postgres's dow, 0 = Sunday. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LAST_ORDERS = [
  { value: 30, label: "30 minutes before closing" },
  { value: 15, label: "15 minutes before closing" },
  { value: 0, label: "At closing time" },
] as const;

/** Minutes from midnight. A closing of 00:00 is midnight, the end of the day (2A). */
const minutes = (t: string, closing = false) => {
  const [h, m] = t.split(":").map(Number);
  const n = (h ?? 0) * 60 + (m ?? 0);
  return closing && n === 0 ? 1440 : n;
};
const clock = (n: number) => (n >= 1440 ? "midnight" : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`);
const rowError = (d: Day) => (d.is_open && minutes(d.closes, true) - minutes(d.opens) < 60 ? "Closing must be at least 1 hour after opening." : null);
const same = (a: Day[], b: Day[]) => a.every((d, i) => d.is_open === b[i]!.is_open && d.opens === b[i]!.opens && d.closes === b[i]!.closes);

type Props = {
  initial: Day[];
  lastOrders: number;
  /** Today's weekday in Nairobi, and the server's Nairobi minutes past midnight when the page rendered. */
  todayWeekday: number;
  nowMinutes: number;
  /** Whether customers can order right now, so the save bar can warn when saving stops it. */
  openNow: boolean;
};

export function HoursForm({ initial, lastOrders: initialLast, todayWeekday, nowMinutes, openNow }: Props) {
  const sorted = useMemo(() => ORDER.map((w) => initial.find((d) => d.weekday === w)!), [initial]);
  const [saved, setSaved] = useState({ days: sorted, last: initialLast });
  const [days, setDays] = useState(sorted);
  const [last, setLast] = useState(initialLast);
  const [result, setResult] = useState<"saved" | "failed" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();

  const dirty = !same(days, saved.days) || last !== saved.last;
  const errors = days.map(rowError);
  const hasErrors = errors.some(Boolean);
  const today = days.find((d) => d.weekday === todayWeekday)!;
  const todayLast = today.is_open ? minutes(today.closes, true) - last : null;
  // Saving closes ordering now if customers can order and today's new hours don't take orders at this minute.
  const closesNow =
    openNow && (!today.is_open || nowMinutes < minutes(today.opens) || (todayLast !== null && nowMinutes > todayLast));
  const allOff = days.every((d) => !d.is_open);
  const firstOpen = days.find((d) => d.is_open);
  const anyMidnight = days.some((d) => d.is_open && d.closes === "00:00");
  const barShown = dirty || result === "saved";

  // Phone rows (build follow-up 1): which days have their fields open, and where focus goes next.
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const fieldRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const focusDay = useRef<number | null>(null);
  const toggleDay = (weekday: number) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(weekday)) next.delete(weekday);
      else {
        next.add(weekday);
        focusDay.current = weekday;
      }
      return next;
    });
  };
  useEffect(() => {
    const w = focusDay.current;
    if (w === null) return;
    focusDay.current = null;
    const box = fieldRefs.current[w];
    box?.querySelector("input")?.focus({ preventScroll: true });
    box?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // While the save bar shows, focus and scrolling stop above it (build follow-up 2).
  useEffect(() => {
    if (!barShown) return;
    document.documentElement.classList.add("savebar-pad");
    return () => document.documentElement.classList.remove("savebar-pad");
  }, [barShown]);

  // The browser's leave warning while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (weekday: number, patch: Partial<Day>) => {
    setResult(null);
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  };

  function copyFirst() {
    if (!firstOpen) return;
    setResult(null);
    setDays((ds) => ds.map((d) => (d.is_open ? { ...d, opens: firstOpen.opens, closes: firstOpen.closes } : d)));
  }

  function save() {
    if (hasErrors) return;
    setFailure(null);
    start(async () => {
      const res = await saveHours(days, last).catch(() => null);
      if (!res?.ok) {
        setResult("failed");
        setFailure(res && !res.ok ? res.error : null);
        return;
      }
      setSaved({ days, last });
      setResult("saved");
    });
  }

  function cancel() {
    setDays(saved.days);
    setLast(saved.last);
    setResult(null);
  }

  const barText = pending
    ? "Saving…"
    : result === "failed"
      ? (failure ?? "Couldn’t save. Your hours haven’t changed. Try again.")
      : allOff
        ? "No opening day is set. Customers can’t order until you open one."
        : closesNow
          ? "Saving closes ordering now."
          : "Changes aren’t live until you save.";

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        Weekly hours
      </h2>
      <p className={`${hint} mt-1`}>The same hours for dine-in, pickup and delivery.</p>

      <ul className="mt-4 flex flex-col">
        {days.map((d, i) => {
          const name = NAMES[d.weekday]!;
          const err = errors[i];
          const was = saved.days[i]!;
          const changed = d.is_open !== was.is_open || d.opens !== was.opens || d.closes !== was.closes;
          // Below 600 a day is one line until opened; a changed day or one with an error stays open.
          const shown = d.is_open && (open.has(d.weekday) || changed || Boolean(err));
          const midnight = d.is_open && d.closes === "00:00";
          return (
            <li
              key={d.weekday}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2 border-t border-sand py-1 first:border-t-0 min-[600px]:grid-cols-[132px_minmax(0,1fr)_auto] min-[600px]:gap-x-3 min-[600px]:py-3 min-[600px]:first:pt-0"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold max-[359px]:text-[14px]">
                {name}
                {d.weekday === todayWeekday && <span className="rounded-full bg-teal-tint px-2 py-0.5 text-[13px] font-bold text-teal-deeper">Today</span>}
              </span>
              {/* Phone: the day's hours as text; tapping opens its fields (spec-2.2 build follow-up 1). */}
              {d.is_open ? (
                <button
                  type="button"
                  aria-label={`Change ${name}’s hours`}
                  aria-expanded={shown}
                  aria-controls={`${id}-f${d.weekday}`}
                  onClick={() => toggleDay(d.weekday)}
                  className="press flex min-h-11 touch-manipulation flex-col items-end justify-center rounded-[var(--r-sm)] px-0.5 text-right text-[15px] tabular-nums max-[359px]:text-[14px] select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep min-[600px]:hidden"
                >
                  <span className="whitespace-nowrap">
                    {d.opens} – {d.closes === "00:00" ? "midnight" : d.closes}
                  </span>
                  {changed && <span className="whitespace-nowrap text-[13px] leading-tight text-ink-soft">Changed</span>}
                </button>
              ) : (
                <span className="text-right text-[15px] text-ink-soft min-[600px]:hidden">
                  Closed{changed && <span className="ml-2 text-sm">Changed</span>}
                </span>
              )}
              <div
                id={`${id}-f${d.weekday}`}
                ref={(el) => {
                  fieldRefs.current[d.weekday] = el;
                }}
                className={`col-span-3 row-start-2 pb-2 min-[600px]:col-span-1 min-[600px]:col-start-2 min-[600px]:row-start-1 min-[600px]:block min-[600px]:pb-0 ${shown ? "" : "hidden"}`}
              >
                {d.is_open ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
                      Opens
                      <input
                        type="time"
                        step={60}
                        value={d.opens}
                        onChange={(e) => change(d.weekday, { opens: e.target.value })}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${id}-e${d.weekday}` : undefined}
                        className={field}
                        required
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
                      Closes
                      <input
                        type="time"
                        step={60}
                        value={d.closes}
                        onChange={(e) => change(d.weekday, { closes: e.target.value })}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${id}-e${d.weekday}` : midnight ? `${id}-m${d.weekday}` : anyMidnight ? undefined : `${id}-mid`}
                        className={field}
                        required
                      />
                    </label>
                  </div>
                ) : (
                  <p className="flex min-h-12 items-center text-[15px] text-ink-soft min-[600px]:mt-5">Closed</p>
                )}
                {err ? (
                  <p id={`${id}-e${d.weekday}`} className="note-in mt-1.5 text-sm font-semibold text-coral-ink">
                    {err}
                  </p>
                ) : (
                  midnight && (
                    <p id={`${id}-m${d.weekday}`} className={`${hint} mt-1.5`}>
                      00:00 means midnight, at the end of {name}.
                    </p>
                  )
                )}
              </div>
              <Switch
                checked={d.is_open}
                label={`Open on ${name}`}
                onChange={(on) => change(d.weekday, { is_open: on })}
                className="col-start-3 row-start-1 min-h-12 min-w-12 justify-center"
              />
            </li>
          );
        })}
      </ul>
      {!anyMidnight && (
        <p id={`${id}-mid`} className={`${hint} mt-1`}>
          For a closing at midnight, set 00:00.
        </p>
      )}

      {firstOpen && (
        <button type="button" onClick={copyFirst} className={`${btnLink} -mx-2 mt-2`}>
          Copy {NAMES[firstOpen.weekday]}’s hours to all open days
        </button>
      )}

      <label className="mt-4 flex flex-col gap-1.5 text-[15px] font-semibold">
        Last orders
        <select value={last} onChange={(e) => (setResult(null), setLast(Number(e.target.value)))} className={field}>
          {LAST_ORDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className={`${hint} mt-1.5`}>
        {todayLast === null || rowError(today) ? "Closed today." : `Today: last orders at ${clock(todayLast)}.`}
      </p>

      {/* The save bar only exists while the form has changes, or to say how the last save went. */}
      {barShown && (
        <div
          role="status"
          className="sticky bottom-[calc(var(--tabbar-h,0px)+8px)] z-20 -mx-2 mt-5 flex flex-col gap-3 rounded-[var(--r-md)] bg-ink px-4 py-3 text-paper shadow-[var(--shadow-card)] min-[480px]:flex-row min-[480px]:items-center lg:bottom-3"
        >
          {result === "saved" && !dirty ? (
            <p className="text-[15px] font-semibold">Saved. Customers see the new hours now.</p>
          ) : (
            <>
              <p className={`min-w-0 flex-1 text-[15px] ${result === "failed" ? "font-semibold text-blush" : ""}`}>{barText}</p>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 min-[480px]:flex">
                <button type="button" onClick={cancel} disabled={pending} className={`${btnQuiet} min-h-11`}>
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={pending || hasErrors} aria-disabled={hasErrors || undefined} className={`${btnPrimary} min-h-11 whitespace-nowrap bg-teal-deep`}>
                  {pending ? "Saving…" : "Save hours"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
