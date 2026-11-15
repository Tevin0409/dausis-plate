"use client";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useState } from "react";
import { ActionForm } from "@/components/dashboard/action-form";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { formatKes } from "@/lib/format";
import { creditAmountError, creditReasonError, defaultCreditReason } from "@/lib/reports/money";
import { CANCEL_LABEL, MODE_LABEL, type OrderSheetData } from "@/lib/reports/types";
import { issueCreditNote, voidCreditNote } from "@/app/dashboard/reports/actions";

const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
/** "Sat 7 Nov 13:10", in Nairobi time. */
function when(iso: string) {
  const p = Object.fromEntries(WHEN.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}
const BY = { cash: "cash", mpesa: "M-Pesa", card: "card" } as const;
const QUIET = "press min-h-11 rounded-full px-4 text-[15px] font-bold touch-manipulation select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
const FIELD = "min-h-12 w-full rounded-[10px] border border-line-deep bg-paper px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-teal-deep";

/** The tapped button says "Issuing…"; the other is disabled until it is done. */
function ChoiceButton({ value, children, pending }: { value: "cash" | "mpesa"; children: string; pending: string }) {
  const { pending: busy, data } = useFormStatus();
  const mine = busy && data?.get("with") === value;
  return (
    <button
      type="submit"
      name="with"
      value={value}
      disabled={busy}
      aria-busy={mine || undefined}
      className={`press min-h-12 flex-1 rounded-full bg-teal-deep px-3 text-[15px] font-bold text-white touch-manipulation select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep disabled:opacity-60`}
    >
      {mine ? pending : children}
    </button>
  );
}

function IssueForm({ o, paid, firstName }: { o: OrderSheetData; paid: number; firstName: string }) {
  const [amount, setAmount] = useState(String(paid));
  const [reason, setReason] = useState(defaultCreditReason(o.cancel_reason));
  const [local, setLocal] = useState<string | null>(null);
  const check = () => {
    const bad = creditAmountError(amount, paid) ?? creditReasonError(reason);
    setLocal(bad);
    return !bad;
  };
  return (
    <ActionForm action={issueCreditNote} className="flex flex-col gap-3.5" errorClassName="text-[13px] font-semibold text-coral-ink">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="paid" value={paid} />
      <h3 className="text-[15px] font-bold">Credit note</h3>
      <label className="flex flex-col gap-1 text-[14px] font-semibold">
        Amount (KSh)
        <input name="amount" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} tabular-nums`} />
        <span className="text-[13px] font-medium text-ink-soft">Up to {formatKes(paid)}, what {firstName} paid. Lower it if you’re keeping part, like the delivery fee.</span>
      </label>
      <label className="flex flex-col gap-1 text-[14px] font-semibold">
        Reason
        <input name="reason" maxLength={120} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} />
      </label>
      {local && <p role="alert" className="note-in -mt-1 text-[13px] font-semibold text-coral-ink">{local}</p>}
      <fieldset className="flex flex-col gap-2" onClickCapture={(e) => {
        // Check before sending: a wrong amount never leaves the phone.
        if ((e.target as HTMLElement).closest("button") && !check()) e.preventDefault();
      }}>
        <legend className="mb-2 text-[14px] font-semibold">Refunded by cash or M-Pesa?</legend>
        <div className="flex gap-2">
          <ChoiceButton value="cash" pending="Issuing…">Cash refund</ChoiceButton>
          <ChoiceButton value="mpesa" pending="Issuing…">M-Pesa refund</ChoiceButton>
        </div>
      </fieldset>
      <p className="text-[13px] font-medium text-ink-soft">It gets the next number and can’t be deleted. A mistake can be voided.</p>
    </ActionForm>
  );
}

function CreditNoteBlock({ n, o }: { n: OrderSheetData["credit_notes"][number]; o: OrderSheetData }) {
  const [voiding, setVoiding] = useState(false);
  const voided = n.voided_at !== null;
  return (
    <div className={`flex flex-col gap-2 rounded-[var(--r-md)] bg-teal-tint p-4 ${voided ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
        <strong>Credit note {n.code}</strong>
        {voided && <span className="inline-flex min-h-6 items-center rounded-full bg-sand px-2.5 text-[12.5px] font-bold text-ink">Void</span>}
      </div>
      <p className="text-[14px] tabular-nums">
        {formatKes(n.amount)} · refunded by {BY[n.refunded_with]} · {when(n.issued_at)}{n.issued_by ? ` · ${n.issued_by}` : ""}
      </p>
      <p className="text-[14px] [overflow-wrap:anywhere]">{n.reason}</p>
      {n.kept > 0 && <p className="text-[13px] text-ink-soft tabular-nums">{formatKes(n.kept)} kept</p>}
      {voided && (
        <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">
          Voided {when(n.voided_at!)}{n.voided_by ? ` · ${n.voided_by}` : ""}: {n.void_reason}
        </p>
      )}
      {!voided && !voiding && (
        <button type="button" onClick={() => setVoiding(true)} className={`${QUIET} self-start px-0 text-coral-ink`}>Void credit note</button>
      )}
      {!voided && voiding && (
        <ActionForm action={voidCreditNote} className="flex flex-col gap-2.5 border-t border-teal/20 pt-3">
          <input type="hidden" name="id" value={n.id} />
          <p className="text-[14px] font-semibold">Void {n.code}? It stays in the records, marked void, and {formatKes(n.amount)} goes back into today’s Money in.</p>
          <label className="flex flex-col gap-1 text-[14px] font-semibold">
            Reason
            <input name="reason" maxLength={120} required minLength={3} autoComplete="off" className={FIELD} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setVoiding(false)} className={`${QUIET} flex-1 bg-paper text-ink ring-[1.5px] ring-sand-deep ring-inset`}>Keep it</button>
            <SubmitButton pendingLabel="Voiding…" className={`${QUIET} flex-1 bg-blush text-coral-ink ring-[1.5px] ring-blush-deep ring-inset`}>Void {n.code}</SubmitButton>
          </div>
        </ActionForm>
      )}
      <span className="sr-only">{o.code}</span>
    </div>
  );
}

/** The order sheet (owner only): the order as it was, its payment, and the credit note form or the note. */
export function OrderSheet({ order, error, code, closeHref }: { order: OrderSheetData | null; error: string | null; code: string; closeHref: string }) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  const first = order?.customer_name.split(" ")[0] ?? "";
  const cancelled = order?.status === "cancelled";
  const paid = order?.payment_status === "paid";
  const live = order?.credit_notes.find((n) => !n.voided_at);
  return (
    <PlannerSheet
      open
      onClose={close}
      labelledBy="order-sheet-title"
      footer={<button type="button" onClick={close} className={`${QUIET} w-full bg-paper text-ink ring-[1.5px] ring-sand-deep ring-inset`}>Close</button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <h2 id="order-sheet-title" tabIndex={-1} className="font-display text-[26px] leading-tight outline-none [overflow-wrap:anywhere]">
          {code}{order ? ` · ${order.customer_name}` : ""}
        </h2>
        {error && <p role="alert" className="text-[15px] font-semibold text-coral-ink">{error}</p>}
        {order && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {cancelled ? (
                <span className="inline-flex min-h-7 items-center rounded-full bg-blush px-3 text-[13px] font-bold text-coral-ink">
                  Cancelled{order.cancel_reason ? ` · ${CANCEL_LABEL[order.cancel_reason] ?? order.cancel_reason}` : ""}
                </span>
              ) : (
                <span className="inline-flex min-h-7 items-center rounded-full bg-sand px-3 text-[13px] font-bold capitalize">{order.status.replace("_", " ")}</span>
              )}
            </div>
            {order.cancel_note && <p className="-mt-2 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{order.cancel_note}</p>}
            <p className="text-[14px] tabular-nums">
              {when(order.created_at)} · {MODE_LABEL[order.mode]}
              {order.mode === "dine_in" && order.table ? `, ${order.table}` : ""}
              {order.mode === "delivery" && order.zone ? `, ${order.zone}` : ""}
              {order.mode === "pickup" && order.pickup_at ? `, booked for ${when(order.pickup_at).split(" ").pop()}` : ""}
            </p>
            <ul className="flex flex-col gap-1 border-y border-sand py-3">
              {order.items.map((it, i) => (
                <li key={i} className="text-[15px] leading-snug [overflow-wrap:anywhere]">
                  <strong className="tabular-nums">{it.quantity}×</strong> {it.name}{it.option ? ` (${it.option})` : ""}
                </li>
              ))}
              <li className="mt-1.5 flex justify-between text-[15px] font-bold tabular-nums"><span>Total</span><span>{formatKes(order.total)}</span></li>
            </ul>
            <p className="text-[14px] font-semibold tabular-nums">
              {paid ? `Paid ${formatKes(order.total)}${order.paid_with ? ` · ${order.paid_with === "mpesa" ? "M-Pesa" : order.paid_with === "cash" ? "Cash" : "Card"}` : ""}${order.paid_at ? ` · ${when(order.paid_at)}` : ""}` : "Not paid."}
            </p>
            {order.credit_notes.map((n) => <CreditNoteBlock key={n.id} n={n} o={order} />)}
            {cancelled && paid && !live && <IssueForm key={order.credit_notes.length} o={order} paid={order.total} firstName={first} />}
          </>
        )}
      </div>
    </PlannerSheet>
  );
}
