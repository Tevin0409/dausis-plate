// Slice 2.10: ratings (spec-2.10-ratings.md). Shared by the order page, the menu and the owner's
// Ratings screen. Every rule lives in the database (rate_order, list_ratings, set_rating_hidden,
// reply_to_rating); this file only words what it returns.
import { z } from "zod";
import { isDay } from "@/lib/reports/period";

export const COMMENT_MAX = 500;
/** The counter appears from here (spec: "At 400 characters a counter appears"). */
export const COUNTER_FROM = 400;
/** A dish shows its average from its 3rd visible rating (Q2 B). The view applies the same rule. */
export const MIN_RATINGS_SHOWN = 3;

export const STAR_LABELS = ["Not good", "Could be better", "Good", "Very good", "Loved it"] as const;

export const customerRating = z
  .object({
    sent_at: z.string(),
    stars: z.number().int().min(1).max(5),
    comment_sent: z.boolean(),
    reply: z.object({ text: z.string(), replied_at: z.string() }).nullable(),
  })
  .nullable();
export type CustomerRating = z.infer<typeof customerRating>;

export type RateResult =
  | { ok: true; stars: number; commentSent: boolean }
  /** `gone`: the form can't be used any more (closed or no longer completed); `rated`: show the thanks card. */
  | { ok: false; line: string; gone?: boolean; rated?: boolean };

/** The Google link's checks, the same as set_google_review_url's (spec-2.10 Settings; RQA210-03). */
export const GOOGLE_LINK_MAX = 500;
export function googleLinkProblem(value: string): string | null {
  if (!value) return null;
  if (!value.startsWith("https://")) return "Start the link with https://";
  if (value.length > GOOGLE_LINK_MAX) return "That link is too long.";
  if (/\s/.test(value) || value === "https://") return "Paste the whole link from Google, with no spaces.";
  return null;
}

export const COULDNT_SEND = "Couldn’t send. Check your connection and try again.";

const LINES: Record<string, { line: string; gone?: boolean; rated?: boolean }> = {
  rating_closed: { line: "Rating has closed for this order.", gone: true },
  rating_not_finished: { line: "This order isn’t finished yet, so it can’t be rated.", gone: true },
  rating_no_order: { line: "This order isn’t finished yet, so it can’t be rated.", gone: true },
  rating_already: { line: "", rated: true },
  rating_comment_long: { line: "Comments can be at most 500 characters." },
};

/** The customer's line for a refusal code word from rate_order; anything else is "Couldn't send". */
export function rateRefusal(message: string | undefined): RateResult {
  const hit = message ? LINES[message] : undefined;
  return hit ? { ok: false, ...hit } : { ok: false, line: COULDNT_SEND };
}

const en = new Intl.NumberFormat("en-KE");
const TZ = "Africa/Nairobi";

/** A dish's public average, one decimal, half up, from the 3rd rating; null below that. */
export function dishAverage(count: number, total: number): number | null {
  if (count < MIN_RATINGS_SHOWN) return null;
  // Integer maths, so 4.45 rounds to 4.5 as Postgres' round() does.
  return Math.round((total * 10) / count) / 10;
}

/** "4.6" and "1,204" for the dish meta (spec 2.8: "★ 4.6 (1,204)"). */
export function ratingMeta(avg: number, count: number) {
  const value = avg.toFixed(1);
  const n = en.format(count);
  return { value, count: n, label: `Rated ${value} out of 5 from ${n} ${count === 1 ? "rating" : "ratings"}` };
}

/** "Sat 7 Nov", Nairobi time. */
export function shortDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "Fri 6 Nov, 13:08", Nairobi time. */
export function sentLabel(iso: string): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  return `${shortDate(iso)}, ${time}`;
}

/** "Pilau · Fish curry · Chapati": the whole list; the card clamps it to two lines and says how many more. */
export const dishLine = (names: string[]) => names.join(" · ");

export const starsWord = (n: number) => `${n} ${n === 1 ? "star" : "stars"}`;

// ───────── the owner's Ratings screen ─────────

export const FILTERS = [
  { key: "all", label: "All", empty: "No ratings yet. They appear here when customers rate a completed order." },
  { key: "comments", label: "With a comment", empty: "No ratings with a comment yet." },
  { key: "low", label: "1–2 stars", empty: "No 1–2 star ratings. Good going." },
  { key: "hidden", label: "Hidden", empty: "No hidden ratings." },
] as const;
export type RatingFilter = (typeof FILTERS)[number]["key"];
export const parseFilter = (v: string | string[] | undefined): RatingFilter =>
  FILTERS.some((f) => f.key === v) ? (v as RatingFilter) : "all";

export type OwnerRating = {
  order_id: string;
  code: string;
  first_name: string;
  sent_at: string;
  stars: number;
  dishes: string[];
  comment: string | null;
  hidden_at: string | null;
  reply: string | null;
  replied_at: string | null;
  is_new: boolean;
};

/** The days a rating was sent, from Reports' "All ratings" link (?from=&to=, Nairobi days). Both or neither. */
export type RatingDates = { from: string; to: string } | null;
/** A malformed or impossible day (2026-99-01, 2026-02-31) gives null: the screen shows all dates. */
export function parseDates(from: unknown, to: unknown): RatingDates {
  return isDay(from) && isDay(to) && from <= to ? { from, to } : null;
}
/** The Ratings screen's address for a filter, keeping the dates. */
export function ratingsHref(show: RatingFilter, dates: RatingDates): string {
  const q = new URLSearchParams();
  if (show !== "all") q.set("show", show);
  if (dates) {
    q.set("from", dates.from);
    q.set("to", dates.to);
  }
  const s = q.toString();
  return s ? `/dashboard/ratings?${s}` : "/dashboard/ratings";
}

export const PAGE_SIZE = 30;
export const REPLY_LONG = "Replies can be at most 500 characters.";
export const REPLY_FAILED = "Couldn’t save the reply. Try again.";

/** "4.6 ★ average from 38 orders in the last 30 days · 2 hidden" */
export function summaryLine(s: { avg_stars: number | null; visible: number; hidden: number } | null): string {
  // No-break spaces keep "· 2 hidden" with the word before it, so a wrap never starts a line with "·".
  const hidden = s && s.hidden > 0 ? `\u00a0·\u00a0${en.format(s.hidden)}\u00a0hidden` : "";
  if (!s || s.visible === 0 || s.avg_stars === null) return `No ratings in the last 30 days${hidden}`;
  const avg = Number(s.avg_stars).toFixed(1);
  return `${avg} ★ average from ${en.format(s.visible)} ${s.visible === 1 ? "order" : "orders"} in the last 30\u00a0days${hidden}`;
}
