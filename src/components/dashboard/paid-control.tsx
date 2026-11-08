"use client";
import { useCallback } from "react";
import { markPaid, unmarkPaid } from "@/app/dashboard/actions";
import { BoardActionForm, useBoard } from "./board-notices";
import { SubmitButton } from "./submit-button";

/** The payment pill: Paid in teal, money owed in amber and in words (2.1 critique). */
export function PayPill({ paid, method }: { paid: boolean; method: string }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-[12.5px] leading-tight font-bold ${
        paid ? "bg-teal-tint text-teal-deeper" : "bg-amber-tint text-amber-ink"
      }`}
    >
      {paid ? "Paid" : `Not paid yet · ${method}`}
    </span>
  );
}

// No nowrap or shrink-0: the money row wraps instead, so at 200% text the button takes its own line
// and its label can wrap rather than push past the screen (QA RQA24-04).
const quiet =
  "press min-h-11 min-w-[100px] max-w-full rounded-full bg-paper px-4 text-sm font-bold text-ink ring-[1.5px] ring-sand-deep ring-inset [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";

/**
 * Mark paid and its in-place Undo (spec-2.4 "Mark paid and its undo"). The pill changes when the
 * refreshed board arrives with the action's result; the button becomes Undo for 5 s, then goes.
 * The Undo lives in the board (useBoard().paidUndos), so it survives this row re-sorting or
 * remounting (QA RQA24-03), and it carries the version Mark paid returned (RQA24-01).
 * Announcements go through the board's one live region, which never unmounts.
 */
export function PaidButton({ orderId, code, paid }: { orderId: string; code: string; paid: boolean }) {
  const board = useBoard();
  const pending = board?.paidUndos.get(orderId);
  const say = board?.say;
  const start = board?.startPaidUndo;
  const end = board?.endPaidUndo;

  const onPaid = useCallback(
    (outcome: "ok" | "refused", version?: number | null) => {
      // No version: it was already paid, so this tap changed nothing and there is nothing to undo.
      if (outcome !== "ok" || typeof version !== "number") return;
      start?.(orderId, version);
      say?.(`${code} marked paid. Undo for 5 seconds.`);
    },
    [code, orderId, say, start],
  );
  const onUnpaid = useCallback(
    (outcome: "ok" | "refused") => {
      end?.(orderId);
      if (outcome === "ok") say?.(`${code} not paid yet.`);
    },
    [code, end, orderId, say],
  );

  if (paid && pending) {
    return (
      <BoardActionForm key="undo" action={unmarkPaid} onDone={onUnpaid} className="flex flex-col items-end">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="version" value={pending.version} />
        <SubmitButton pendingLabel="Undoing…" aria-label={`Undo marking ${code} paid`} className={quiet}>
          Undo
        </SubmitButton>
      </BoardActionForm>
    );
  }
  if (!paid) {
    return (
      <BoardActionForm key="mark" action={markPaid} onDone={onPaid} className="flex flex-col items-end">
        <input type="hidden" name="orderId" value={orderId} />
        <SubmitButton pendingLabel="Marking paid…" aria-label={`Mark ${code} paid`} className={quiet}>
          Mark paid
        </SubmitButton>
      </BoardActionForm>
    );
  }
  return null;
}
