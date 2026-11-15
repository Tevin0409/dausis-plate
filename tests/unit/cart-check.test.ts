// Slice 2.8: the cart recheck and the table at closing.
import { describe, expect, test } from "bun:test";
import { applyCheck, checkPayload, inOrder, isCounted, lineCap, type CheckResult } from "@/lib/cart-check";
import { cartLineKey } from "@/lib/cart-lines";
import type { KitchenStatus } from "@/lib/kitchen";
import { tableExpired } from "@/lib/table-cookie";

const mk = (dishId: string, entry: string | null, quantity: number, name = dishId) => {
  const l = { dishId, menuEntryId: entry, optionId: null, extras: [], note: "", name, quantity, unitPriceKes: 500 };
  return { ...l, key: cartLineKey(l) };
};
const res = (key: string, state: CheckResult["state"], o: Partial<CheckResult> = {}): CheckResult => ({
  key, state, quantity: 0, menu_entry_id: null, unit_price_kes: null, plates_left: null, ...o,
});

describe("applyCheck", () => {
  test("ok keeps the line and records plates left", () => {
    const a = mk("fish", "e1", 2);
    const r = applyCheck([a], {}, [res(a.key, "ok", { quantity: 2, menu_entry_id: "e1", unit_price_kes: 500, plates_left: 7 })]);
    expect(r.lines[0]?.unitPriceKes).toBe(500);
    expect(r.entryLeft).toEqual({ e1: 7 });
    expect(r.changed).toBe(false);
    expect(r.announce).toEqual([]);
  });
  test("a new price takes the database's and counts as a change", () => {
    const a = mk("fish", "e1", 2);
    const r = applyCheck([a], {}, [res(a.key, "ok", { quantity: 2, menu_entry_id: "e1", unit_price_kes: 650, plates_left: 7 })]);
    expect(r.lines[0]?.unitPriceKes).toBe(650);
    expect(r.changed).toBe(true);
  });
  test("capped lowers the amount, notes and announces it", () => {
    const a = mk("fish", "e1", 2, "Fish Curry");
    const r = applyCheck([a], {}, [res(a.key, "capped", { quantity: 1, menu_entry_id: "e1", unit_price_kes: 500, plates_left: 1 })]);
    expect(r.lines[0]?.quantity).toBe(1);
    expect(r.checks[a.key]).toEqual({ state: "capped", lowered: 1 });
    expect(r.announce).toEqual(["Fish Curry: only 1 plate left, changed to 1."]);
    expect(r.changed).toBe(true);
  });
  test("the lowered note survives a later ok check", () => {
    const a = { ...mk("fish", "e1", 1), key: "" };
    a.key = cartLineKey(a);
    const r = applyCheck([a], { [a.key]: { state: "capped", lowered: 1 } }, [res(a.key, "ok", { quantity: 1, menu_entry_id: "e1", unit_price_kes: 500 })]);
    expect(r.checks[a.key]?.lowered).toBe(1);
  });
  test("sold out keeps the amount, leaves the count, announces once", () => {
    const a = mk("fish", "e1", 2, "Fish Curry");
    const first = applyCheck([a], {}, [res(a.key, "sold_out")]);
    expect(first.lines[0]?.quantity).toBe(2);
    expect(isCounted(first.checks[a.key])).toBe(false);
    expect(first.announce).toEqual(["Fish Curry has sold out."]);
    const again = applyCheck(first.lines, first.checks, [res(a.key, "sold_out")]);
    expect(again.announce).toEqual([]);
    expect(again.changed).toBe(false);
  });
  test("not on the menu is a change, not announced as sold out", () => {
    const a = mk("fish", "e1", 1);
    const r = applyCheck([a], {}, [res(a.key, "not_on_menu")]);
    expect(r.changed).toBe(true);
    expect(r.announce).toEqual([]);
  });
  test("a line moved to the dish's new entry is re-keyed and merged with its twin", () => {
    const old = mk("fish", "e-old", 2);
    const cur = mk("fish", "e-new", 1);
    const r = applyCheck([cur, old], {}, [
      res(cur.key, "ok", { quantity: 1, menu_entry_id: "e-new", unit_price_kes: 500 }),
      res(old.key, "ok", { quantity: 2, menu_entry_id: "e-new", unit_price_kes: 500 }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.quantity).toBe(3);
    expect(r.lines[0]?.key).toBe(cur.key);
  });
  test("lines without a result are left alone", () => {
    const a = mk("fish", "e1", 1);
    expect(applyCheck([a], {}, []).lines).toEqual([a]);
  });
});

describe("caps", () => {
  test("lines of one entry share the plates left", () => {
    const a = mk("fish", "e1", 2);
    const b = { ...mk("fish", "e1", 1), note: "no onions" };
    b.key = cartLineKey(b);
    const lines = [a, b];
    expect(lineCap(lines, {}, { e1: 5 }, a.key)).toBe(4);
    expect(lineCap(lines, {}, { e1: 5 }, b.key)).toBe(3);
    expect(lineCap(lines, { [b.key]: { state: "sold_out", lowered: null } }, { e1: 5 }, a.key)).toBe(5);
    expect(inOrder(lines, {}, "e1")).toBe(3);
  });
  test("no limit means 20", () => {
    const a = mk("chapati", null, 1);
    expect(lineCap([a], {}, {}, a.key)).toBe(20);
  });
  test("payload", () => {
    const a = mk("fish", "e1", 25);
    expect(checkPayload([a])[0]).toEqual({ key: a.key, dish_id: "fish", menu_entry_id: "e1", option_id: null, extra_ids: [], quantity: 20 });
  });
});

const status = (o: Partial<KitchenStatus>): KitchenStatus => ({
  state: "open", reason: null, today: "2026-11-13", last_orders_minutes: 30,
  opens_at: "2026-11-13T08:00:00Z", last_order_at: "2026-11-13T17:30:00Z", closes_at: "2026-11-13T18:00:00Z",
  closed_early_at: null, next_open_date: "2026-11-13", next_opens_at: "2026-11-13T08:00:00Z",
  after_today_open_date: "2026-11-14", after_today_opens_at: "2026-11-14T08:00:00Z", ...o,
});

describe("tableExpired", () => {
  const lunch = "2026-11-13T10:00:00Z";
  test("open keeps it", () => expect(tableExpired(lunch, status({}))).toBe(false));
  test("past last orders keeps it", () =>
    expect(tableExpired(lunch, status({ state: "closed", reason: "past_last_orders" }))).toBe(false));
  test("after closing drops a table scanned before closing", () =>
    expect(tableExpired(lunch, status({ state: "closed", reason: "after_closing" }))).toBe(true));
  test("after closing keeps a table scanned after closing", () =>
    expect(tableExpired("2026-11-13T18:30:00Z", status({ state: "closed", reason: "after_closing" }))).toBe(false));
  test("an early close counts from the early time", () =>
    expect(tableExpired(lunch, status({ state: "closed", reason: "closed_early", closed_early_at: "2026-11-13T09:00:00Z" }))).toBe(false));
  test("scanned on an earlier day is gone, even before opening", () =>
    expect(tableExpired("2026-11-12T17:00:00Z", status({ state: "closed", reason: "before_opening" }))).toBe(true));
  test("an old cookie without a time goes once closed for the day", () => {
    expect(tableExpired(undefined, status({ state: "closed", reason: "after_closing" }))).toBe(true);
    expect(tableExpired(undefined, status({}))).toBe(false);
  });
});
