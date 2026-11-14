// Slice 2.9: table requests (spec-2.9-table-requests.md). The shapes the database returns, the
// customer's wording, and the board's age, shared by the server pages, the client parts and tests.
import { z } from "zod";
import { timeLabel } from "@/lib/format";

export type RequestKind = "waiter" | "bill";

/** The board and the customer pages fetch requests this often (spec "How fast staff see it"). */
export const REQUEST_POLL_MS = 10_000;
/** A request's age turns amber after this many minutes (a display choice, spec "Age"). */
export const REQUEST_AMBER_AFTER_MIN = 5;
/** The board shows this many requests, then "N more requests" (2 below 600 px). */
export const REQUESTS_SHOWN = 3;
export const REQUESTS_SHOWN_PHONE = 2;
/** The menu's "Answered 12:54." line shows for this long. */
export const MENU_ANSWERED_FOR_MS = 10 * 60_000;

const billOrder = z.object({
  id: z.string(),
  code: z.string(),
  customer_name: z.string(),
  created_at: z.string(),
  status: z.enum(["new", "preparing", "ready", "on_the_way", "completed", "cancelled"]),
  total_kes: z.number(),
  paid: z.boolean(),
  asked: z.boolean(),
});
export type BillOrder = z.infer<typeof billOrder>;

const openRequest = z.object({
  id: z.string(),
  kind: z.enum(["waiter", "bill"]),
  table_id: z.string(),
  table_label: z.string(),
  created_at: z.string(),
  order_id: z.string().nullable(),
  orders: z.array(billOrder).nullable(),
  unpaid_kes: z.number().nullable(),
});
export type OpenRequest = z.infer<typeof openRequest>;
export const openRequests = z.array(openRequest);

const customerRequest = z
  .object({ asked_at: z.string(), answered_at: z.string().nullable(), by_this_order: z.boolean() })
  .nullable();
export type CustomerRequest = z.infer<typeof customerRequest>;
/** get_order_status's `requests`: null for anything but a dine-in order. */
export const customerRequests = z.object({ waiter: customerRequest, bill: customerRequest }).nullable();

export const waiterStatus = z.object({ asked_at: z.string(), answered_at: z.string().nullable() }).nullable();
export type WaiterStatus = z.infer<typeof waiterStatus>;

/** What the customer's tap came back with. */
export type AskResult =
  | { ok: true; askedAt: string; created: boolean }
  | { ok: false; line: string; /** the button's state is no longer what the page shows: refresh it */ refresh?: boolean };

const LINES: Record<string, string> = {
  request_limit: "You’ve asked a lot today. Please wave to a waiter.",
  request_table_gone: "Scan the QR code on your table again.",
  request_kitchen_closed: "The kitchen is closed now. Please wave to a waiter.",
  request_not_today: "Table requests work on the day of your order.",
  request_cancelled: "This order was cancelled, so table requests are off.",
  request_no_order: "Couldn’t find this order. Please wave to a waiter.",
};
export const COULDNT_SEND = "Couldn’t send. Try again, or wave to a waiter.";

/** The customer's line for a refusal code word from the database; anything else is "Couldn't send". */
export function askRefusal(message: string | undefined): AskResult {
  const line = message ? LINES[message] : undefined;
  if (!line) return { ok: false, line: COULDNT_SEND };
  // Not today, cancelled, or no such order: the page's own state is out of date.
  const refresh = message === "request_not_today" || message === "request_cancelled" || message === "request_no_order";
  return { ok: false, line, refresh };
}

/** "just now", "1 min", "12 min", "1 h 5 min", "3 h 0 min" (spec "Age"). */
export function requestAge(createdAt: string, now: number): { text: string; amber: boolean } {
  const mins = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const text = mins < 1 ? "just now" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return { text, amber: mins >= REQUEST_AMBER_AFTER_MIN };
}

/** The customer's button, from the table's latest request of that kind (spec "Customer: order status page"). */
export function buttonState(kind: RequestKind, r: CustomerRequest): { open: boolean; label: string; line: string } {
  const ready = kind === "waiter" ? "Call waiter" : "Request bill";
  if (r && !r.answered_at) {
    const at = timeLabel(r.asked_at);
    return {
      open: true,
      label: kind === "waiter" ? "Waiter called" : "Bill asked for",
      line: r.by_this_order
        ? kind === "waiter"
          ? `Sent ${at}. Staff have been told.`
          : `Sent ${at}. Staff will bring it.`
        : `Someone at your table asked at ${at}.`,
    };
  }
  if (r?.answered_at) {
    const at = timeLabel(r.answered_at);
    return { open: false, label: ready, line: kind === "waiter" ? `Answered ${at}. Tap to call again.` : `Answered ${at}.` };
  }
  return { open: false, label: ready, line: "" };
}
