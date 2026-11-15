// Slice 2.5: what the menu page hands the planner (spec-2.5-menu-planner.md). Plain data, read on
// the server, so the client components never query the week themselves.

import type { Hours } from "@/lib/planner";

export type PlannerEntry = {
  id: string;
  kind: "day" | "week";
  dishId: string;
  name: string;
  photo: string | null;
  usualPrice: number;
  /** A one-day (or one-week) price, or null for the dish's usual price. */
  price: number | null;
  plates: number | null;
  from: string;
  until: string;
  startsOn: string;
  endsOn: string;
  /** A week dish's days off inside its range. */
  off: string[];
  /** Today's sales, when it's on today. */
  today: { sold: number; manual: boolean } | null;
};

export type PlannerDay = {
  day: string;
  /** Opening hours that weekday, or null when it's a weekly closed day. */
  hours: Hours;
  /** A closed date's note ("" for none), or null when it isn't a closed date. */
  closedNote: string | null;
  /** How many dishes each copy button would copy (0: the button is left out). */
  copy: { prev: number; lastWeek: number };
};

export type PlannerData = {
  today: string;
  monday: string;
  days: PlannerDay[];
  entries: PlannerEntry[];
  /** The owner, or staff with Dishes and prices. */
  prices: boolean;
  /** Plan tomorrow: the next open day and how many dishes it has (current week only). */
  next: { day: string; count: number } | null;
};

/** Is the entry live on that day (inside its range, not a day off)? */
export const runsOn = (e: PlannerEntry, day: string) => e.startsOn <= day && day <= e.endsOn && !e.off.includes(day);

/** A week entry's days in the week: inside its range, not off, and the kitchen open that weekday. */
export function entryDays(e: PlannerEntry, days: PlannerDay[]) {
  return days.filter((d) => d.hours && runsOn(e, d.day)).map((d) => d.day);
}
