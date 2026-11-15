// Slice 2.4: the order board's rules as plain functions (spec-2.4-order-board.md), so the server
// page, the client parts and the unit tests share one copy.
import type { Enums } from "@/lib/database.types";
import { addDays, nairobiToday, timeLabel } from "@/lib/format";

export type Status = Enums<"order_status">;
export type Mode = Enums<"order_mode">;
export type CancelReason = Enums<"cancel_reason">;

/** The board's column titles. The History and the strip use them too. */
export const TITLES: Record<Status, string> = {
  new: "New",
  preparing: "Cooking",
  ready: "Ready",
  on_the_way: "On the way",
  completed: "Done",
  cancelled: "Cancelled",
};

export const OPEN: Status[] = ["new", "preparing", "ready", "on_the_way"];

/** An order's age turns amber at this many minutes (Tevin, 2026-11-05). */
export const AMBER_AFTER_MIN = 15;
/** A booked pickup sorts, and turns amber if it isn't Ready, this long before its time (Q1 B). */
export const PICKUP_LEAD_MIN = 15;
/**
 * A booked pickup that is Ready turns amber this long after its time: dev.designer's reading of
 * Q1 B, built as written (orch.lead, 2026-11-07 22:40Z). A different answer changes only this.
 */
export const READY_PICKUP_AMBER_AFTER_MIN = 15;

/** The Undo on a move or on Mark paid shows for this long. The server allows 10 s. */
export const UNDO_MS = 5_000;

const MIN = 60_000;

type Timed = { status: Status; mode: Mode; created_at: string; pickup_at: string | null };

const booked = (o: Timed) => o.mode === "pickup" && o.pickup_at !== null;

/** What a column sorts by: when placed, or a booked pickup's time less 15 min in Cooking and Ready. */
export function sortTime(o: Timed): number {
  if (booked(o) && (o.status === "preparing" || o.status === "ready")) return Date.parse(o.pickup_at!) - PICKUP_LEAD_MIN * MIN;
  return Date.parse(o.created_at);
}

/** Oldest first, by sortTime; ties by placed time. */
export function sortColumn<T extends Timed>(list: T[]): T[] {
  return [...list].sort((a, b) => sortTime(a) - sortTime(b) || Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** "4 min", "1 h 05". */
export function duration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}`;
}

const weekdayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short" }).format(new Date(iso));

export type Age = { text: string; amber: boolean };

/** The age slot on a ticket (spec "Age"). `now` is the server's clock at render. */
export function ageOf(o: Timed, now: Date): Age {
  const done = o.status === "completed" || o.status === "cancelled";
  if (booked(o) && (o.status === "preparing" || o.status === "ready")) {
    const msToGo = Date.parse(o.pickup_at!) - now.getTime();
    const toGo = Math.round(msToGo / MIN);
    const text = toGo > 0 ? `Due in ${duration(toGo)}` : toGo === 0 ? "Due now" : `Due ${duration(-toGo)} ago`;
    // Amber compares the exact time, not the rounded minutes shown (QA RQA24-06).
    const amber = o.status === "preparing" ? msToGo <= PICKUP_LEAD_MIN * MIN : -msToGo >= READY_PICKUP_AMBER_AFTER_MIN * MIN;
    return { text, amber };
  }
  const today = nairobiToday(now);
  const placedDay = nairobiToday(new Date(o.created_at));
  if (placedDay < today) {
    const day = placedDay === addDays(today, -1) ? "yesterday" : weekdayShort(o.created_at);
    return { text: `Since ${day} ${timeLabel(o.created_at)}`, amber: !done };
  }
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(o.created_at)) / MIN));
  return { text: mins < 1 ? "Just now" : duration(mins), amber: !done && mins >= AMBER_AFTER_MIN };
}

/** The main action on a ticket: its label, pending label and the status it moves to. */
export function mainAction(status: Status, mode: Mode): { label: string; pending: string; to: Status } | null {
  switch (status) {
    case "new":
      return { label: "Accept", pending: "Accepting…", to: "preparing" };
    case "preparing":
      return { label: "Mark ready", pending: "Marking ready…", to: "ready" };
    case "ready":
      if (mode === "delivery") return { label: "On the way", pending: "Saving…", to: "on_the_way" };
      return { label: mode === "pickup" ? "Collected" : "Served", pending: "Saving…", to: "completed" };
    case "on_the_way":
      return { label: "Delivered", pending: "Saving…", to: "completed" };
    default:
      return null;
  }
}

/** The status a move from `from` goes to, for that order type; null if there is no move. */
export const nextStatus = (from: Status, mode: Mode) => mainAction(from, mode)?.to ?? null;

/** The neutral type tag: "Dine-in · Table 4", "Pickup · 13:30", "Delivery · Kilimani". */
export function typeTag(o: { mode: Mode; pickup_at: string | null; table: string | null; zone: string | null }): string {
  if (o.mode === "dine_in") return `Dine-in · ${o.table ?? "Table"}`;
  if (o.mode === "pickup") return `Pickup · ${o.pickup_at ? timeLabel(o.pickup_at) : "As soon as ready"}`;
  return `Delivery · ${o.zone ?? "Area not set"}`;
}

export const REASONS: { id: CancelReason; label: string }[] = [
  { id: "sold_out", label: "Sold out" },
  { id: "too_busy", label: "Kitchen is too busy right now" },
  { id: "cant_deliver", label: "We can’t deliver to that area" },
  { id: "customer_asked", label: "Customer asked to cancel" },
  { id: "no_show", label: "Customer didn’t come" },
  { id: "other", label: "Other" },
];

/** The reasons offered for an order, in the spec's order; the database checks the same rules. */
export function reasonsFor(status: Status, mode: Mode) {
  return REASONS.filter(
    (r) =>
      (r.id !== "cant_deliver" || mode === "delivery") &&
      (r.id !== "no_show" || (mode !== "dine_in" && (status === "ready" || status === "on_the_way"))),
  );
}

/** The short reason for the History. */
export const REASON_LABEL: Record<CancelReason, string> = {
  sold_out: "Sold out",
  too_busy: "Kitchen too busy",
  cant_deliver: "Can’t deliver to that area",
  customer_asked: "Customer asked",
  no_show: "Customer didn’t come",
  other: "Other",
};

export const NOTE_MIN = 3;
export const NOTE_MAX = 120;

/** What the customer's page says for a declined or cancelled order. */
export function customerCancelText(o: { reason: CancelReason | null; note: string | null; declined: boolean }): string | null {
  switch (o.reason) {
    case "sold_out":
      return "Sorry, a dish in your order sold out.";
    case "too_busy":
      return "Sorry, the kitchen is too busy right now.";
    case "cant_deliver":
      return "Sorry, we can’t deliver to that area.";
    case "other":
      return o.note ? `Mama’s kitchen says: “${o.note}”` : null;
    case "customer_asked":
      return o.declined ? null : "Cancelled as you asked.";
    case "no_show":
      return o.declined ? null : "We waited, but nobody came for it.";
    default:
      return null;
  }
}

/** Ids the board hasn't seen before; the chime plays once for any. Also adds them to `seen`. */
export function newIds(seen: Set<string>, ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !seen.has(id));
  for (const id of fresh) seen.add(id);
  return fresh;
}

/** Done's rows: unpaid first, then the rest, each newest first by when they were done. */
export function doneRows<T extends { payment_status: string; status_changed_at: string }>(list: T[]): T[] {
  const newest = (a: T, b: T) => Date.parse(b.status_changed_at) - Date.parse(a.status_changed_at);
  return [...list.filter((o) => o.payment_status !== "paid").sort(newest), ...list.filter((o) => o.payment_status === "paid").sort(newest)];
}

/** Done shows this many rows, then "Show all N". */
export const DONE_ROWS = 8;

/** The freshness line turns amber when the page is this old. */
export const STALE_AFTER_MS = 75_000;

/** "0712 345 678" for a Kenyan mobile number (stored as 07…, 254… or +254…); anything else as stored. */
export function phoneLabel(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("254") ? `0${d.slice(3)}` : d;
  return local.length === 10 && local.startsWith("0") ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : phone;
}

/** The views: phone has all five, the tablet's right side has four (New is always on the left). */
export const PHONE_VIEWS: Status[] = ["new", "preparing", "ready", "on_the_way", "completed"];
export const TABLET_VIEWS: Status[] = ["preparing", "ready", "on_the_way", "completed"];
export const phoneView = (v: string | null): Status => (PHONE_VIEWS.find((s) => s === v) ?? "new");
export const tabletView = (v: string | null): Status => (TABLET_VIEWS.find((s) => s === v) ?? "preparing");

/** The column heads' colours (DESIGN.md "Column heads"), shared by the view buttons. */
export const HEAD: Record<Status, string> = {
  new: "bg-blush text-coral-ink",
  preparing: "bg-amber-tint text-amber-ink",
  ready: "bg-teal-tint text-teal-deeper",
  on_the_way: "bg-sand text-ink",
  completed: "bg-paper text-ink ring-1 ring-sand-deep ring-inset",
  cancelled: "bg-paper text-ink-soft",
};
