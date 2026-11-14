// Best and Slowest dishes for the Dishes section (spec-2.12 "Dishes"). Pure, so it is unit tested.
import type { DishRow } from "./types";

/** A dish needs 3 days on the menu and a per-day figure to be ranked. */
export const rankable = (d: DishRow) => d.days_on >= 3 && d.per_day !== null;

const byName = (a: DishRow, b: DishRow) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Best: the 5 highest per day, equal scores by dish name (then id), so the order never depends on
 * the database. Slowest: up to 5 of the rest that sold less a day than every Best dish, lowest first.
 * A dish level with the last Best dish is left out of Slowest, so equal scores never sit on both sides.
 */
export function rankDishes(dishes: DishRow[]): { ranked: DishRow[]; best: DishRow[]; slow: DishRow[] } {
  const ranked = dishes.filter(rankable).sort((a, b) => b.per_day! - a.per_day! || byName(a, b));
  const best = ranked.slice(0, 5);
  const cut = best.at(-1)?.per_day ?? Infinity;
  const slow = ranked
    .slice(best.length)
    .filter((r) => r.per_day! < cut)
    .slice(-5)
    .sort((a, b) => a.per_day! - b.per_day! || byName(a, b));
  return { ranked, best, slow };
}
