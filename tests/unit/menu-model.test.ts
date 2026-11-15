// Slice 2.8: the customer menu's sections.
import { describe, expect, test } from "bun:test";
import { buildMenu, type CustomerMenuRow, type RegularDish } from "@/lib/menu-model";

const row = (o: Partial<CustomerMenuRow>): CustomerMenuRow => ({
  menu_day: "2026-11-13", entry_id: "e1", kind: "day", starts_on: "2026-11-13", ends_on: "2026-11-13",
  show_from: "00:00:00", show_until: "23:59:59", sort_order: 0, dish_id: "d1", name: "Fish Curry", description: "",
  photo_key: null, category: "mains", price_kes: 650, plates_per_day: 30, plates_sold: 0, plates_left: 30,
  sold_out: false, open_now: true, auto_hide_sold_out: false, photo_url: null, photo_thumb_url: null,
  rating_avg: null, rating_count: 0, is_pick: false, ...o,
});
const reg = (o: Partial<RegularDish>): RegularDish => ({
  id: "r1", name: "Chapati", description: "", price_kes: 50, photo_thumb_url: null, category: "sides",
  unavailable_on: null, sort_order: 0, rating_count: 0, rating_total: 0, is_pick: false, ...o,
});
const base = { optionDishIds: new Set<string>(), open: true, today: "2026-11-13", menuDay: "2026-11-13" };

describe("buildMenu", () => {
  test("spec-2.10: each dish carries its public average from the 3rd rating, specials and regulars alike", () => {
    const m = buildMenu({
      ...base,
      rows: [row({ rating_avg: 4.3, rating_count: 3 }), row({ entry_id: "e2", dish_id: "d2", rating_avg: null, rating_count: 2 })],
      regulars: [reg({ rating_count: 3, rating_total: 13 }), reg({ id: "r2", rating_count: 2, rating_total: 10 })],
    });
    const all = m.sections.flatMap((x) => x.dishes);
    expect(all.map((d) => [d.key, d.ratingAvg, d.ratingCount])).toEqual([
      ["e1", 4.3, 3], ["e2", null, 2], ["r1", 4.3, 3], ["r2", null, 2],
    ]);
  });
  test("sections in menu order, with today's words", () => {
    const m = buildMenu({
      ...base,
      rows: [row({}), row({ entry_id: "w1", kind: "week", dish_id: "d2", name: "Pilau" })],
      regulars: [reg({}), reg({ id: "r2", category: "mains", name: "Beef Stew" }), reg({ id: "r3", category: "breakfast" })],
    });
    expect(m.sections.map((s) => s.id)).toEqual(["today", "week", "mains", "breakfast", "sides"]);
    expect(m.sections[0]).toMatchObject({ rail: "Today", head: "Today’s specials", aside: "Served till sold out" });
    expect(m.notPlanned).toBeNull();
  });
  test("closed names the day", () => {
    const m = buildMenu({ ...base, open: false, menuDay: "2026-11-14", rows: [row({ menu_day: "2026-11-14" })], regulars: [] });
    expect(m.dayName).toBe("Saturday");
    expect(m.sections[0]).toMatchObject({ rail: "Saturday", head: "Saturday’s specials", aside: "Plates for Saturday" });
    expect(m.sections[0]?.dishes[0]?.canAdd).toBe(true);
  });
  test("not planned, with and without week dishes", () => {
    const none = buildMenu({ ...base, open: false, menuDay: "2026-11-14", rows: [], regulars: [reg({})] });
    expect(none.notPlanned).toEqual({ lead: "Saturday’s specials aren’t up yet.", rest: "Everyday dishes are below." });
    expect(none.sections.map((s) => s.id)).toEqual(["sides"]);
    const week = buildMenu({ ...base, rows: [row({ kind: "week" })], regulars: [] });
    expect(week.notPlanned?.rest).toBe("This week’s and everyday dishes are below.");
    expect(week.notPlanned?.lead).toBe("Today’s specials aren’t up yet.");
  });
  test("sold out goes last; auto-hidden sold out goes", () => {
    const m = buildMenu({
      ...base,
      rows: [
        row({ entry_id: "a", sold_out: true, sort_order: 0 }),
        row({ entry_id: "b", sort_order: 5 }),
        row({ entry_id: "c", sold_out: true, auto_hide_sold_out: true }),
      ],
      regulars: [reg({ id: "x", unavailable_on: "2026-11-13" }), reg({ id: "y", sort_order: 9 })],
    });
    expect(m.sections[0]?.dishes.map((d) => d.key)).toEqual(["b", "a"]);
    expect(m.sections[1]?.dishes.map((d) => d.key)).toEqual(["y", "x"]);
    expect(m.sections[1]?.dishes[1]).toMatchObject({ soldOut: true, canAdd: false });
  });
  test("Mama's picks come first in their section, sold out still last", () => {
    const m = buildMenu({
      ...base,
      rows: [
        row({ entry_id: "a", sort_order: 0 }),
        row({ entry_id: "b", sort_order: 5, is_pick: true }),
        row({ entry_id: "c", sort_order: 1, is_pick: true, sold_out: true }),
      ],
      regulars: [reg({ id: "x", sort_order: 0 }), reg({ id: "y", sort_order: 9, is_pick: true })],
    });
    expect(m.sections[0]?.dishes.map((d) => d.key)).toEqual(["b", "a", "c"]);
    expect(m.sections[0]?.dishes.map((d) => d.pick)).toEqual([true, false, true]);
    expect(m.sections[1]?.dishes.map((d) => d.key)).toEqual(["y", "x"]);
  });
  test("outside serving hours while open: no add, with the hours", () => {
    const m = buildMenu({ ...base, rows: [row({ show_from: "12:00:00", show_until: "15:00:00", open_now: false })], regulars: [] });
    expect(m.sections[0]?.dishes[0]).toMatchObject({ canAdd: false, hours: "Served 12:00–15:00", notNow: "Orders open 12:00–15:00" });
  });
  test("closed, outside hours still adds to the saved order", () => {
    const m = buildMenu({ ...base, open: false, rows: [row({ show_from: "12:00:00", show_until: "15:00:00", open_now: false })], regulars: [] });
    expect(m.sections[0]?.dishes[0]?.canAdd).toBe(true);
  });
});
