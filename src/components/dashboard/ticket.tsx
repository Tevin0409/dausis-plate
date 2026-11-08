import { ageOf, phoneLabel, typeTag, type Mode, type Status } from "@/lib/board";
import type { Enums } from "@/lib/database.types";
import { formatKes } from "@/lib/format";
import { BagIcon, BikeIcon, QrIcon } from "@/components/icons";
import { TicketShell } from "./board-layout";
import { PaidButton, PayPill } from "./paid-control";
import { TicketActions } from "./ticket-actions";

export type BoardOrder = {
  id: string;
  code: string;
  status: Status;
  mode: Mode;
  payment_method: Enums<"payment_method">;
  payment_status: Enums<"payment_status">;
  total_kes: number;
  created_at: string;
  status_changed_at: string;
  pickup_at: string | null;
  delivery_address: string | null;
  delivery_notes: string | null;
  customer_name: string;
  customer_phone: string;
  table: { label: string } | null;
  zone: { name: string } | null;
  items: { name: string; option_label: string | null; quantity: number; note: string | null }[];
};

// Launch has two ways to pay (spec-2.1-payments.md); older mpesa or card orders read as on handover.
const PAY_LABEL: Record<Enums<"payment_method">, string> = { at_counter: "At the counter", on_handover: "On handover", mpesa: "On handover", card: "On handover" };
export const payLabel = (o: BoardOrder) => PAY_LABEL[o.payment_method];

const TAG_ICON = { dine_in: QrIcon, pickup: BagIcon, delivery: BikeIcon } as const;

/** The neutral type tag (sand, never a column colour). */
export function TypeTag({ o }: { o: BoardOrder }) {
  const Icon = TAG_ICON[o.mode];
  return (
    <span className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full bg-sand px-2.5 text-[13px] leading-tight font-bold text-ink">
      <Icon size={14} className="shrink-0" />
      {typeTag({ mode: o.mode, pickup_at: o.pickup_at, table: o.table?.label ?? null, zone: o.zone?.name ?? null })}
    </span>
  );
}

/** One ticket, its parts in spec-2.4 "Ticket" order. `now` is the server's clock at render. */
export function Ticket({ o, now }: { o: BoardOrder; now: Date }) {
  const age = ageOf(o, now);
  const paid = o.payment_status === "paid";
  return (
    <TicketShell
      orderKey={`${o.status}:${o.id}`}
      orderId={o.id}
      className="flex shrink-0 flex-col gap-2 rounded-[var(--r-md)] bg-paper p-3.5 shadow-[var(--shadow-card)] outline-none data-shown:focus:outline-2 data-shown:focus:outline-offset-2 data-shown:focus:outline-teal-deep data-shown:focus:outline-solid"
    >
      {/* 1. Code and age */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="text-[17px] leading-tight font-bold tabular-nums">{o.code}</span>
        {age.amber ? (
          <span className="inline-flex min-h-6 max-w-full items-center rounded-full bg-amber-tint px-2.5 text-sm font-bold text-amber-ink tabular-nums">
            {age.text}
          </span>
        ) : (
          <span className="max-w-full pt-0.5 text-[13px] font-semibold text-ink-soft tabular-nums">{age.text}</span>
        )}
      </div>

      {/* 2. Name and type tag, wrapping together */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">{o.customer_name}</span>
        <TypeTag o={o} />
      </div>

      {/* 3. Food lines */}
      <ul className="flex flex-col gap-1">
        {o.items.map((it, i) => (
          <li key={i} className="leading-snug">
            <span className="block text-base font-semibold">
              {it.quantity} × {it.name}
            </span>
            {it.option_label && <span className="block text-sm font-medium text-ink-soft">{it.option_label}</span>}
            {it.note && <span className="block text-sm font-semibold text-amber-ink [overflow-wrap:anywhere]">{it.note}</span>}
          </li>
        ))}
      </ul>

      {/* 4. Delivery: the address and the rider's directions, never clamped */}
      {o.mode === "delivery" && o.delivery_address && (
        <p className="text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{o.delivery_address}</p>
      )}
      {o.mode === "delivery" && o.delivery_notes?.trim() && (
        <p className="rounded-[var(--r-sm)] bg-amber-tint px-3 py-2 text-sm leading-snug font-semibold text-amber-ink [overflow-wrap:anywhere]">
          <strong className="font-bold">For the rider:</strong> {o.delivery_notes.trim()}
        </p>
      )}

      {/* 5. Phone */}
      <a
        href={`tel:${o.customer_phone.replace(/\s/g, "")}`}
        className="flex min-h-11 items-center self-start text-sm font-semibold text-teal-deep [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-teal-deep"
      >
        Call {phoneLabel(o.customer_phone)}
      </a>

      {/* 6. Money row: the total and Mark paid on one line when they fit (they wrap at large text), the pill under */}
      <div className="flex flex-col items-start gap-1 border-t border-sand pt-2.5">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-base font-bold tabular-nums">{formatKes(o.total_kes)}</span>
          <PaidButton orderId={o.id} code={o.code} paid={paid} />
        </div>
        <PayPill paid={paid} method={payLabel(o)} />
      </div>

      {/* 7 and 8. Main action, then Decline or Cancel order */}
      <div className="flex flex-col gap-2">
        <TicketActions order={{ id: o.id, code: o.code, name: o.customer_name, status: o.status, mode: o.mode }} />
      </div>
    </TicketShell>
  );
}

/** A 56 px row in Done: code, name, type tag, total, the payment pill, and Mark paid if unpaid. */
export function DoneRow({ o }: { o: BoardOrder }) {
  const paid = o.payment_status === "paid";
  return (
    <TicketShell
      as="li"
      orderKey={`${o.status}:${o.id}`}
      orderId={o.id}
      className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2 outline-none data-shown:focus:outline-2 data-shown:focus:outline-teal-deep data-shown:focus:outline-solid"
    >
      <span className="text-[15px] font-bold tabular-nums">{o.code}</span>
      <span className="min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{o.customer_name}</span>
      <TypeTag o={o} />
      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <span className="text-[15px] font-bold tabular-nums">{formatKes(o.total_kes)}</span>
        <PayPill paid={paid} method={payLabel(o)} />
        <PaidButton orderId={o.id} code={o.code} paid={paid} />
      </span>
    </TicketShell>
  );
}
