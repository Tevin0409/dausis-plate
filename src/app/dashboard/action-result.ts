import type { Enums } from "@/lib/database.types";

/**
 * An order move the database refused (P0001: someone else moved it first, or it was cancelled),
 * with the order as it is now, so the board can say where it went.
 */
export type OrderRefusal = {
  orderId: string;
  kind: "advance" | "cancel";
  /** The status the tapped button expected, for a move. */
  from: Enums<"order_status"> | null;
  code: string | null;
  customerName: string | null;
  status: Enums<"order_status"> | null;
  paymentStatus: Enums<"payment_status"> | null;
};

/** What a dashboard form action returns: null on success, or a message for the person who tapped. */
export type ActionResult = { error: string; refused?: OrderRefusal } | null;
