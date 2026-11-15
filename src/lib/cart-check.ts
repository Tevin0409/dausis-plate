// Slice 2.8: the saved cart against the menu day (check_cart). Pure, so the provider stays thin.
import { cartLineKey, type CartExtra, type ComboPart } from "./cart-lines";
import { loweredAnnounce, soldOutAnnounce } from "./menu-words";

export type LineState = "ok" | "capped" | "sold_out" | "not_on_menu" | "not_now" | "option_out" | "combo_off" | "combo_parts";

/** One line of check_cart's answer. */
export type CheckResult = {
  key: string;
  state: LineState;
  quantity: number;
  menu_entry_id: string | null;
  unit_price_kes: number | null;
  plates_left: number | null;
  /** 2.11: a combo line's answer has its dishes' entries and plates left. */
  kind?: "combo";
  parts?: { dish_id: string; state: LineState; menu_entry_id: string | null; plates_left: number | null }[];
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
  kind?: "combo";
  comboId?: string;
  parts?: ComboPart[];
};

export const MAX_PER_LINE = 20;

/** Lines that are in the total and the plate count. */
export const isCounted = (c: LineCheck | undefined) => !c || c.state === "ok" || c.state === "capped";

/** check_cart's input. */
export const checkPayload = (lines: CheckableLine[]) =>
  lines.map((l) => {
    const quantity = Math.min(Math.max(l.quantity, 1), MAX_PER_LINE);
    if (l.kind === "combo" && l.comboId && l.parts)
      return { key: l.key, combo_id: l.comboId, quantity, parts: comboParts(l.parts) };
    return {
      key: l.key,
      dish_id: l.dishId,
      menu_entry_id: l.menuEntryId,
      option_id: l.optionId,
      extra_ids: l.extras.map((e) => e.id),
      quantity,
    };
  });

/** A combo's dishes as check_cart and place_order take them. */
export const comboParts = (parts: ComboPart[]) =>
  parts.map((p) => ({ dish_id: p.dishId, menu_entry_id: p.menuEntryId, option_id: p.optionId, extra_ids: p.extras.map((e) => e.id), quantity: p.per }));

/** Plates of a menu entry a line holds: its own, or its combo dishes' (each combo takes `per` of a dish). */
export const entryUse = (l: CheckableLine, menuEntryId: string) =>
  l.menuEntryId === menuEntryId
    ? l.quantity
    : (l.parts ?? []).reduce((n, p) => n + (p.menuEntryId === menuEntryId ? p.per * l.quantity : 0), 0);

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
      // A combo's dishes can move to another entry of the same dish, like a dish line.
      let parts = line.parts;
      if (line.parts && r.parts) {
        const rp = r.parts;
        parts = line.parts.map((p) => {
          const found = rp.find((x) => x.dish_id === p.dishId);
          const entry = found?.menu_entry_id ?? p.menuEntryId;
          if (found && entry) entryLeft[entry] = found.plates_left;
          return entry === p.menuEntryId ? p : { ...p, menuEntryId: entry };
        });
      }
      if (r.state === "capped" && r.quantity < line.quantity) {
        quantity = r.quantity;
        lowered = quantity;
        changed = true;
        announce.push(loweredAnnounce(line.name, quantity));
      }
      // A new price changes the total too: at Place order that counts as a change (nobody pays an
      // amount they haven't seen).
      if (unitPriceKes !== line.unitPriceKes) changed = true;
      if (line.kind === "combo") {
        if (parts !== line.parts || unitPriceKes !== line.unitPriceKes || quantity !== line.quantity) next = { ...line, parts, unitPriceKes, quantity };
      } else if (menuEntryId !== line.menuEntryId || unitPriceKes !== line.unitPriceKes || quantity !== line.quantity) {
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
 * counted lines of that entry hold (combo dishes included), and never over 20. A combo line takes
 * the tightest of its dishes, in whole combos.
 */
export function lineCap<L extends CheckableLine>(
  lines: L[],
  checks: Record<string, LineCheck>,
  entryLeft: Record<string, number | null>,
  key: string,
): number {
  const line = lines.find((l) => l.key === key);
  if (!line) return MAX_PER_LINE;
  const others = (entry: string) =>
    lines.filter((l) => l.key !== key && isCounted(checks[l.key])).reduce((n, l) => n + entryUse(l, entry), 0);
  const uses = line.kind === "combo" ? (line.parts ?? []).map((p) => ({ entry: p.menuEntryId, per: p.per })) : [{ entry: line.menuEntryId, per: 1 }];
  let cap = MAX_PER_LINE;
  for (const u of uses) {
    if (!u.entry) continue;
    const left = entryLeft[u.entry];
    if (left == null) continue;
    cap = Math.min(cap, Math.floor((left - others(u.entry)) / u.per));
  }
  return Math.max(0, cap);
}

/** Plates of an entry already in the order (counted lines only, combo dishes included). */
export const inOrder = <L extends CheckableLine>(lines: L[], checks: Record<string, LineCheck>, menuEntryId: string) =>
  lines.filter((l) => isCounted(checks[l.key])).reduce((n, l) => n + entryUse(l, menuEntryId), 0);
