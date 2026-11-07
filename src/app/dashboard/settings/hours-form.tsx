"use client";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
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
          return (
            <li
              key={d.weekday}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-t border-sand py-3 first:border-t-0 first:pt-0 min-[600px]:grid-cols-[132px_minmax(0,1fr)_auto]"
            >
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                {name}
                {d.weekday === todayWeekday && <span className="rounded-full bg-teal-tint px-2 py-0.5 text-[13px] font-bold text-teal-deeper">Today</span>}
              </span>
              <div className="col-span-2 row-start-2 min-[600px]:col-span-1 min-[600px]:col-start-2 min-[600px]:row-start-1">
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
                        aria-describedby={err ? `${id}-e${d.weekday}` : `${id}-mid`}
                        className={field}
                        required
                      />
                    </label>
                  </div>
                ) : (
                  <p className="flex min-h-12 items-center text-[15px] text-ink-soft min-[600px]:mt-5">Closed</p>
                )}
                {err && (
                  <p id={`${id}-e${d.weekday}`} className="note-in mt-1.5 text-sm font-semibold text-coral-ink">
                    {err}
                  </p>
                )}
              </div>
              <Switch
                checked={d.is_open}
                label={`Open on ${name}`}
                onChange={(on) => change(d.weekday, { is_open: on })}
                className="col-start-2 row-start-1 min-[600px]:col-start-3"
              />
            </li>
          );
        })}
      </ul>
      <p id={`${id}-mid`} className={`${hint} mt-1`}>
        For a closing at midnight, set 00:00.
      </p>

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
      {(dirty || result === "saved") && (
        <div
          role="status"
          className="sticky bottom-[calc(var(--tabbar-h,0px)+8px)] z-20 -mx-2 mt-5 flex flex-col gap-3 rounded-[var(--r-md)] bg-ink px-4 py-3 text-paper shadow-[var(--shadow-card)] min-[480px]:flex-row min-[480px]:items-center lg:bottom-3"
        >
          {result === "saved" && !dirty ? (
            <p className="text-[15px] font-semibold">Saved. Customers see the new hours now.</p>
          ) : (
            <>
              <p className={`min-w-0 flex-1 text-[15px] ${result === "failed" ? "font-semibold text-blush" : ""}`}>{barText}</p>
              <div className="grid grid-cols-2 gap-2.5 min-[480px]:flex">
                <button type="button" onClick={cancel} disabled={pending} className={`${btnQuiet} min-h-11`}>
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={pending || hasErrors} aria-disabled={hasErrors || undefined} className={`${btnPrimary} min-h-11 bg-teal-deep`}>
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

/** The hours switch: only the knob moves (translateX 18 px); the track colour changes at once. */
function Switch({ checked, label, onChange, className = "" }: { checked: boolean; label: string; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`switch press flex min-h-12 min-w-12 touch-manipulation items-center justify-center rounded-full select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${className}`}
    >
      <span className={`switch-track flex h-[26px] w-11 items-center rounded-full p-[2px] ${checked ? "bg-teal-deep" : "bg-sand-deep"}`}>
        <span className="switch-knob size-[22px] rounded-full bg-paper shadow-[0_1px_2px_rgb(26_32_44/0.2)]" />
      </span>
    </button>
  );
}
