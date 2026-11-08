import Image from "next/image";
import { formatKenyanPhone } from "@/lib/kitchen-phone";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckIcon, PhoneIcon } from "@/components/icons";
import { AutoRefresh } from "@/components/shop/auto-refresh";
import { TillLine } from "@/components/shop/till-line";
import { Narrow } from "@/components/shop/ui";
import { customerCancelText } from "@/lib/board";
import { formatKes, timeLabel } from "@/lib/format";
import { closingTime } from "@/lib/kitchen";
import { createClient } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

const status = z.object({
  code: z.string(),
  status: z.enum(["new", "preparing", "ready", "on_the_way", "completed", "cancelled"]),
  mode: z.enum(["dine_in", "pickup", "delivery"]),
  // mpesa and card stay readable: older orders may carry them.
  payment_method: z.enum(["mpesa", "card", "on_handover", "at_counter"]),
  payment_status: z.enum(["pending", "paid", "failed", "unpaid"]),
  customer_name: z.string(),
  table_label: z.string().nullable(),
  zone_name: z.string().nullable(),
  pickup_at: z.string().nullable(),
  subtotal_kes: z.number(),
  delivery_fee_kes: z.number(),
  total_kes: z.number(),
  created_at: z.string(),
  status_changed_at: z.string(),
  // spec-2.4: why a declined or cancelled order was stopped, shown to the customer.
  cancel_reason: z.enum(["sold_out", "too_busy", "cant_deliver", "customer_asked", "no_show", "other"]).nullable().optional(),
  cancel_note: z.string().nullable().optional(),
  declined: z.boolean().optional(),
  // Only while unpaid and not cancelled, and only if Mama has set one (get_order_status decides).
  till_number: z.string().nullable().optional(),
  // spec-2.6: the kitchen phone (null when Mama hasn't set one) and each line's extras.
  phone: z.string().nullable().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      option_label: z.string().nullable(),
      quantity: z.number(),
      unit_price_kes: z.number(),
      extras: z.array(z.object({ label: z.string(), price_kes: z.number() })).nullable().optional(),
    }),
  ),
});

// On the way is for delivery only (spec-2.4); the other types keep four steps.
const ALL_STEPS = ["new", "preparing", "ready", "on_the_way", "completed"] as const;
type Step = (typeof ALL_STEPS)[number];

export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.string().uuid().safeParse(token).success) notFound();
  const supabase = await createClient();
  const data = must(await supabase.rpc("get_order_status", { p_token: token }), "the order");
  if (data === null) notFound();
  const parsed = status.safeParse(data);
  if (!parsed.success) {
    // The order exists but came back in a shape we don't understand: that's our bug, not "not found".
    console.error("[db] get_order_status had an unexpected shape:", parsed.error.message);
    throw new Error("Couldn't load the order");
  }
  const o = parsed.data;

  const where =
    o.mode === "dine_in" ? `${o.table_label ?? "Your table"}` : o.mode === "pickup" ? "Pickup" : `Delivery to ${o.zone_name ?? "you"}`;
  const STEPS = ALL_STEPS.filter((s) => s !== "on_the_way" || o.mode === "delivery");
  // DESIGN.md: dine-in ends in Served, pickup in Collected, delivery in Delivered.
  const labels: Record<Step, string> = {
    new: "Order received",
    preparing: "Mama is cooking",
    ready: o.mode === "delivery" ? "Ready for the rider" : o.mode === "pickup" ? "Ready to collect" : "On its way to your table",
    on_the_way: "On the way",
    completed: o.mode === "delivery" ? "Delivered" : o.mode === "pickup" ? "Collected" : "Served",
  };
  const current = o.status === "cancelled" ? -1 : STEPS.indexOf(o.status);
  const cancelled = o.status === "cancelled";
  const cancelLine = cancelled
    ? customerCancelText({ reason: o.cancel_reason ?? null, note: o.cancel_note ?? null, declined: !!o.declined })
    : null;
  // spec-2.1-payments.md: every unpaid order that isn't at the counter (older mpesa or card
  // orders, pending or failed included) reads as on handover for its order type.
  const paymentChip =
    o.payment_status === "paid"
      ? "Paid"
      : o.status === "cancelled"
        ? null
        : o.payment_method === "at_counter"
          ? "Pay at the counter"
          : o.mode === "dine_in"
            ? "Pay when your food arrives"
            : o.mode === "pickup"
              ? "Pay when you collect"
              : "Pay when the rider arrives";

  return (
    <Narrow>
      <AutoRefresh active={o.status !== "completed" && o.status !== "cancelled"} />
      <section className="flex flex-col gap-1.5 rounded-b-[28px] bg-teal-deep md:rounded-[28px] px-5 pb-[26px] pt-[22px] text-white">
        <div className="flex items-center justify-between">
          <Image src="/brand/dausis-plate-icon.svg" alt="Dausis Plate" width={40} height={40} />
          {paymentChip && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">
              {o.payment_status === "paid" && <CheckIcon />}
              {paymentChip}
            </span>
          )}
        </div>
        {o.till_number && o.payment_status !== "paid" && o.status !== "cancelled" && <TillLine till={o.till_number} />}
        <span className="mt-3.5 font-script text-[30px] leading-none">Asante, {o.customer_name}!</span>
        <span className="text-[15px] text-[#d7f0ee]">Order {o.code} · {where}</span>
        {cancelled && (
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-lg font-semibold">{o.declined ? "We couldn’t take your order." : "Your order was cancelled."}</span>
            {cancelLine && <span className="text-[15px] [overflow-wrap:anywhere]">{cancelLine}</span>}
            {o.payment_status !== "paid" && <span className="text-[15px]">You haven’t been charged.</span>}
          </div>
        )}
        {o.pickup_at && o.mode === "pickup" && <span className="mt-3 text-lg">Collect at {closingTime(o.pickup_at)}</span>}
      </section>

      {o.phone && (
        <p className="mx-5 mt-4 flex flex-wrap items-center gap-x-1.5 text-[15px] text-ink-soft">
          Questions about your order?
          <a href={`tel:${o.phone}`} className="press inline-flex min-h-11 items-center gap-1.5 font-semibold text-teal-deep underline-offset-2 hover:underline">
            <PhoneIcon /> Call the kitchen · <span className="whitespace-nowrap tabular-nums">{formatKenyanPhone(o.phone)}</span>
          </a>
        </p>
      )}

      <ol aria-label="Order progress" className="mx-5 mt-6 flex flex-col">
        {STEPS.map((s, i) => {
          const done = i < current || o.status === "completed";
          const active = i === current && o.status !== "completed";
          return (
            <li key={s} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                {done ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-teal-deep text-white"><CheckIcon /></span>
                ) : active ? (
                  <span className="flex size-7 items-center justify-center rounded-full border-[3px] border-coral bg-white"><span className="size-2.5 rounded-full bg-coral" /></span>
                ) : (
                  <span className="size-7 rounded-full border-2 border-line-deep bg-white" />
                )}
                {i < STEPS.length - 1 && <span className={`min-h-[34px] w-0.5 flex-1 ${done ? "bg-teal-deep" : "bg-sand-deep"}`} />}
              </div>
              <div className="pb-[18px] pt-[3px]">
                <div className={`text-base ${active ? "font-bold" : done ? "font-semibold" : "font-semibold text-ink-soft"}`}>{labels[s]}</div>
                {active && <div className="text-[13px] font-semibold text-coral-ink">In progress · since {timeLabel(o.status_changed_at)}</div>}
                {i === 0 && <div className="text-[13px] text-ink-soft">{timeLabel(o.created_at)}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      <section aria-label="Order summary" className="mx-5 mt-5 flex flex-col gap-2 rounded-[18px] border border-sand bg-white px-4 py-3.5 text-sm">
        {o.items.map((it, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {it.quantity} × {it.name}
              {it.option_label ? ` (${it.option_label})` : ""}
              {it.extras && it.extras.length > 0 ? ` ${it.extras.map((x) => `+ ${x.label}`).join(", ")}` : ""}
            </span>
            <span className="shrink-0 whitespace-nowrap">{formatKes(it.unit_price_kes * it.quantity)}</span>
          </div>
        ))}
        {o.delivery_fee_kes > 0 && (
          <div className="flex justify-between text-ink-soft"><span>Delivery</span><span>{formatKes(o.delivery_fee_kes)}</span></div>
        )}
        <div className="h-px bg-sand" />
        <div className="flex justify-between text-[15px] font-bold"><span>Total</span><span>{formatKes(o.total_kes)}</span></div>
      </section>

      <div className="mx-5 mt-6 flex gap-2.5">
        <Link href="/" className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl bg-teal-deep font-semibold text-white">{cancelled ? "Order again" : "Back to menu"}</Link>
      </div>
    </Narrow>
  );
}
