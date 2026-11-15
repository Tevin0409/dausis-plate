// Slice 2.8: the customer menu's wording, in one place (spec-2.8-menu-on-a-computer.md).
// `day` is the weekday name of the menu day ("Friday") when the kitchen is closed.
import { formatKes } from "./format";

/** "1 plate", "7 plates". Never "1 plates" (break-ui fix 3). */
export const plates = (n: number) => `${n} ${n === 1 ? "plate" : "plates"}`;

export type PillTone = "teal" | "amber" | "sand" | "blush";

/** Mama's pick (spec 2.11 A, DESIGN.md "Pills"): the only mark a dish gets. */
export const pickPill: Pill = { text: "Mama’s pick", tone: "blush" };
export type Pill = { text: string; tone: PillTone };

/**
 * The plates pill on a tile, row or dish page. Null when the dish has no plate limit.
 * Open: the plates left today. Closed: the fresh count for the menu day.
 */
export function platesPill(opts: {
  open: boolean;
  limit: number | null;
  left: number | null;
  soldOut: boolean;
  day: string;
}): Pill | null {
  if (opts.open && opts.soldOut) return { text: "Sold out today", tone: "sand" };
  if (opts.limit == null) return null;
  if (!opts.open) return { text: `${plates(opts.limit)} for ${opts.day}`, tone: "teal" };
  const left = opts.left ?? opts.limit;
  if (left <= 0) return { text: "Sold out today", tone: "sand" };
  if (left === 1) return { text: "Last plate", tone: "amber" };
  return { text: `${plates(left)} left`, tone: left > 10 ? "teal" : "amber" };
}

/** The amber note under a cart line that is at its cap. */
export function capNote(opts: { open: boolean; cap: number; day: string }): string {
  if (!opts.open) return `That’s all ${plates(opts.cap)} for ${opts.day}.`;
  return opts.cap === 1 ? "That’s the only plate left." : `That’s all ${plates(opts.cap)} left.`;
}

/** Recheck notes under a cart line. */
export const loweredNote = (n: number) => `Only ${plates(n)} left, so we changed this to ${n}.`;
export const soldOutNote = "Sold out, so it’s not in your total.";
export const notOnMenuPill = (day: string) => `Not on ${day}’s menu`;
export const notOnMenuNote = "Not in your total. Keep it for another day, or remove it.";

/** Polite live-region text. */
export const soldOutAnnounce = (name: string) => `${name} has sold out.`;
export const loweredAnnounce = (name: string, n: number) =>
  `${name}: only ${plates(n)} left, changed to ${n}.`;
export const addedAnnounce = (name: string, count: number, subtotal: number) =>
  `${name} added. ${plates(count)}, ${formatKes(subtotal)}.`;

/** The menu's add button: its label, or why it is off. */
export function addLabel(opts: {
  name: string;
  open: boolean;
  hasOptions: boolean;
  allInOrder: boolean;
  left: number | null;
}): { label: string; disabled: boolean; title?: string } {
  if (opts.hasOptions) return { label: `Choose options for ${opts.name}`, disabled: false };
  if (opts.allInOrder) {
    const label =
      opts.left === 1
        ? `The last plate of ${opts.name} is in your order`
        : `All ${plates(opts.left ?? 0)} of ${opts.name} are in your order`;
    return { label, disabled: true, title: "That’s every plate left" };
  }
  if (!opts.open) return { label: `Add ${opts.name} to your saved order`, disabled: false };
  return { label: `Add ${opts.name} to your order`, disabled: false };
}

/** Dish page: the hint under the buy row. */
export function buyHint(opts: {
  open: boolean;
  limit: number | null;
  left: number | null;
  inOrder: number;
  day: string;
}): string | null {
  let base: string | null = null;
  if (opts.limit != null) {
    if (!opts.open) base = `${plates(opts.limit)} for ${opts.day}.`;
    else if ((opts.left ?? 0) === 1) base = "The last plate today.";
    else base = `${plates(opts.left ?? opts.limit)} left today.`;
  }
  const already = opts.inOrder > 0 ? `${opts.inOrder} already in your order.` : null;
  if (base && already) return `${base} ${already}`;
  return base ?? already;
}

/** Dish page: why it can't be added, by the spec's priority. Null when it can. */
export function cantAddReason(opts: {
  open: boolean;
  soldOut: boolean;
  onMenuDay: boolean;
  hoursText: string | null;
  allInOrder: boolean;
  left: number | null;
  day: string;
}): string | null {
  if (opts.soldOut) return "Sold out today";
  // Open, `day` is "today": "Not on today’s menu".
  if (!opts.onMenuDay) return notOnMenuPill(opts.day);
  if (opts.hoursText) return opts.hoursText;
  if (opts.allInOrder)
    return opts.left === 1
      ? "The last plate is in your order"
      : `All ${plates(opts.left ?? 0)} are in your order`;
  return null;
}

/** Dish page main button. */
export const buyButton = (open: boolean, total: number) =>
  `${open ? "Add to order" : "Save to order"} · ${formatKes(total)}`;
