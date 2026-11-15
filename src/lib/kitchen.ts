// Opening hours (spec-2.2-opening-hours.md). The database decides open or closed
// (kitchen_status_at); this file is the one place its answer becomes words, so the menu
// notice, the order button, the Settings strip and the checkout errors can't disagree.
// Every time here comes from the server: the status, and `now` from the server's clock.
import { timeLabel, weekdayName } from "./format";

export type KitchenReason =
  | "before_opening"
  | "past_last_orders"
  | "after_closing"
  | "closed_day"
  | "closed_date"
  | "closed_early";

export type KitchenStatus = {
  state: "open" | "closed";
  reason: KitchenReason | null;
  /** Nairobi's date, YYYY-MM-DD. */
  today: string;
  last_orders_minutes: number;
  opens_at: string | null;
  last_order_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  next_open_date: string | null;
  next_opens_at: string | null;
  after_today_open_date: string | null;
  after_today_opens_at: string | null;
};

/** What the server knows right now: the status, and its own clock. */
export type KitchenSnapshot = { status: KitchenStatus; now: string };

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const longDate = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));

/** "21:00", or "midnight" for a time at the end of the day (a closing or last orders at 24:00). */
export const closingTime = (iso: string) => (timeLabel(iso) === "00:00" ? "midnight" : timeLabel(iso));

/**
 * The day part of an opening, said from today: "today", "tomorrow (Friday)", "Monday",
 * "Monday 4 January". Never "tomorrow" without checking it really is tomorrow.
 */
export function dayFrom(today: string, day: string): string {
  const n = days(today, day);
  if (n === 0) return "today";
  if (n === 1) return `tomorrow (${weekdayName(day)})`;
  if (n < 7) return weekdayName(day);
  return longDate(day);
}

/** "today at 11:00", "tomorrow (Friday) at 11:00", "Monday at 11:00". Null if nothing opens ahead. */
export function opensWhen(s: KitchenStatus, after: "next" | "after_today" = "next"): string | null {
  const day = after === "next" ? s.next_open_date : s.after_today_open_date;
  const at = after === "next" ? s.next_opens_at : s.after_today_opens_at;
  if (!day || !at) return null;
  return `${dayFrom(s.today, day)} at ${timeLabel(at)}`;
}

const ORDER_WHEN_OPEN = "Add dishes now, order when we open.";

/**
 * The menu's notice. While closed: why and when it opens. While open: a quiet line in the
 * last 30 minutes before last orders. Otherwise null.
 */
export function menuNotice(s: KitchenStatus, now: Date): { tone: "closed" | "quiet"; text: string } | null {
  if (s.state === "open") {
    if (!s.last_order_at) return null;
    const left = Date.parse(s.last_order_at) - now.getTime();
    return left <= 30 * 60_000 ? { tone: "quiet", text: `Last orders at ${closingTime(s.last_order_at)}` } : null;
  }
  const when = opensWhen(s);
  if (!when) return { tone: "closed", text: "Closed for now. Please check back soon." };
  const lead = s.reason === "past_last_orders" && s.last_order_at ? `Last orders were at ${closingTime(s.last_order_at)}.` : "Closed now.";
  return { tone: "closed", text: `${lead} Opens ${when}. ${ORDER_WHEN_OPEN}` };
}

/** The disabled main button's words while closed, before " · KSh …". */
export function closedButton(s: KitchenStatus): string {
  if (!s.next_open_date || !s.next_opens_at) return "Closed for now";
  const time = timeLabel(s.next_opens_at);
  const n = days(s.today, s.next_open_date);
  if (n === 0) return `Order from ${time}`;
  if (n === 1) return `Order from ${time} tomorrow`;
  if (n < 7) return `Order from ${weekdayName(s.next_open_date)} ${time}`;
  return `Order from ${longDate(s.next_open_date)} ${time}`;
}

/** Checkout, when place_order refused because the kitchen closed while the page was open. */
export function justClosedNote(s: KitchenStatus): string {
  const when = opensWhen(s);
  return when ? `We’ve just closed. Opens ${when}. Your order is saved.` : "We’ve just closed. Your order is saved.";
}

/** Settings' status strip: what customers get right now. */
export function statusStrip(s: KitchenStatus): string {
  const when = opensWhen(s);
  const opens = when ? `Opens ${when}` : "No opening day is set";
  if (s.state === "open" && s.last_order_at && s.closes_at) {
    return `Open now · Last orders ${closingTime(s.last_order_at)} · Closes ${closingTime(s.closes_at)}`;
  }
  if (s.reason === "closed_early" && s.closed_early_at) return `Closed early since ${timeLabel(s.closed_early_at)} · ${opens}`;
  if (s.reason === "past_last_orders" && s.last_order_at) return `Last orders were at ${closingTime(s.last_order_at)} · ${opens}`;
  return `Closed now · ${opens}`;
}

/** The sold-out line on a regular dish: back on the next open day after today. */
export function backOnSale(s: KitchenStatus): string {
  const day = s.after_today_open_date;
  if (!day) return "Sold out today.";
  const n = days(s.today, day);
  if (n === 1) return "Sold out today. Back tomorrow.";
  return `Sold out today. Back ${n < 7 ? weekdayName(day) : longDate(day)}.`;
}

/** A regular dish is on sale unless it was switched off today (the database's regular_on_sale). */
export const regularOnSale = (unavailableOn: string | null, today: string) => unavailableOn !== today;

export type PickupSlot = { at: string; label: string };

/**
 * Pickup times: on the hour and half hour, at least 30 minutes from now, up to and including
 * closing, today only. Empty while closed or when none fit ("As soon as it's ready" only).
 */
export function pickupSlots(s: KitchenStatus, now: Date): PickupSlot[] {
  if (s.state !== "open" || !s.closes_at) return [];
  const closes = Date.parse(s.closes_at);
  const step = 30 * 60_000;
  // Nairobi is UTC+3, a whole number of hours, so UTC half hours are Nairobi half hours.
  let t = Math.ceil((now.getTime() + step) / step) * step;
  const slots: PickupSlot[] = [];
  for (; t <= closes; t += step) {
    const at = new Date(t).toISOString();
    slots.push({ at, label: closingTime(at) === "midnight" ? "Midnight" : timeLabel(at) });
  }
  return slots;
}

/** The next moment the status changes by the clock alone: opening, the end of last orders, or closing. */
export function nextChange(s: KitchenStatus, now: Date): number | null {
  const candidates = [
    s.next_opens_at && Date.parse(s.next_opens_at),
    s.last_order_at && Date.parse(s.last_order_at) + 60_000,
    s.closes_at && Date.parse(s.closes_at),
    // The quiet "Last orders at …" line starts 30 minutes before.
    s.last_order_at && Date.parse(s.last_order_at) - 30 * 60_000,
  ].filter((t): t is number => typeof t === "number" && t > now.getTime());
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * The band's status (spec-2.8 "The band"): "Open now · last orders 20:30",
 * "Closed now · opens Friday 11:00", "Closed now · opens today 11:00".
 */
export function bandStatus(s: KitchenStatus): { lead: string; rest: string | null } {
  if (s.state === "open") return { lead: "Open now", rest: s.last_order_at ? `last orders ${closingTime(s.last_order_at)}` : null };
  if (!s.next_open_date || !s.next_opens_at) return { lead: "Closed for now", rest: null };
  const n = days(s.today, s.next_open_date);
  const day = n === 0 ? "today" : n < 7 ? weekdayName(s.next_open_date) : longDate(s.next_open_date);
  return { lead: "Closed now", rest: `opens ${day} ${timeLabel(s.next_opens_at)}` };
}

/** The rail's hours card: a bold first line and the line under it. */
export function hoursCard(s: KitchenStatus): { lead: string; rest: string | null } {
  if (s.state === "open")
    return {
      lead: s.closes_at ? `Open till ${closingTime(s.closes_at)}` : "Open now",
      rest: s.last_order_at ? `Last orders ${closingTime(s.last_order_at)}.` : null,
    };
  const when = opensWhen(s);
  return when ? { lead: "Closed now", rest: `Opens ${when}.` } : { lead: "Closed for now", rest: null };
}

/** The menu's day, as the database's menu_day(): today while open, else the next open day. */
export const menuDayOf = (s: KitchenStatus) => (s.state === "open" ? s.today : (s.next_open_date ?? s.today));
