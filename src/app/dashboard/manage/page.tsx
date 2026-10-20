import Link from "next/link";
import { z } from "zod";
import { PlusIcon } from "@/components/icons";
import { formatKes, nairobiToday, weekdayName } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { setRegularAvailable } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu & sales" };

const counts = z.record(z.string(), z.number()).catch({});
const stats = z.object({
  revenue_kes: z.number(),
  orders: z.number(),
  by_mode: counts,
  by_payment: counts,
  paid_online: z.number(),
  by_hour: counts,
  rotating: z.array(z.object({ name: z.string(), sold: z.number(), total: z.number().nullable() })),
});

const HOURS = Array.from({ length: 11 }, (_, i) => 10 + i);
const CATEGORY = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" } as const;

export default async function ManagePage() {
  const today = nairobiToday();
  const supabase = await createClient();
  const [{ data: raw }, { data: regulars }] = await Promise.all([
    supabase.rpc("dashboard_stats", { p_day: today }),
    supabase
      .from("dishes")
      .select("id, name, category, price_kes, regular_available")
      .eq("is_regular", true)
      .eq("archived", false)
      .order("category")
      .order("sort_order"),
  ]);
  const s = stats.safeParse(raw);
  const st = s.success ? s.data : null;

  const sold = st?.rotating.reduce((n, r) => n + r.sold, 0) ?? 0;
  const total = st?.rotating.reduce((n, r) => n + (r.total ?? 0), 0) ?? 0;
  const best = st?.rotating[0];
  const maxHour = Math.max(1, ...HOURS.map((h) => st?.by_hour[String(h)] ?? 0));
  const onlineShare = st && st.orders > 0 ? Math.round((st.paid_online / st.orders) * 100) : 0;

  const tile = "flex flex-col gap-1 rounded-[18px] border border-line bg-white p-[18px]";
  const big = "font-display text-[34px] leading-tight";

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <header>
        <h1 className="font-display text-[34px]">Menu &amp; sales</h1>
        <span className="text-sm text-ink-soft">Today so far</span>
      </header>

      <section aria-label="Today’s numbers" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Revenue</span>
          <span className={big}>{formatKes(st?.revenue_kes ?? 0)}</span>
        </div>
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Orders</span>
          <span className={big}>{st?.orders ?? 0}</span>
          <span className="text-[13px] text-ink-soft">
            {st?.by_mode.delivery ?? 0} delivery · {st?.by_mode.pickup ?? 0} pickup · {st?.by_mode.dine_in ?? 0} dine-in
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] bg-blush p-[18px]">
          <span className="text-sm font-semibold text-coral-ink">{weekdayName(today)}’s menu</span>
          <span className={big}>
            {sold} {total > 0 && <span className="font-sans text-base text-ink-soft">of {total} plates sold</span>}
          </span>
          {total > 0 && (
            <div className="h-2 rounded-full bg-blush-deep"><div className="h-2 rounded-full bg-coral" style={{ width: `${Math.min(100, (sold / total) * 100)}%` }} /></div>
          )}
          {best && best.sold > 0 && <span className="text-[13px] text-ink-soft">Best seller: {best.name}, {best.sold}{best.total ? ` of ${best.total}` : ""}</span>}
        </div>
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Paid online</span>
          <span className={big}>{onlineShare}%</span>
          <span className="text-[13px] text-ink-soft">
            M-Pesa {st?.by_payment.mpesa ?? 0} · Card {st?.by_payment.card ?? 0} · On handover {st?.by_payment.on_handover ?? 0}
          </span>
        </div>
      </section>

      <section aria-label="Orders by hour" className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-white p-5">
        <h2 className="text-base font-bold">Orders by hour</h2>
        <div
          role="img"
          aria-label={HOURS.map((h) => `${h}:00 ${st?.by_hour[String(h)] ?? 0}`).join(", ")}
          className="grid h-[120px] grid-cols-11 items-end gap-2.5"
        >
          {HOURS.map((h) => {
            const n = st?.by_hour[String(h)] ?? 0;
            return <div key={h} className={`rounded-t-md ${n ? "bg-teal" : "bg-line-deep"}`} style={{ height: n ? `${(n / maxHour) * 100}%` : 4 }} />;
          })}
        </div>
        <div className="grid grid-cols-11 gap-2.5 text-center text-xs text-ink-soft">
          {HOURS.map((h) => <span key={h}>{h > 12 ? h - 12 : h}{h === 12 ? "pm" : ""}</span>)}
        </div>
      </section>

      <section aria-label="Always on the menu" className="overflow-hidden rounded-[18px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-base font-bold">Always on the menu <span className="font-medium text-ink-soft">· {regulars?.length ?? 0} items</span></h2>
          <Link href="/dashboard/dishes/new?regular=1" className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-teal-deep px-4 text-sm font-bold text-white">
            <PlusIcon size={16} /> Add item
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[15px]">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[13px] text-ink-soft">
                <th scope="col" className="px-5 py-2.5 font-semibold">Item</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Price</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">On sale today</th>
                <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(regulars ?? []).map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-5 py-2.5 font-semibold">{d.name}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{CATEGORY[d.category]}</td>
                  <td className="px-3 py-2.5">{formatKes(d.price_kes)}</td>
                  <td className="px-3 py-1.5">
                    <form action={setRegularAvailable}>
                      <input type="hidden" name="dishId" value={d.id} />
                      <input type="hidden" name="available" value={d.regular_available ? "false" : "true"} />
                      <button
                        aria-label={`${d.name}: ${d.regular_available ? "on sale, tap to mark sold out" : "sold out, tap to put back on sale"}`}
                        className={`min-h-11 rounded-full px-3.5 text-sm font-semibold ${
                          d.regular_available ? "bg-teal-tint text-teal-deeper" : "bg-blush text-coral-ink"
                        }`}
                      >
                        {d.regular_available ? "On sale" : "Sold out"}
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-1.5 text-right">
                    <Link href={`/dashboard/dishes/${d.id}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-line-deep px-3.5 text-sm font-semibold text-teal-deep">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
