// Slice 2.8: the saved cart against the menu day (check_cart). Pure, so the provider stays thin.
import { cartLineKey, type CartExtra } from "./cart-lines";
import { loweredAnnounce, soldOutAnnounce } from "./menu-words";

export type LineState = "ok" | "capped" | "sold_out" | "not_on_menu" | "not_now" | "option_out";

/** One line of check_cart's answer. */
export type CheckResult = {
  key: string;
  state: LineState;
  quantity: number;
  menu_entry_id: string | null;
  unit_price_kes: number | null;
  plates_left: number | null;
};

/** What the last check said about a line. `lowered` stays until the customer changes the line. */
export type LineCheck = { state: LineState; lowered: number | null };

export type CheckableLine = {
  key: string;
  dishId: string;
  menuEntryId: string | null;
  optionId: string | null;
  extras: CartExtra[];
  note: string;
  name: string;
  quantity: number;
  unitPriceKes: number;
};

export const MAX_PER_LINE = 20;

/** Lines that are in the total and the plate count. */
export const isCounted = (c: LineCheck | undefined) => !c || c.state === "ok" || c.state === "capped";

/** check_cart's input. */
export const checkPayload = (lines: CheckableLine[]) =>
  lines.map((l) => ({
    key: l.key,
    dish_id: l.dishId,
    menu_entry_id: l.menuEntryId,
    option_id: l.optionId,
    extra_ids: l.extras.map((e) => e.id),
    quantity: Math.min(Math.max(l.quantity, 1), MAX_PER_LINE),
  }));

/**
 * Applies a check. Lines keep the customer's amount when they drop out of the total, so a dish
 * that comes back is whole again. A line that moved to another entry of its dish is re-keyed and
 * merged with a line it now matches. Returns what to announce, in line order.
 */
export function applyCheck<L extends CheckableLine>(
  lines: L[],
  checks: Record<string, LineCheck>,
  results: CheckResult[],
): { lines: L[]; checks: Record<string, LineCheck>; entryLeft: Record<string, number | null>; announce: string[]; changed: boolean } {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const out: L[] = [];
  const outChecks: Record<string, LineCheck> = {};
  const entryLeft: Record<string, number | null> = {};
  const announce: string[] = [];
  let changed = false;

  for (const line of lines) {
    const r = byKey.get(line.key);
    const prev = checks[line.key];
    if (!r) {
      out.push(line);
      if (prev) outChecks[line.key] = prev;
      continue;
    }
    let next: L = line;
    let lowered = prev?.lowered ?? null;
    const counted = r.state === "ok" || r.state === "capped";
    if (counted) {
      const menuEntryId = r.menu_entry_id ?? line.menuEntryId;
      const unitPriceKes = r.unit_price_kes ?? line.unitPriceKes;
      let quantity = line.quantity;
      if (r.state === "capped" && r.quantity < line.quantity) {
        quantity = r.quantity;
        lowered = quantity;
        changed = true;
        announce.push(loweredAnnounce(line.name, quantity));
      }
      // A new price changes the total too: at Place order that counts as a change (nobody pays an
      // amount they haven't seen).
      if (unitPriceKes !== line.unitPriceKes) changed = true;
      if (menuEntryId !== line.menuEntryId || unitPriceKes !== line.unitPriceKes || quantity !== line.quantity) {
        next = { ...line, menuEntryId, unitPriceKes, quantity, key: cartLineKey({ ...line, menuEntryId }) };
      }
      if (menuEntryId) entryLeft[menuEntryId] = r.plates_left;
    } else {
      lowered = null;
      if (isCounted(prev)) {
        changed = true;
        if (r.state === "sold_out") announce.push(soldOutAnnounce(line.name));
      }
    }
    const check: LineCheck = { state: r.state, lowered };
    const twin = out.findIndex((l) => l.key === next.key);
    const held = out[twin];
    if (held) {
      out[twin] = { ...held, quantity: Math.min(MAX_PER_LINE, held.quantity + next.quantity) };
      continue;
    }
    out.push(next);
    outChecks[next.key] = check;
  }
  return { lines: out, checks: outChecks, entryLeft, announce, changed };
}

/**
 * The most this line can hold: the plates left for its entry less what the order's other
 * counted lines of that entry hold, and never over 20.
 */
export function lineCap<L extends CheckableLine>(
  lines: L[],
  checks: Record<string, LineCheck>,
  entryLeft: Record<string, number | null>,
  key: string,
): number {
  const line = lines.find((l) => l.key === key);
  if (!line?.menuEntryId) return MAX_PER_LINE;
  const left = entryLeft[line.menuEntryId];
  if (left == null) return MAX_PER_LINE;
  const others = lines
    .filter((l) => l.key !== key && l.menuEntryId === line.menuEntryId && isCounted(checks[l.key]))
    .reduce((n, l) => n + l.quantity, 0);
  return Math.max(0, Math.min(MAX_PER_LINE, left - others));
}

/** Plates of an entry already in the order (counted lines only). */
export const inOrder = <L extends CheckableLine>(lines: L[], checks: Record<string, LineCheck>, menuEntryId: string) =>
  lines.filter((l) => l.menuEntryId === menuEntryId && isCounted(checks[l.key])).reduce((n, l) => n + l.quantity, 0);
