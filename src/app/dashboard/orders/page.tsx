import Link from "next/link";
import { LiveOrders } from "@/components/dashboard/live-orders";
import type { Enums } from "@/lib/database.types";
import { formatKes, minutesAgo, nairobiToday, timeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { advanceOrder, cancelOrder, markPaid } from "../actions";
import { SubmitButton } from "@/components/dashboard/submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live orders" };

type Status = Enums<"order_status">;
type Mode = Enums<"order_mode">;

const COLUMNS: { status: Status; title: string; pill: string; edge: string; action?: string }[] = [
  { status: "new", title: "New", pill: "bg-blush text-coral-ink", edge: "border-t-coral", action: "Accept order" },
  { status: "preparing", title: "Preparing", pill: "bg-amber-tint text-amber-ink", edge: "border-t-amber", action: "Mark ready" },
  { status: "ready", title: "Ready", pill: "bg-teal-tint text-teal-deeper", edge: "border-t-teal", action: "Handed over" },
  { status: "completed", title: "Completed", pill: "bg-[#eef2f6] text-ink-soft", edge: "border-t-line-deep" },
];

const PAY_LABEL: Record<Enums<"payment_method">, string> = { mpesa: "M-Pesa", card: "Card", on_handover: "On handover" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: modeParam } = await searchParams;
  const mode: Mode | null = modeParam === "dine_in" || modeParam === "pickup" || modeParam === "delivery" ? modeParam : null;
  const supabase = await createClient();
  const startOfDay = new Date(`${nairobiToday()}T00:00:00+03:00`).toISOString();

  let query = supabase
    .from("orders")
    .select(
      "id, code, status, mode, payment_method, payment_status, total_kes, created_at, pickup_at, delivery_address, customer_name, customer_phone, table:dining_tables(label), zone:delivery_zones(name), items:order_items(name, option_label, quantity, note)",
    )
    .gte("created_at", startOfDay)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  if (mode) query = query.eq("mode", mode);
  const { data: orders } = await query;
  const all = orders ?? [];

  const filters: { id: Mode | null; label: string }[] = [
    { id: null, label: "All" },
    { id: "dine_in", label: "Dine-in" },
    { id: "pickup", label: "Pickup" },
    { id: "delivery", label: "Delivery" },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-3.5">
        <div>
          <h1 className="font-display text-[34px]">Live orders</h1>
          <span className="text-sm text-ink-soft">Updates as orders come in · {all.length} orders today</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <Link
              key={f.label}
              href={f.id ? `/dashboard/orders?mode=${f.id}` : "/dashboard/orders"}
              aria-current={mode === f.id ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-full px-3.5 text-sm ${
                mode === f.id ? "bg-ink font-semibold text-white" : "border border-line-deep bg-white font-medium"
              }`}
            >
              {f.label}
            </Link>
          ))}
          <LiveOrders />
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        {COLUMNS.map((col) => {
          const list = all.filter((o) => o.status === col.status);
          const shown = col.status === "completed" ? list.slice(-6).reverse() : list;
          return (
            <section key={col.status} aria-label={col.title} className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold ${col.pill}`}>{col.title}</span>
                <span className="text-sm font-semibold text-ink-soft">{list.length}</span>
              </div>
              {shown.map((o) => {
                const where =
                  o.mode === "dine_in"
                    ? (o.table?.label ?? "Table")
                    : o.mode === "pickup"
                      ? `Pickup · ${o.pickup_at ? timeLabel(o.pickup_at) : "ASAP"}`
                      : `Delivery · ${o.zone?.name ?? ""}`;
                const paid = o.payment_status === "paid";
                return (
                  <article key={o.id} className={`flex flex-col gap-2 rounded-2xl border border-t-4 border-line bg-white p-3.5 ${col.edge}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-bold">{o.code}</span>
                      <span className="text-[13px] text-ink-soft">{minutesAgo(o.created_at)}</span>
                    </div>
                    <span className="self-start rounded-lg bg-[#eef2f6] px-2.5 py-1 text-[13px] font-semibold">{where}</span>
                    <ul className="text-sm leading-normal">
                      {o.items.map((it, i) => (
                        <li key={i}>
                          {it.quantity} × {it.name}
                          {it.option_label ? ` (${it.option_label})` : ""}
                          {it.note && <span className="block text-[13px] text-coral-ink">“{it.note}”</span>}
                        </li>
                      ))}
                    </ul>
                    {o.mode === "delivery" && o.delivery_address && <p className="text-[13px] text-ink-soft">{o.delivery_address}</p>}
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className={`font-semibold ${paid ? "text-teal-deeper" : o.payment_status === "failed" ? "text-coral-ink" : "text-ink-soft"}`}>
                        {paid ? "Paid" : o.payment_status === "pending" ? "Awaiting" : o.payment_status === "failed" ? "Failed" : "Pay"} · {PAY_LABEL[o.payment_method]}
                      </span>
                      <span className="text-sm font-bold">{formatKes(o.total_kes)}</span>
                    </div>
                    <a href={`tel:${o.customer_phone}`} className="text-[13px] font-semibold text-teal-deep">{o.customer_name} · {o.customer_phone}</a>
                    {col.action && (
                      <form action={advanceOrder}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="from" value={o.status} />
                        <SubmitButton
                          className={`min-h-11 w-full rounded-xl text-[15px] font-bold ${
                            col.status === "new" ? "bg-teal-deep text-white" : "border-[1.5px] border-teal-deep bg-white text-teal-deep"
                          }`}
                        >
                          {col.status === "ready" && o.mode === "delivery" ? "Out for delivery" : col.action}
                        </SubmitButton>
                      </form>
                    )}
                    {col.status !== "completed" && (
                      <div className="flex gap-3 text-[13px] font-semibold">
                        {!paid && (
                          <form action={markPaid}>
                            <input type="hidden" name="orderId" value={o.id} />
                            <SubmitButton className="text-teal-deep">Mark paid</SubmitButton>
                          </form>
                        )}
                        {col.status === "new" && (
                          <form action={cancelOrder}>
                            <input type="hidden" name="orderId" value={o.id} />
                            <SubmitButton className="text-coral-ink">Decline</SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
