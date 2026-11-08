"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { advanceOrder, cancelOrder } from "@/app/dashboard/actions";
import { mainAction, NOTE_MAX, NOTE_MIN, reasonsFor, type CancelReason, type Mode, type Status } from "@/lib/board";
import { BoardActionForm, useBoard } from "./board-notices";
import { SubmitButton } from "./submit-button";

type Order = { id: string; code: string; name: string; status: Status; mode: Mode };

/**
 * A ticket's main action and its Decline (New) or Cancel order (after Accept), spec-2.4 "Ticket"
 * 7 and 8. Decline opens the form in their place; one form is open per tablet.
 */
export function TicketActions({ order }: { order: Order }) {
  const board = useBoard();
  const open = board?.openForm === order.id;
  const opener = useRef<HTMLButtonElement>(null);
  const step = mainAction(order.status, order.mode);
  const declining = order.status === "new";

  const onMoved = useCallback(
    (outcome: "ok" | "refused", version?: number | null) => {
      if (outcome === "ok" && step && typeof version === "number")
        board?.moved({ orderId: order.id, code: order.code, name: order.name, from: order.status, to: step.to, version });
    },
    [board, order, step],
  );

  const close = useCallback(
    (refocus: boolean) => {
      board?.setOpenForm(null);
      if (refocus) requestAnimationFrame(() => opener.current?.focus());
    },
    [board],
  );

  if (open) return <CancelForm order={order} onClose={close} />;

  return (
    <>
      {step && (
        <BoardActionForm action={advanceOrder} onDone={onMoved} className="flex flex-col gap-1.5">
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="from" value={order.status} />
          <input type="hidden" name="mode" value={order.mode} />
          <SubmitButton
            pendingLabel={step.pending}
            className={`press min-h-12 w-full rounded-full text-base font-bold [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${
              declining ? "bg-teal-deep text-white" : "bg-paper text-teal-deep ring-[1.5px] ring-teal-deep ring-inset"
            }`}
          >
            {step.label}
          </SubmitButton>
        </BoardActionForm>
      )}
      <button
        ref={opener}
        type="button"
        onClick={() => board?.setOpenForm(order.id)}
        className={
          declining
            ? "press mt-0.5 min-h-11 w-full touch-manipulation rounded-full text-[15px] font-bold text-coral-ink ring-[1.5px] ring-blush-deep ring-inset select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
            : "press mt-0.5 min-h-11 self-start touch-manipulation rounded-[var(--r-sm)] px-1 text-sm font-semibold text-ink-soft select-none [-webkit-touch-callout:none] active:text-coral-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep [@media(hover:hover)_and_(pointer:fine)]:hover:text-coral-ink"
        }
      >
        {declining ? "Decline" : "Cancel order"}
      </button>
    </>
  );
}

/** The Decline form (and Cancel, after Accept): the reason, shown to the customer. No undo. */
function CancelForm({ order, onClose }: { order: Order; onClose: (refocus: boolean) => void }) {
  const declining = order.status === "new";
  const verb = declining ? "Decline" : "Cancel";
  const reasons = reasonsFor(order.status, order.mode);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const ids = useId();
  const first = order.name.split(/\s+/)[0] || "The customer";

  // Focus goes to the first reason when the form opens.
  useEffect(() => {
    group.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  }, []);

  // Done or refused, the form closes: the order leaves the board, or the strip says where it went.
  const done = useCallback(() => onClose(false), [onClose]);

  return (
    <div
      ref={group}
      role="group"
      aria-label={`${verb} ${order.code}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose(true);
        }
      }}
      className="note-in flex flex-col gap-2.5 rounded-[var(--r-md)] bg-blush p-3"
    >
      <p className="text-[15px] leading-snug font-bold text-coral-ink">
        {verb} {order.code}? {first} will see why.
      </p>
      <BoardActionForm action={cancelOrder} onDone={done} className="flex flex-col gap-2.5">
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="from" value={order.status} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Reason</legend>
          {reasons.map((r) => (
            <label
              key={r.id}
              className="press flex min-h-11 cursor-pointer touch-manipulation items-center gap-2.5 rounded-[var(--r-sm)] bg-paper px-3 py-2 text-[15px] leading-snug font-semibold select-none [-webkit-touch-callout:none] has-focus-visible:outline-2 has-focus-visible:outline-teal-deep"
            >
              <input
                type="radio"
                name="reason"
                value={r.id}
                checked={reason === r.id}
                onChange={() => {
                  setReason(r.id);
                  setNoteError(false);
                }}
                className="size-5 shrink-0 accent-coral-ink outline-none"
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        {reason === "other" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-note`} className="text-sm font-semibold">
              Why, in a few words
            </label>
            <input
              id={`${ids}-note`}
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              enterKeyHint="done"
              autoComplete="off"
              aria-invalid={noteError || undefined}
              aria-describedby={noteError ? `${ids}-err` : undefined}
              className="min-h-11 rounded-[var(--r-sm)] border border-line-deep bg-paper px-3 text-base outline-none focus-visible:border-teal-deep focus-visible:ring-2 focus-visible:ring-teal-deep/30"
            />
            {noteError && (
              <p id={`${ids}-err`} role="alert" className="text-[13px] font-semibold text-coral-ink">
                Say why in a few words.
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onClose(true)}
            className="press min-h-11 min-w-[120px] flex-1 touch-manipulation rounded-full bg-paper text-[15px] font-bold text-ink ring-[1.5px] ring-sand-deep ring-inset select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
          >
            Keep order
          </button>
          <SubmitButton
            pendingLabel={declining ? "Declining…" : "Cancelling…"}
            disabled={!reason}
            className="press min-h-11 min-w-[120px] flex-1 rounded-full bg-coral-ink text-[15px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
            onSubmitCheck={() => {
              if (reason === "other" && note.trim().length < NOTE_MIN) {
                setNoteError(true);
                return false;
              }
              return true;
            }}
          >
            {verb} order
          </SubmitButton>
        </div>
      </BoardActionForm>
    </div>
  );
}
