import { describe, expect, test } from "bun:test";
import { rankDishes } from "@/lib/reports/rank";
import type { DishRow } from "@/lib/reports/types";

const dish = (id: string, name: string, per_day: number | null, days_on = 5): DishRow => ({
  id, name, per_day, days_on, is_regular: false, plates: 0, revenue: 0,
  limit_days: null, limit_used_avg: null, limit_avg: null, sold_out_days: 0, usual_sold_out_minutes: null, rating_avg: null, rating_count: 0,
});
const names = (r: DishRow[]) => r.map((d) => d.name);

describe("rankDishes (RQA212-04)", () => {
  // QA's month: 8 ranked dishes, four of them level at 1.6 across the Best cut.
  const month = [
    dish("1", "Pilau", 3), dish("2", "Matoke", 2.4), dish("3", "Githeri", 2), dish("4", "Ugali", 1.6),
    dish("5", "Beef Stew & Chapati", 1.6), dish("6", "Biryani", 1.6), dish("7", "Chapati (2)", 1.6), dish("8", "Mukimo", 1),
  ];

  test("equal scores never sit in both lists; Best breaks ties by name", () => {
    const { best, slow } = rankDishes(month);
    expect(names(best)).toEqual(["Pilau", "Matoke", "Githeri", "Beef Stew & Chapati", "Biryani"]);
    expect(names(slow)).toEqual(["Mukimo"]);
    const cut = best.at(-1)!.per_day!;
    for (const s of slow) expect(s.per_day!).toBeLessThan(cut);
    expect(best.filter((b) => slow.includes(b))).toEqual([]);
  });

  test("the result doesn't depend on the order the rows arrive in", () => {
    const a = rankDishes(month);
    const b = rankDishes([...month].reverse());
    expect(names(b.best)).toEqual(names(a.best));
    expect(names(b.slow)).toEqual(names(a.slow));
  });

  test("Slowest is lowest first, at most 5, ties by name; unrankable dishes are left out", () => {
    const many = [
      ...["A", "B", "C", "D", "E"].map((n, i) => dish(`b${i}`, n, 10)),
      dish("s1", "Zed", 1), dish("s2", "Abe", 1), dish("s3", "Mid", 2), dish("s4", "Low", 0.5),
      dish("s5", "Five", 3), dish("s6", "Six", 4), dish("x1", "New dish", 9, 2), dish("x2", "No figure", null),
    ];
    const { best, slow } = rankDishes(many);
    expect(names(best)).toEqual(["A", "B", "C", "D", "E"]);
    expect(names(slow)).toEqual(["Low", "Abe", "Zed", "Mid", "Five"]);
  });

  test("all level: Best fills, Slowest is empty", () => {
    const level = ["F", "E", "D", "C", "B", "A", "G"].map((n, i) => dish(String(i), n, 2));
    const { best, slow } = rankDishes(level);
    expect(names(best)).toEqual(["A", "B", "C", "D", "E"]);
    expect(slow).toEqual([]);
  });
});
