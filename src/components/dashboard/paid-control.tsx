"use client";
import { useCallback } from "react";
import { markPaid, unmarkPaid } from "@/app/dashboard/actions";
import { BoardActionForm, useBoard } from "./board-notices";
import { SubmitButton } from "./submit-button";

const PAID_WITH = { cash: "Cash", mpesa: "M-Pesa", card: "Card" } as const;

/** The payment pill: Paid in teal, money owed in amber and in words (2.1 critique). */
export function PayPill({ paid, method, paidWith }: { paid: boolean; method: string; paidWith?: "cash" | "mpesa" | "card" | null }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-[12.5px] leading-tight font-bold ${
        paid ? "bg-teal-tint text-teal-deeper" : "bg-amber-tint text-amber-ink"
      }`}
    >
      {paid ? (paidWith ? `Paid · ${PAID_WITH[paidWith]}` : "Paid") : `Not paid yet · ${method}`}
    </span>
  );
}

// No nowrap or shrink-0: the money row wraps instead, so at 200% text the button takes its own line
// and its label can wrap rather than push past the screen (QA RQA24-04).
export const quiet =
  "press min-h-11 min-w-[88px] max-w-full rounded-full bg-paper px-4 text-sm font-bold text-ink ring-[1.5px] ring-sand-deep ring-inset [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";

/**
 * Mark paid and its in-place Undo (spec-2.4 "Mark paid and its undo"). The pill changes when the
 * refreshed board arrives with the action's result; the button becomes Undo for 5 s, then goes.
 * The Undo lives in the board (useBoard().paidUndos), so it survives this row re-sorting or
 * remounting (QA RQA24-03), and it carries the version Mark paid returned (RQA24-01).
 * Announcements go through the board's one live region, which never unmounts.
 */
export function PaidButton({
  orderId,
  code,
  paid,
  block = false,
  onSettled,
}: {
  orderId: string;
  code: string;
  paid: boolean;
  block?: boolean;
  /** After Mark paid or its Undo, whatever the outcome (2.9's bill list re-fetches). */
  onSettled?: () => void;
}) {
  const board = useBoard();
  const pending = board?.paidUndos.get(orderId);
  const say = board?.say;
  const start = board?.startPaidUndo;
  const end = board?.endPaidUndo;

  const onPaid = useCallback(
    (outcome: "ok" | "refused", version?: number | null, method?: string) => {
      onSettled?.();
      // No version: it was already paid, so this tap changed nothing and there is nothing to undo.
      if (outcome !== "ok" || typeof version !== "number") return;
      start?.(orderId, version);
      say?.(`${code} marked paid${method ? `, ${method}` : ""}. Undo for 5 seconds.`);
    },
    [code, orderId, say, start, onSettled],
  );
  const onUnpaid = useCallback(
    (outcome: "ok" | "refused") => {
      onSettled?.();
      end?.(orderId);
      if (outcome === "ok") say?.(`${code} not paid yet.`);
    },
    [code, end, orderId, say, onSettled],
  );

  if (paid && pending) {
    return (
      <BoardActionForm key="undo" action={unmarkPaid} onDone={onUnpaid} className={block ? "flex w-full flex-col" : "flex flex-col items-end"}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="version" value={pending.version} />
        <SubmitButton pendingLabel="Undoing…" aria-label={`Undo marking ${code} paid`} className={`${quiet} ${block ? "w-full" : ""}`}>
          Undo
        </SubmitButton>
      </BoardActionForm>
    );
  }
  if (!paid) {
    // 2.12: the person says how it was paid. Two buttons, one tap each; the second tap of a pair is harmless.
    return (
      <div className={block ? "grid w-full grid-cols-2 gap-2" : "flex flex-wrap items-center justify-end gap-2"}>
        {(["cash", "mpesa"] as const).map((w) => (
          <BoardActionForm key={w} action={markPaid} onDone={(o, v) => onPaid(o, v, w === "cash" ? "cash" : "M-Pesa")} className={block ? "flex flex-col" : "flex flex-col items-end"}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="with" value={w} />
            <SubmitButton pendingLabel="Marking paid…" aria-label={`Paid ${w === "cash" ? "cash" : "M-Pesa"}, ${code}`} className={`${quiet} ${block ? "w-full" : ""}`}>
              Paid {w === "cash" ? "cash" : "M-Pesa"}
            </SubmitButton>
          </BoardActionForm>
        ))}
      </div>
    );
  }
  return null;
}
