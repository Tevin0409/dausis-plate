// Slice 2.8: the customer menu as sections, for the phone (jump bar) and the computer (rail).
// The database decides the day, the plates and sold out (customer_menu); this only orders and words it.
import type { Database, Enums } from "./database.types";
import { hhmm, weekdayName } from "./format";

export type CustomerMenuRow = Database["public"]["Functions"]["customer_menu"]["Returns"][number];
export type RegularDish = {
  id: string;
  name: string;
  description: string;
  price_kes: number;
  photo_thumb_url: string | null;
  category: Enums<"dish_category">;
  unavailable_on: string | null;
  sort_order: number;
};

export type MenuDish = {
  /** Unique on the page: the entry, or the dish for a regular. */
  key: string;
  dishId: string;
  entryId: string | null;
  kind: "day" | "week" | "regular";
  name: string;
  description: string;
  photo: string | null;
  priceKes: number;
  /** Plates per day, null when there is no limit. */
  limit: number | null;
  left: number | null;
  soldOut: boolean;
  /** "Served 12:00–15:00", or null when it is served all day. */
  hours: string | null;
  /** Open, but outside this dish's serving hours: spec 2.2's words for why it can't be added. */
  notNow: string | null;
  /** + adds (to the order, or to the saved order while closed). */
  canAdd: boolean;
  hasOptions: boolean;
};

export type MenuSection = { id: string; rail: string; head: string; aside: string | null; dishes: MenuDish[] };

export type MenuModel = {
  /** The menu's day, YYYY-MM-DD, and its weekday name. */
  day: string;
  dayName: string;
  isToday: boolean;
  open: boolean;
  sections: MenuSection[];
  /** The day's specials aren't planned yet. */
  notPlanned: { lead: string; rest: string } | null;
};

export const CATEGORY_ORDER: Enums<"dish_category">[] = ["mains", "breakfast", "sides", "drinks"];
export const CATEGORY_LABEL: Record<Enums<"dish_category">, string> = {
  mains: "Mains",
  breakfast: "Breakfast",
  sides: "Sides",
  drinks: "Drinks",
};

const allDay = (from: string, until: string) => hhmm(from) === "00:00" && hhmm(until) >= "23:59";

/** Sold-out dishes last, then the menu's own order (Mama's picks will go first once they exist). */
const ordered = <T extends { soldOut: boolean }>(list: { dish: T; sort: number }[]) =>
  list.sort((a, b) => Number(a.dish.soldOut) - Number(b.dish.soldOut) || a.sort - b.sort).map((x) => x.dish);

export function buildMenu(opts: {
  rows: CustomerMenuRow[];
  regulars: RegularDish[];
  optionDishIds: Set<string>;
  open: boolean;
  today: string;
  menuDay: string;
}): MenuModel {
  const { open, today, menuDay } = opts;
  const isToday = menuDay === today;
  const dayName = weekdayName(menuDay);

  const entry = (r: CustomerMenuRow): MenuDish => {
    const hours = allDay(r.show_from, r.show_until) ? null : `Served ${hhmm(r.show_from)}–${hhmm(r.show_until)}`;
    const notNow = open && !r.open_now && !r.sold_out ? `Orders open ${hhmm(r.show_from)}–${hhmm(r.show_until)}` : null;
    return {
      key: r.entry_id,
      dishId: r.dish_id,
      entryId: r.entry_id,
      kind: r.kind === "day" ? "day" : "week",
      name: r.name,
      description: r.description,
      photo: r.photo_thumb_url,
      priceKes: r.price_kes,
      limit: r.plates_per_day,
      left: r.plates_left,
      soldOut: r.sold_out,
      hours,
      notNow,
      canAdd: !r.sold_out && notNow === null,
      hasOptions: opts.optionDishIds.has(r.dish_id),
    };
  };
  const shown = opts.rows.filter((r) => !(r.sold_out && r.auto_hide_sold_out));
  const days = ordered(shown.filter((r) => r.kind === "day").map((r) => ({ dish: entry(r), sort: r.sort_order })));
  const weeks = ordered(shown.filter((r) => r.kind !== "day").map((r) => ({ dish: entry(r), sort: r.sort_order })));

  const sections: MenuSection[] = [];
  if (days.length > 0)
    sections.push({
      id: "today",
      rail: isToday ? "Today" : dayName,
      head: isToday ? "Today’s specials" : `${dayName}’s specials`,
      aside: open ? "Served till sold out" : `Plates for ${dayName}`,
      dishes: days,
    });
  if (weeks.length > 0) sections.push({ id: "week", rail: "This week", head: "This week", aside: null, dishes: weeks });

  for (const category of CATEGORY_ORDER) {
    const list = opts.regulars
      .filter((d) => d.category === category)
      .map((d) => {
        const soldOut = d.unavailable_on === menuDay;
        const dish: MenuDish = {
          key: d.id,
          dishId: d.id,
          entryId: null,
          kind: "regular",
          name: d.name,
          description: d.description,
          photo: d.photo_thumb_url,
          priceKes: d.price_kes,
          limit: null,
          left: null,
          soldOut,
          hours: null,
          notNow: null,
          canAdd: !soldOut,
          hasOptions: opts.optionDishIds.has(d.id),
        };
        return { dish, sort: d.sort_order };
      });
    if (list.length > 0)
      sections.push({ id: category, rail: CATEGORY_LABEL[category], head: CATEGORY_LABEL[category], aside: "Every day", dishes: ordered(list) });
  }

  const notPlanned =
    days.length > 0
      ? null
      : {
          lead: isToday ? "Today’s specials aren’t up yet." : `${dayName}’s specials aren’t up yet.`,
          rest: weeks.length > 0 ? "This week’s and everyday dishes are below." : "Everyday dishes are below.",
        };

  return { day: menuDay, dayName, isToday, open, sections, notPlanned };
}
