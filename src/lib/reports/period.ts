// The Reports period (spec-2.12 "The period"): parsed from the URL for the page and the CSV route.
// Days are Nairobi days as YYYY-MM-DD strings; all arithmetic is calendar arithmetic.
import { addDays, weekStart } from "@/lib/format";

export type Range = "today" | "week" | "month" | "custom";
export const TABS = ["sales", "dishes", "times", "delivery", "ratings", "promos"] as const;
export type Tab = (typeof TABS)[number];

export type Period = {
  range: Range;
  from: string;
  to: string;
  /** The period before it, for the tiles' change lines. */
  compare: { from: string; to: string };
  tab: Tab;
};

export const MAX_DAYS = 366;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const daysIn = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Is this a real calendar day (not 2026-02-31)? */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfMonth = (day: string) => addDays(`${addDays(monthStart(day), 32).slice(0, 7)}-01`, -1);

/** The earlier period whose figures a period is compared with. */
export function comparePeriod(range: Range, from: string, to: string): { from: string; to: string } {
  if (range === "today") return { from: addDays(from, -7), to: addDays(to, -7) };
  if (range === "week") return { from: addDays(from, -7), to: addDays(to, -7) };
  if (range === "month") {
    const prevFirst = monthStart(addDays(from, -1));
    const sameDay = `${prevFirst.slice(0, 8)}${to.slice(8, 10)}`;
    const last = lastOfMonth(prevFirst);
    return { from: prevFirst, to: sameDay > last ? last : sameDay };
  }
  const n = daysIn(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

export function parseTab(v: unknown): Tab {
  return (TABS as readonly string[]).includes(v as string) ? (v as Tab) : "sales";
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const get = (p: Params, k: string): string | undefined => {
  const v = p instanceof URLSearchParams ? (p.get(k) ?? undefined) : p[k];
  return Array.isArray(v) ? v[0] : v;
};

/** Reads the period from the URL. Anything unreadable falls back to Today. */
export function parseReportPeriod(params: Params, today: string, firstOrderDay?: string | null): Period {
  const tab = parseTab(get(params, "tab"));
  const build = (range: Range, from: string, to: string): Period => ({ range, from, to, compare: comparePeriod(range, from, to), tab });
  const todayPeriod = () => build("today", today, today);

  const from = get(params, "from");
  const to = get(params, "to");
  if (from !== undefined || to !== undefined) {
    if (!isDay(from) || !isDay(to)) return todayPeriod();
    if (to < from || to > today || from > today) return todayPeriod();
    if (daysIn(from, to) > MAX_DAYS) return todayPeriod();
    if (firstOrderDay && from < firstOrderDay) return todayPeriod();
    return build("custom", from, to);
  }
  switch (get(params, "range")) {
    case "week":
      return build("week", weekStart(today), today);
    case "month":
      return build("month", monthStart(today), today);
    default:
      return todayPeriod();
  }
}

/** The check for the Pick dates form: the line to show under the fields, or null when the range is fine. */
export function customRangeError(from: string, to: string, today: string, firstOrderDay?: string | null): string | null {
  if (!isDay(from) || !isDay(to)) return "Pick a start and an end date.";
  if (to < from) return "The end date is before the start date.";
  if (from > today || to > today) return "Dates can’t be after today.";
  if (daysIn(from, to) > MAX_DAYS) return "Pick 366 days or fewer.";
  if (firstOrderDay && from < firstOrderDay) return "There are no orders before the first order’s day.";
  return null;
}

/** The query string for a period, as the URL carries it. */
export function periodQuery(p: Pick<Period, "range" | "from" | "to" | "tab">, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (p.range === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  } else if (p.range !== "today") q.set("range", p.range);
  if (p.tab !== "sales") q.set("tab", p.tab);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

// ───────── words ─────────
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const dom = (day: string) => Number(day.slice(8, 10));
const mon = (day: string) => MONTH[Number(day.slice(5, 7)) - 1]!;

/** "Sat 7 Nov" */
export const shortDay = (day: string) => `${WEEKDAY[dow(day)]} ${dom(day)} ${mon(day)}`;

/** The period in words: "Sat 7 Nov", "Mon 2 – Sat 7 Nov", "1 – 7 Nov", "1 Oct – 7 Nov 2026". */
export function periodLabel(p: Pick<Period, "range" | "from" | "to">, today: string): string {
  const crossesYear = p.from.slice(0, 4) !== p.to.slice(0, 4);
  const year = crossesYear || p.to.slice(0, 4) !== today.slice(0, 4);
  const y = (d: string) => (year ? ` ${d.slice(0, 4)}` : "");
  if (p.from === p.to) return `${shortDay(p.from)}${y(p.to)}`;
  if (p.range === "week") return `${shortDay(p.from)} – ${shortDay(p.to)}${y(p.to)}`;
  if (p.from.slice(0, 7) === p.to.slice(0, 7)) return `${dom(p.from)} – ${dom(p.to)} ${mon(p.to)}${y(p.to)}`;
  return `${dom(p.from)} ${mon(p.from)}${crossesYear ? ` ${p.from.slice(0, 4)}` : ""} – ${dom(p.to)} ${mon(p.to)}${y(p.to)}`;
}

/** Under the tiles: "Compared with Sat 31 Oct". */
export function compareLabel(p: Pick<Period, "range" | "compare">, today: string): string {
  return `Compared with ${periodLabel({ range: p.range, ...p.compare }, today)}`;
}

/** The tiles' "on last Sat" / "on last week" tail. */
export function compareWord(p: Pick<Period, "range" | "from">): string {
  switch (p.range) {
    case "today":
      return `last ${WEEKDAY[dow(p.from)]}`;
    case "week":
      return "last week";
    case "month":
      return "last month";
    default:
      return "the period before";
  }
}

/** "↑ 8%", "↓ 3%", "No change"; null when there is nothing earlier to compare with. */
export function changeText(current: number | null, earlier: number | null | undefined, word: string): string | null {
  if (earlier === null || earlier === undefined || current === null) return null;
  if (earlier === 0) return current === 0 ? null : null;
  const pct = Math.round(((current - earlier) / Math.abs(earlier)) * 100);
  if (pct === 0) return `No change on ${word}`;
  return `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% on ${word}`;
}

/** How the day-by-day figures group: by day to 62 days, by week to 26 weeks, then by month. Mirrors report_sales. */
export function grainFor(from: string, to: string): "day" | "week" | "month" {
  const n = daysIn(from, to);
  return n <= 62 ? "day" : n <= 182 ? "week" : "month";
}

/** A bucket's name in a chart or table: "Fri 6 Nov", "Week of 2 Nov", "Nov 2026"; `short` is for the x axis ("6", "1 Nov"). */
export function bucketLabel(grain: "day" | "week" | "month", bucket: string, short = false): string {
  if (grain === "month") return short ? mon(bucket) : `${mon(bucket)} ${bucket.slice(0, 4)}`;
  if (grain === "week") return short ? `${dom(bucket)} ${mon(bucket)}` : `Week of ${dom(bucket)} ${mon(bucket)}`;
  return short ? (dom(bucket) === 1 ? `1 ${mon(bucket)}` : String(dom(bucket))) : shortDay(bucket);
}
