const kes = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

export const formatKes = (amount: number) => `KSh ${kes.format(amount)}`;

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
