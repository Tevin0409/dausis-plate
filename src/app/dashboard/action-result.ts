import type { Enums } from "@/lib/database.types";

/**
 * An order move the database refused (P0001: someone else moved it first, or it was cancelled),
 * with the order as it is now, so the board can say where it went.
 */
export type OrderRefusal = {
  orderId: string;
  /** advance and cancel: 0.2's stale tap. undo: a move's Undo; unpaid: Mark paid's Undo (2.4). */
  kind: "advance" | "cancel" | "undo" | "unpaid";
  /** The status the tapped button expected: for a move or a cancel, the column; for an undo, where the move put it. */
  from: Enums<"order_status"> | null;
  code: string | null;
  customerName: string | null;
  status: Enums<"order_status"> | null;
  paymentStatus: Enums<"payment_status"> | null;
};

/**
 * What a dashboard form action returns: null on success, or a message for the person who tapped.
 * `stale` marks a refusal for a job the person no longer holds (slice 2.3): the form shows the line,
 * then refreshes the page so the control goes.
 */
export type ActionResult = { error: string; refused?: OrderRefusal; stale?: boolean } | null;

/**
 * A board action's result: as ActionResult, or on success the order's version after it (null when
 * nothing changed). The Undo sends the version back, so it reverses only this change (QA RQA24-01).
 */
export type BoardResult = ActionResult | { version: number | null };
