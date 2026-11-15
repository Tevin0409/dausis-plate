const kes = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

// A no-break space keeps "KSh" on the same line as the figure, so a large amount wraps as a
// whole instead of leaving "KSh" alone on a line (2.1 break-ui: seven-figure owner tiles).
export const formatKes = (amount: number) => `KSh\u00A0${kes.format(amount)}`;

const TZ = "Africa/Nairobi";

/** Today's date in Nairobi as YYYY-MM-DD. */
export function nairobiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds days to a YYYY-MM-DD string (calendar arithmetic, no time zone drift). */
export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing isoDay. */
export function weekStart(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(isoDay, -offset);
}

export function dayLabel(isoDay: string, style: "short" | "long" = "short"): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "UTC",
    weekday: style,
    day: "numeric",
    ...(style === "long" ? { month: "long" } : {}),
  }).format(d);
}

export function weekdayName(isoDay: string): string {
  return new Intl.DateTimeFormat("en-KE", { timeZone: "UTC", weekday: "long" }).format(new Date(`${isoDay}T12:00:00Z`));
}

export function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-KE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function minutesAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/** "11:00:00" → "11:00" */
export const hhmm = (t: string) => t.slice(0, 5);

/** A closed date: "Fri 25 Dec", with the year only when it isn't this year. Here, not in the
 *  client component, so the server page can call it too (RQA23-04). */
export function closedDateLabel(day: string, today: string) {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  // Built from parts: en-GB puts a comma after the weekday once the year is in.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(
    new Date(`${day}T12:00:00Z`),
  );
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return [get("weekday"), get("day"), get("month"), sameYear ? "" : get("year")].filter(Boolean).join(" ");
}
