// Slice 2.11 in Reports: the "Ads, for invoicing" cells (spec-2.12 "Promos & ads"). Plain module.
import { shortDay } from "./period";

/** One decimal place; a dash under 50 views, where a rate means little. */
export const tapRate = (taps: number, views: number) => (views < 50 ? "—" : `${((taps / views) * 100).toFixed(1)}%`);

/** An ad's run for invoicing: "Sun 1 Nov – Tue 1 Dec", with the year when the run isn't all in this year. */
export function runLabel(from: string, to: string, today: string): string {
  const y = from.slice(0, 4) !== to.slice(0, 4) || to.slice(0, 4) !== today.slice(0, 4);
  return y ? `${shortDay(from)} ${from.slice(0, 4)} – ${shortDay(to)} ${to.slice(0, 4)}` : `${shortDay(from)} – ${shortDay(to)}`;
}
