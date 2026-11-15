// Slice 2.5: the menu planner's wording and day arithmetic (spec-2.5-menu-planner.md). Plain module,
// so the server page, the client panel and the History all use it, and it is unit-tested.

import { addDays, formatKes, hhmm, weekdayName } from "@/lib/format";

const count = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
export const n = (v: number) => count.format(v);

/** Day of the week as opening_hours stores it (Postgres `dow`: 0 = Sunday). */
export const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

const part = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(`${day}T12:00:00Z`));
const dayNum = (day: string) => part(day, { day: "numeric" });
const month = (day: string) => part(day, { month: "short" });
/** "Mon", "Tue". */
export const shortWeekday = (day: string) => part(day, { weekday: "short" });
/** "Tuesday 4 Nov". */
export const dayTitle = (day: string) => `${weekdayName(day)} ${dayNum(day)} ${month(day)}`;
/** "Mon 3". */
export const tileHead = (day: string) => `${shortWeekday(day)} ${dayNum(day)}`;

/** The week label: "3–9 Nov", "27 Oct – 2 Nov", "29 Dec 2026 – 4 Jan 2027". */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  if (monday.slice(0, 4) !== sunday.slice(0, 4)) {
    return `${dayNum(monday)} ${month(monday)} ${monday.slice(0, 4)} – ${dayNum(sunday)} ${month(sunday)} ${sunday.slice(0, 4)}`;
  }
  if (monday.slice(5, 7) !== sunday.slice(5, 7)) return `${dayNum(monday)} ${month(monday)} – ${dayNum(sunday)} ${month(sunday)}`;
  return `${dayNum(monday)}–${dayNum(sunday)} ${month(sunday)}`;
}

export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/**
 * A week dish's days: "Every day" when it runs on every day it could (`possible`: the week's open
 * days), "Every day but Wed" when one is missing, otherwise runs: "Mon–Wed, Fri".
 */
export function daysLabel(days: string[], possible?: string[]): string {
  const on = [...new Set(days)].sort();
  if (on.length === 0) return "No days";
  if (possible && possible.length > 1) {
    const all = [...new Set(possible)].sort();
    const missing = all.filter((d) => !on.includes(d));
    if (missing.length === 0 && on.every((d) => all.includes(d))) return "Every day";
    if (missing.length === 1 && all.length >= 5 && on.every((d) => all.includes(d))) return `Every day but ${shortWeekday(missing[0]!)}`;
  }
  const runs: string[][] = [];
  for (const d of on) {
    const last = runs.at(-1);
    if (last && addDays(last.at(-1)!, 1) === d) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length >= 3 ? `${shortWeekday(r[0]!)}–${shortWeekday(r.at(-1)!)}` : r.map(shortWeekday).join(", ")))
    .join(", ");
}

/** "25 plates", "1 plate", "No limit". `aDay` for week dishes: "25 plates a day". */
export function platesLabel(plates: number | null, aDay = false): string {
  if (plates === null) return "No limit";
  return `${n(plates)} ${plates === 1 ? "plate" : "plates"}${aDay ? " a day" : ""}`;
}

export const hoursLabel = (from: string, until: string) => `${hhmm(from)}–${hhmm(until)}`;

/** Today's sold line (spec "Sold out"), and whether it reads as sold out. Same test as todays_menu. */
export function soldLine(sold: number, limit: number | null, manual: boolean): { text: string; out: boolean; atLimit: boolean } {
  const atLimit = limit !== null && sold >= limit;
  if (atLimit) return { text: `Sold out · ${n(sold)} of ${n(limit)}`, out: true, atLimit };
  if (manual) return { text: "Marked sold out", out: true, atLimit };
  if (limit !== null) return { text: `${n(sold)} of ${n(limit)} sold`, out: false, atLimit };
  return { text: `${n(sold)} sold`, out: false, atLimit };
}

export type DayState = "past" | "today" | "later";
export const dayState = (day: string, today: string): DayState => (day < today ? "past" : day === today ? "today" : "later");

/** A tile's status line: "Done · 4", "Live · 5", "Planned · 3", "Not planned". */
export function statusLine(day: string, today: string, dishes: number): { text: string; unplanned: boolean } {
  const s = dayState(day, today);
  if (s === "past") return { text: `Done · ${n(dishes)}`, unplanned: false };
  if (dishes === 0) return { text: "Not planned", unplanned: true };
  return { text: `${s === "today" ? "Live" : "Planned"} · ${n(dishes)}`, unplanned: false };
}

/** The next day after `today` the kitchen opens, skipping weekly closed days and closed dates. */
export function nextOpenDay(today: string, isOpen: (day: string) => boolean): string | null {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, i);
    if (isOpen(d)) return d;
  }
  return null;
}

/** "HH:MM" from a Postgres time; "24:00:00" stays "24:00". */
const toMin = (t: string) => {
  const [h = 0, m = 0] = hhmm(t).split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type Hours = { opens: string; closes: string } | null;

/**
 * The panel's starting hours (spec "Serving hours"): the dish's last hours kept inside the day's
 * opening hours, else the opening hours, else 11:00–20:00. A time field can't hold 24:00, so a
 * midnight close becomes 23:59.
 */
export function defaultHours(last: { from: string; until: string } | null, open: Hours): { from: string; until: string } {
  const cap = (t: string) => (toMin(t) >= 24 * 60 ? "23:59" : hhmm(t));
  if (!open) return last ? { from: hhmm(last.from), until: cap(last.until) } : { from: "11:00", until: "20:00" };
  const o = toMin(open.opens);
  const c = Math.min(toMin(open.closes), 23 * 60 + 59);
  if (!last) return { from: fromMin(o), until: fromMin(c) };
  const from = Math.min(Math.max(toMin(last.from), o), c);
  const until = Math.min(Math.max(toMin(last.until), o), c);
  return until > from ? { from: fromMin(from), until: fromMin(until) } : { from: fromMin(o), until: fromMin(c) };
}

/** True when the serving hours start before opening or end after closing. */
export function outsideHours(from: string, until: string, open: Hours): boolean {
  if (!open) return false;
  return toMin(from) < toMin(open.opens) || toMin(until) > toMin(open.closes);
}

/** The clash message (spec "One dish, once a day"). */
export function clashMessage(name: string, day: string, mine: "day" | "week", other: string | null): string {
  const wd = weekdayName(day);
  if (mine === "week" && other === "day") return `${name} is already on ${wd} as a day dish. Untick ${wd}, or remove it there first.`;
  return `${name} is already on ${wd}’s menu.`;
}

export type PlannerField = "dish" | "hours" | "plates" | "price" | "days" | "form";

/** The panel's field for each refusal code the planner RPCs send in `detail` (P0001). */
export const REFUSAL_FIELD: Record<string, PlannerField> = {
  no_days: "days",
  one_day: "days",
  two_weeks: "days",
  closed_day: "days",
  past: "form",
  hours: "hours",
  plates: "plates",
  price: "price",
  dish: "dish",
  gone: "form",
};

/** Validates the panel's fields the way the database does, so errors show under the field. */
export function checkFields(v: { from: string; until: string; plates: string; price: string }): Partial<Record<PlannerField, string>> {
  const errors: Partial<Record<PlannerField, string>> = {};
  if (!/^\d{2}:\d{2}$/.test(v.from) || !/^\d{2}:\d{2}$/.test(v.until) || v.until <= v.from) errors.hours = "Serving must end after it starts.";
  const plates = v.plates.trim();
  if (plates && (!/^\d+$/.test(plates) || Number(plates) < 1 || Number(plates) > 1000)) {
    errors.plates = "Plates a day can be 1 to 1,000. Leave it empty for no limit.";
  }
  const price = v.price.trim();
  if (price && (!/^\d+$/.test(price) || Number(price) > 100000)) errors.price = "Price is in whole shillings, up to 100,000.";
  return errors;
}

/**
 * The copy note's price line (RQA25-02, spec-2.5 "Build follow-ups" item 6): which one-day prices came
 * across. `source` is the button's name for the day ("Monday", "last Tuesday"). Null when no copied
 * dish had a one-day price. Names in tile order; from 4 dishes, two are named and the rest counted.
 */
export function copyPriceLine(prices: { kept: boolean; dishes: { name: string; price: number }[] }, source: string): string | null {
  const d = prices.dishes;
  if (d.length === 0) return null;
  const whose = `${source}\u2019s`;
  if (d.length === 1) {
    const [one] = d;
    return prices.kept ? `${one!.name} keeps ${whose} price, ${formatKes(one!.price)}.` : `${one!.name} is at its usual price, ${formatKes(one!.price)}.`;
  }
  const names =
    d.length === 2 ? `${d[0]!.name} and ${d[1]!.name}`
    : d.length === 3 ? `${d[0]!.name}, ${d[1]!.name} and ${d[2]!.name}`
    : `${d[0]!.name}, ${d[1]!.name} and ${n(d.length - 2)} more dishes`;
  return prices.kept ? `${names} keep ${whose} prices.` : `${names} are at their usual prices.`;
}

/** "A", "A and B", "A, B and C". */
export const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The panel's line when ticked days include a one-off closed date (follow-ups item 2). `closed` are ISO days. */
export function closedLine(kind: "day" | "week", closed: string[]): string {
  if (kind === "day") return "Customers won\u2019t see these while it\u2019s closed.";
  const names = andList(closed.map(weekdayName));
  return closed.length > 1
    ? `Closed on ${names}. Customers won\u2019t see it on those days.`
    : `Closed on ${names}. Customers won\u2019t see it while it\u2019s closed.`;
}

/**
 * A new dish's "Save and add to menu" (the planner's "+ New dish"): what the menu step would refuse,
 * checked before the dish is saved so a refusal saves nothing (Tevin 2026-11-15). The planner never
 * takes an everyday dish (spec-2.5); that form doesn't offer the switch (Tevin's A), so only a
 * hand-made request gets that line. Serving must end after it starts (planner_values). The database
 * still checks both. `field` is the form field the line goes under.
 */
export function newDishPlanProblem(v: { everyday: boolean; from: string; until: string }): { field: "is_regular" | "show_until"; error: string } | null {
  if (v.everyday) return { field: "is_regular", error: "An everyday dish can’t also be planned. Put it on the everyday menu from Dishes." };
  if (v.until <= v.from) return { field: "show_until", error: "Serving must end after it starts." };
  return null;
}
