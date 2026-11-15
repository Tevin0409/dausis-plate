// The shapes the report RPCs return (jsonb). Read through `asReport` so a wrong shape is a loud failure, not a quiet zero.
import type { MoneyRow } from "./money";

export type Tiles = {
  sales: number;
  orders: number;
  average: number | null;
  money_in: number;
  payments: number;
  payments_n: number;
  credit_notes: number;
  credit_notes_voided: number;
  to_collect_kes: number;
  to_collect_n: number;
  cancelled_n: number;
  cancelled_kes: number;
  cancelled_paid_n: number;
  cancelled_with_note_n: number;
};

export type CreditNoteRow = {
  code: string;
  number: number;
  order: string;
  order_total: number;
  amount: number;
  kept: number;
  refunded_with: "cash" | "mpesa";
  reason: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

export type SalesReport = {
  from: string;
  to: string;
  grain: "day" | "week" | "month";
  first_order_day: string | null;
  tiles: Tiles;
  compare: Tiles | null;
  /** food is at menu value; food − discounts + fees = sales (2.11, Tevin's Food A). */
  by_bucket: { bucket: string; sales: number; orders: number; food: number; discounts: number; fees: number }[];
  by_hour: { hour: number; sales: number; orders: number }[];
  by_payment_method: { method: string; orders: number; paid: number; not_paid: number }[];
  by_mode: { mode: string; orders: number; sales: number }[];
  cancellations: {
    by_reason: { reason: string; orders: number; kes: number }[];
    orders: { code: string; created_at: string; total: number; reason: string | null; note: string | null; paid: boolean; credit_note: string | null }[];
  };
  money_in: MoneyRow[];
  to_collect: { code: string; created_at: string; mode: string; table: string | null; total: number }[];
  paid_cancelled_open: { code: string; paid_at: string; total: number; reason: string | null; note: string | null }[];
  credit_notes: CreditNoteRow[];
};

export type DishRow = {
  id: string;
  name: string;
  is_regular: boolean;
  plates: number;
  revenue: number;
  days_on: number;
  per_day: number | null;
  limit_days: number | null;
  limit_used_avg: number | null;
  limit_avg: number | null;
  sold_out_days: number;
  usual_sold_out_minutes: number | null;
  /** Not-hidden ratings sent in the period on orders that had the dish; shown from the 1st here. */
  rating_avg: number | null;
  rating_count: number;
};
export type DishDay = { dish: string; day: string; plates: number; limit: number | null; sold_out_at: string | null; sold_out_minutes: number | null; out: boolean; back_on: boolean };
export type DishesReport = { dishes: DishRow[]; days: DishDay[] };

export type TimesReport = {
  days: number;
  by_hour: { hour: number; orders: number; per_day: number }[];
  by_weekday_hour: { weekday: number; hour: number; orders: number; avg: number }[];
};

/** report_ratings: counted on the Nairobi day each rating was sent. Hidden ratings are out of avg, count and by_week. */
export type RatingsReport = {
  avg: number | null;
  count: number;
  hidden: number;
  with_comment: number;
  replied: number;
  /** Weeks (Mondays) with at least one counted rating; a week with none has no row. */
  by_week: { week: string; avg: number; count: number }[];
  /** The latest 10 with a comment, hidden ones included. */
  recent: { code: string; stars: number; comment: string; sent_at: string; hidden: boolean; reply: string | null; replied_at: string | null; dishes: string[] }[];
};

export type DeliveryReport = { zones: { zone: string; orders: number; fees: number; food: number; discounts: number }[] };

/** report_promos_ads (2.11): orders that aren't cancelled, in the period; ads in the period or over each ad's whole run. */
export type PromosReport = {
  codes: { code: string; active: boolean; uses: number; discount: number; sales: number }[];
  combos: { combo: string; sold: number; revenue: number }[];
  ads_whole_run: boolean;
  ads: { id: string; advertiser: string; space: "menu" | "order"; starts_on: string; ends_on: string; views: number; taps: number }[];
};

export type OrderSheetData = {
  id: string;
  code: string;
  customer_name: string;
  mode: "dine_in" | "pickup" | "delivery";
  created_at: string;
  pickup_at: string | null;
  status: string;
  cancel_reason: string | null;
  cancel_note: string | null;
  total: number;
  subtotal: number;
  fee: number;
  /** 2.11: the code's discount (0 without one) and the code as placed. */
  discount: number;
  discount_code: string | null;
  payment_method: string;
  payment_status: string;
  paid_with: "cash" | "mpesa" | "card" | null;
  paid_at: string | null;
  table: string | null;
  zone: string | null;
  items: { name: string; option: string | null; quantity: number; unit: number }[];
  /** 2.11: each combo at its price with its choices and extras; quantity per dish is per combo. */
  combos: { name: string; quantity: number; unit: number; dishes: { name: string; option: string | null; quantity: number }[] }[];
  credit_notes: {
    id: string;
    code: string;
    amount: number;
    kept: number;
    refunded_with: "cash" | "mpesa";
    reason: string;
    issued_at: string;
    issued_by: string | null;
    voided_at: string | null;
    voided_by: string | null;
    void_reason: string | null;
  }[];
};

/** The RPC's jsonb, typed. The database is the one writer of these shapes (tests/db/reports.test.ts). */
export const asReport = <T>(v: unknown): T => v as T;

// ───────── words ─────────
export const CANCEL_LABEL: Record<string, string> = {
  sold_out: "Sold out",
  too_busy: "Too busy",
  cant_deliver: "Can’t deliver there",
  customer_asked: "Customer asked",
  no_show: "Didn’t come",
  other: "Other",
  none: "No reason given",
};
export const MODE_LABEL: Record<string, string> = { dine_in: "Dine-in", pickup: "Pickup", delivery: "Delivery" };
export const PAY_CHOICE_LABEL: Record<string, string> = { at_counter: "At the counter", on_handover: "On handover", mpesa: "M-Pesa online", card: "Card" };
export const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
export const minutesLabel = (m: number | null) => (m === null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
