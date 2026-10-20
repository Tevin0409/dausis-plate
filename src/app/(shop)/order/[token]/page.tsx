import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckIcon, PhoneIcon } from "@/components/icons";
import { AutoRefresh } from "@/components/shop/auto-refresh";
import { formatKes, timeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const status = z.object({
  code: z.string(),
  status: z.enum(["new", "preparing", "ready", "completed", "cancelled"]),
  mode: z.enum(["dine_in", "pickup", "delivery"]),
  payment_method: z.enum(["mpesa", "card", "on_handover"]),
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
  items: z.array(z.object({ name: z.string(), option_label: z.string().nullable(), quantity: z.number(), unit_price_kes: z.number() })),
});

const STEPS = ["new", "preparing", "ready", "completed"] as const;

export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.string().uuid().safeParse(token).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_order_status", { p_token: token });
  const parsed = status.safeParse(data);
  if (!parsed.success) notFound();
  const o = parsed.data;

  const where =
    o.mode === "dine_in" ? `${o.table_label ?? "Your table"}` : o.mode === "pickup" ? "Pickup" : `Delivery to ${o.zone_name ?? "you"}`;
  const readyLabel = o.mode === "delivery" ? "On the way" : o.mode === "pickup" ? "Ready to collect" : "On its way to your table";
  const doneLabel = o.mode === "delivery" ? "Delivered" : "Enjoy!";
  const labels: Record<(typeof STEPS)[number], string> = {
    new: "Order received",
    preparing: "Mama is cooking",
    ready: readyLabel,
    completed: doneLabel,
  };
  const current = o.status === "cancelled" ? -1 : STEPS.indexOf(o.status);
  const paymentChip =
    o.payment_status === "paid"
      ? `Paid with ${o.payment_method === "mpesa" ? "M-Pesa" : "card"}`
      : o.payment_status === "pending"
        ? "Check your phone to pay"
        : o.payment_status === "failed"
          ? "Payment didn’t go through"
          : "Pay on handover";

  return (
    <>
      <AutoRefresh active={o.status !== "completed" && o.status !== "cancelled"} />
      <section className="flex flex-col gap-1.5 rounded-b-[28px] bg-teal-deep px-5 pb-[26px] pt-[22px] text-white">
        <div className="flex items-center justify-between">
          <Image src="/brand/dausis-plate-icon.svg" alt="Dausis Plate" width={40} height={40} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">
            {o.payment_status === "paid" && <CheckIcon />}
            {paymentChip}
          </span>
        </div>
        <span className="mt-3.5 font-script text-[30px] leading-none">Asante, {o.customer_name}!</span>
        <span className="text-[15px] text-[#d7f0ee]">Order {o.code} · {where}</span>
        {o.status === "cancelled" && <span className="mt-3 text-lg font-semibold">This order was cancelled. Call us if that’s a surprise.</span>}
        {o.pickup_at && o.mode === "pickup" && <span className="mt-3 text-lg">Collect at {timeLabel(o.pickup_at)}</span>}
      </section>

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
            <span>{it.quantity} × {it.name}{it.option_label ? ` (${it.option_label})` : ""}</span>
            <span>{formatKes(it.unit_price_kes * it.quantity)}</span>
          </div>
        ))}
        {o.delivery_fee_kes > 0 && (
          <div className="flex justify-between text-ink-soft"><span>Delivery</span><span>{formatKes(o.delivery_fee_kes)}</span></div>
        )}
        <div className="h-px bg-sand" />
        <div className="flex justify-between text-[15px] font-bold"><span>Total</span><span>{formatKes(o.total_kes)}</span></div>
      </section>

      <div className="mx-5 mt-6 flex gap-2.5">
        <a href={`tel:${process.env.NEXT_PUBLIC_RESTAURANT_PHONE ?? ""}`} className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] border-teal-deep bg-white font-semibold text-teal-deep">
          <PhoneIcon /> Call us
        </a>
        <Link href="/" className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl bg-teal-deep font-semibold text-white">Back to menu</Link>
      </div>
    </>
  );
}
