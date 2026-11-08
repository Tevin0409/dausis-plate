import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { AddDish, AllList, ArchivedList, DoneNote, EverydayList, type DishRowData } from "@/components/dashboard/dishes/dish-list";
import { formatKes, nairobiToday, weekdayName } from "@/lib/format";
import { regularOnSale } from "@/lib/kitchen";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dishes" };

const counts = z.record(z.string(), z.number()).catch({});
const stats = z.object({
  revenue_kes: z.number(),
  paid_kes: z.number(),
  unpaid_kes: z.number(),
  orders: z.number(),
  by_mode: counts,
  by_payment: counts,
  by_hour: counts,
  rotating: z.array(z.object({ name: z.string(), sold: z.number(), total: z.number().nullable() })),
});

const HOURS = Array.from({ length: 11 }, (_, i) => 10 + i);
type View = "everyday" | "all" | "archived";

type Props = { searchParams: Promise<{ view?: string; done?: string; dish?: string; name?: string }> };

export default async function ManagePage({ searchParams }: Props) {
  const [q, staff] = await Promise.all([searchParams, getStaff()]);
  if (!staff) notFound();
  const owner = staff.role === "owner";
  // Archived is the owner's; anyone else asking for it gets the everyday menu.
  const view: View = q.view === "all" ? "all" : q.view === "archived" && owner ? "archived" : "everyday";
  const today = nairobiToday();
  const supabase = await createClient();

  const base = supabase.from("dishes").select("id, name, category, price_kes, photo_thumb_url, photo_url, is_regular, unavailable_on, archived_at");
  const query =
    view === "everyday"
      ? base.eq("is_regular", true).eq("archived", false).order("sort_order").order("name")
      : view === "all"
        ? base.eq("archived", false).order("name")
        : base.eq("archived", true).order("archived_at", { ascending: false, nullsFirst: false }).order("name");
  // Sales figures are the owner's (spec-2.3); staff never ask for them.
  const [statsResult, dishesResult] = await Promise.all([owner && view === "everyday" ? supabase.rpc("dashboard_stats", { p_day: today }) : null, query]);
  const dishes: DishRowData[] = must(dishesResult, "the dishes").map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    price_kes: d.price_kes,
    photo: d.photo_thumb_url ?? d.photo_url,
    is_regular: d.is_regular,
    onSale: regularOnSale(d.unavailable_on, today),
    archivedOn: view === "archived" && d.archived_at ? nairobiDayOf(d.archived_at) : null,
  }));
  if (view === "all") dishes.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const edits = can(staff, "dishes_prices");
  const everyday = can(staff, "everyday_menu");
  const doneKind: "deleted" | "archived" | null = q.done === "deleted" ? "deleted" : q.done === "archived" ? "archived" : null;
  const done = doneKind && q.dish && q.name ? { done: doneKind, dishId: q.dish, name: q.name.slice(0, 80) } : null;

  const segments: [View, string][] = [["everyday", "Everyday menu"], ["all", "All dishes"], ...(owner ? [["archived", "Archived"] as [View, string]] : [])];

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[34px] leading-tight">Dishes</h1>
            <RefusalNote className="mt-1" />
          </div>
          {edits && <AddDish href={view === "everyday" && everyday ? "/dashboard/dishes/new?regular=1" : "/dashboard/dishes/new"} />}
        </div>
        <nav aria-label="Dish views" className={`grid gap-1 rounded-[14px] bg-sand p-1 ${segments.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {segments.map(([v, text]) => (
            <Link
              key={v}
              href={v === "everyday" ? "/dashboard/manage" : `/dashboard/manage?view=${v}`}
              aria-current={view === v ? "page" : undefined}
              className={`press flex min-h-11 items-center justify-center rounded-[10px] px-2 text-center text-sm font-semibold leading-tight touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-teal-deep ${
                view === v ? "bg-paper text-teal-deep shadow-[0_1px_2px_rgb(26_32_44/0.08)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {text}
            </Link>
          ))}
        </nav>
      </header>

      {done && <DoneNote key={`${done.done}-${done.dishId}`} {...done} />}
      {statsResult && <Sales st={readStats(statsResult)} today={today} />}

      {view === "everyday" && (
        <>
          <EverydayList dishes={dishes} canAdd={edits} />
          {!everyday && <p className="text-sm text-ink-soft">{OWNER_ONLY.everyday_menu}</p>}
        </>
      )}
      {view === "all" && <AllList dishes={dishes} />}
      {view === "archived" && <ArchivedList dishes={dishes} />}
    </div>
  );
}

const nairobiDayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

function readStats(result: Parameters<typeof must>[0]) {
  const s = stats.safeParse(must(result, "today’s sales"));
  if (!s.success) {
    // Wrong shape is a failure too: showing zeros would look like a quiet day.
    console.error("[db] dashboard_stats had an unexpected shape:", s.error.message);
    throw new Error("Couldn't load today’s sales");
  }
  return s.data;
}

/** The owner's header and today's figures. */
function Sales({ st, today }: { st: z.infer<typeof stats>; today: string }) {

  const sold = st.rotating.reduce((n, r) => n + r.sold, 0);
  const total = st.rotating.reduce((n, r) => n + (r.total ?? 0), 0);
  const best = st.rotating[0];
  const maxHour = Math.max(1, ...HOURS.map((h) => st.by_hour[String(h)] ?? 0));

  const tile = "flex min-w-0 flex-col gap-1 rounded-[18px] bg-cream p-[18px] ring-1 ring-sand";
  const big = "font-display text-[34px] leading-tight";
  // "KSh" and the figure never split (formatKes), so a seven-figure day steps down to
  // display-lg (28 px) to stay inside a 200 px tile; six figures and below keep 34 px.
  const money = (kes: number) => {
    const text = formatKes(kes);
    return <span className={text.length > 11 ? "font-display text-[28px] leading-tight" : big}>{text}</span>;
  };

  return (
    <>
      <h2 className="-mb-2 text-sm font-semibold text-ink-soft">Today so far</h2>
      <section aria-label="Today’s numbers" className="grid grid-cols-2 gap-3 min-[1280px]:grid-cols-4">
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Total ordered</span>
          {money(st.revenue_kes)}
        </div>
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Orders</span>
          <span className={big}>{st.orders}</span>
          <span className="text-[13px] text-ink-soft">
            {st.by_mode.delivery ?? 0} delivery · {st.by_mode.pickup ?? 0} pickup · {st.by_mode.dine_in ?? 0} dine-in
          </span>
        </div>
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">{weekdayName(today)}’s menu</span>
          <span className={big}>
            {sold} {total > 0 && <span className="font-sans text-base text-ink-soft">of {total} plates sold</span>}
          </span>
          {total > 0 && (
            <div className="h-2 rounded-full bg-blush-deep"><div className="h-2 rounded-full bg-coral" style={{ width: `${Math.min(100, (sold / total) * 100)}%` }} /></div>
          )}
          {best && best.sold > 0 && <span className="text-[13px] text-ink-soft">Best seller: {best.name}, {best.sold}{best.total ? ` of ${best.total}` : ""}</span>}
        </div>
        <div className={tile}>
          <span className="text-sm font-semibold text-ink-soft">Paid so far</span>
          {money(st.paid_kes)}
          <span className="text-[13px] text-ink-soft">{formatKes(st.unpaid_kes)} not paid yet</span>
        </div>
      </section>

      <section aria-label="Orders by hour" className="flex min-w-0 flex-col gap-3.5 rounded-[18px] bg-cream p-5 ring-1 ring-sand">
        <h2 className="text-base font-bold">Orders by hour</h2>
        <div
          role="img"
          aria-label={HOURS.map((h) => `${h}:00 ${st.by_hour[String(h)] ?? 0}`).join(", ")}
          className="grid h-[120px] grid-cols-11 items-end gap-2.5"
        >
          {HOURS.map((h) => {
            const n = st.by_hour[String(h)] ?? 0;
            return <div key={h} className={`rounded-t-md ${n ? "bg-teal" : "bg-line-deep"}`} style={{ height: n ? `${(n / maxHour) * 100}%` : 4 }} />;
          })}
        </div>
        <div className="grid grid-cols-11 gap-2.5 text-center text-xs text-ink-soft">
          {HOURS.map((h) => <span key={h}>{h > 12 ? h - 12 : h}{h === 12 ? "pm" : ""}</span>)}
        </div>
      </section>

    </>
  );
}
