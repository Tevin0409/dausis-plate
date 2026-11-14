import { notFound, redirect } from "next/navigation";
import { CardError, DeliverySection, DishesSection, PromosSection, RatingsSection, SalesSection, TimesSection } from "@/components/reports/sections";
import { ExportButton, PeriodControl, TabStrip } from "@/components/reports/controls";
import { OrderSheet } from "@/components/reports/order-sheet";
import { formatKes, nairobiToday } from "@/lib/format";
import { changeText, compareLabel, compareWord, parseReportPeriod, periodLabel, periodQuery, type Period } from "@/lib/reports/period";
import type { DeliveryReport, DishesReport, OrderSheetData, SalesReport, TimesReport } from "@/lib/reports/types";
import { createClient, getStaff } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Db = Awaited<ReturnType<typeof createClient>>;

const SLOW = "This period is too long to load at once. Try a shorter one.";
const FAILED = "Couldn’t load the reports. Try again";

/** An RPC's result, or the line the card should show instead (the other cards still render). */
async function call<T>(run: () => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<{ data: T } | { error: string }> {
  try {
    const { data, error } = await run();
    if (error) {
      console.error("[db] report failed:", error.code ?? "", error.message);
      return { error: error.code === "57014" ? SLOW : error.code === "P0001" ? error.message : FAILED };
    }
    return { data: data as T };
  } catch (e) {
    console.error("[db] report threw:", e);
    return { error: FAILED };
  }
}

const SECTION_FOR_EXPORT = { sales: "sales", dishes: "dishes", times: "times", delivery: "delivery" } as const;

export default async function ReportsPage({ searchParams }: Props) {
  const staff = await getStaff();
  if (!staff) notFound();
  // Owner only: anyone else goes back to the dashboard with no message (spec-2.12 "Who sees it").
  if (staff.role !== "owner") redirect("/dashboard");

  const sp = await searchParams;
  const today = nairobiToday();
  const period = parseReportPeriod(sp, today);
  const supabase: Db = await createClient();
  const range = { p_from: period.from, p_to: period.to };
  const orderParam = typeof sp.order === "string" && /^[A-Z]{2}-\d{1,8}$/.test(sp.order) ? sp.order : null;

  const [sales, tab, order] = await Promise.all([
    call<SalesReport>(() => supabase.rpc("report_sales", { ...range, p_cmp_from: period.compare.from, p_cmp_to: period.compare.to })),
    period.tab === "dishes" ? call<DishesReport>(() => supabase.rpc("report_dishes", range))
      : period.tab === "times" ? call<TimesReport>(() => supabase.rpc("report_times", range))
      : period.tab === "delivery" ? call<DeliveryReport>(() => supabase.rpc("report_delivery", range))
      : Promise.resolve(null),
    orderParam ? call<OrderSheetData>(() => supabase.rpc("report_order", { p_code: orderParam })) : Promise.resolve(null),
  ]);

  const firstDay = "data" in sales ? sales.data.first_order_day : null;
  const exportSection = SECTION_FOR_EXPORT[period.tab as keyof typeof SECTION_FOR_EXPORT];
  const closeQuery = periodQuery(period);
  const closeHref = closeQuery ? `/dashboard/reports?${closeQuery}` : "/dashboard/reports";

  return (
    <div className="flex max-w-[1120px] flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-[34px] leading-tight">Reports</h1>
          <span className="inline-flex min-h-6 items-center rounded-full bg-sand px-2.5 text-[12.5px] font-bold text-ink">Owner only</span>
        </div>
        {exportSection && <ExportButton section={exportSection} period={period} className="max-[599px]:hidden" />}
      </header>

      <div className="flex items-start justify-between gap-3 max-[599px]:flex-col">
        <div className="flex w-full min-w-0 flex-col gap-2">
          <PeriodControl period={period} today={today} firstOrderDay={firstDay} />
          <p className="text-[15px] font-semibold tabular-nums">{periodLabel(period, today)}</p>
        </div>
        {exportSection && <ExportButton section={exportSection} period={period} className="min-[600px]:hidden max-[599px]:absolute max-[599px]:top-0 max-[599px]:right-0" />}
      </div>

      {"data" in sales ? <Tiles r={sales.data} period={period} today={today} /> : <CardError title="Totals" message={sales.error} />}
      <TabStrip period={period} />

      <div key={`${period.range}${period.from}${period.to}${period.tab}`} className="rpt-in">
        {period.tab === "sales" && ("data" in sales ? <SalesSection d={sales.data} period={period} today={today} /> : <CardError title="Sales & money" message={sales.error} />)}
        {tab && "error" in tab && <CardError title="This section" message={tab.error} />}
        {period.tab === "dishes" && tab && "data" in tab && <DishesSection d={tab.data as DishesReport} period={period} today={today} />}
        {period.tab === "times" && tab && "data" in tab && <TimesSection d={tab.data as TimesReport} period={period} today={today} />}
        {period.tab === "delivery" && tab && "data" in tab && <DeliverySection d={tab.data as DeliveryReport} period={period} today={today} />}
        {period.tab === "ratings" && <RatingsSection />}
        {period.tab === "promos" && <PromosSection />}
      </div>

      {orderParam && order && (
        <OrderSheet code={orderParam} closeHref={closeHref} order={"data" in order ? order.data : null} error={"error" in order ? (order.error === FAILED ? "Couldn’t load that order. Try again." : order.error) : null} />
      )}
    </div>
  );
}

// Glyph widths in em of the display face (measured in the browser): a money figure is "KSh " plus
// these, with no kerning between them, so the width is exact. Remeasure if the display font changes.
const GLYPH_EM: Record<string, number> = {
  "0": 0.502, "1": 0.35, "2": 0.532, "3": 0.532, "4": 0.538, "5": 0.532, "6": 0.53, "7": 0.489, "8": 0.502, "9": 0.532,
  ",": 0.3, "−": 0.541,
};

/** A money figure's width in em in the display face, with 1% to spare. */
function figureEm(text: string): number {
  let em = 1.969; // "KSh " (formatKes may join it with a no-break space)
  for (const c of text.replace(/KSh\s/u, "")) em += GLYPH_EM[c] ?? 0.6;
  return em * 1.01;
}

function Tiles({ r, period, today }: { r: SalesReport; period: Period; today: string }) {
  const t = r.tiles;
  const c = r.compare;
  const word = compareWord(period);
  const noPayments = t.payments_n === 0 && t.credit_notes === 0;
  // The figure takes its size step from its length, then is capped by its tile's width (the tile is a
  // size container), so a long figure shrinks to fit and never wraps or spills (RQA212-01). figureEm
  // is the figure's width in em, so 100/figureEm cqi always fits; where the step
  // already fits (375 and up for normal amounts) the step is used as is.
  const money = (n: number) => {
    const text = n < 0 ? `−${formatKes(-n)}` : formatKes(n);
    const step = text.length > 11 ? "[--fig:24px] min-[1024px]:[--fig:22px]" : text.length > 9 ? "[--fig:26px] min-[600px]:[--fig:30px] min-[1024px]:[--fig:24px]" : "[--fig:30px] min-[1024px]:[--fig:26px]";
    return <span className={`font-display leading-tight tabular-nums whitespace-nowrap ${step}`} style={{ fontSize: `min(var(--fig), ${(100 / figureEm(text)).toFixed(2)}cqi)` }}>{text}</span>;
  };
  const tile = "@container flex min-w-0 flex-col gap-1 rounded-[18px] border border-line bg-cream p-4";
  const under = "text-[13px] leading-snug text-ink-soft tabular-nums";
  const orders = t.orders === 0 ? "No orders" : `${t.orders} ${t.orders === 1 ? "order" : "orders"}`;
  const join = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(" · ");
  return (
    <section aria-label="Totals" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-6 min-[1024px]:grid-cols-5">
        <div className={`${tile} col-span-2 min-[1024px]:col-span-1`}>
          <span className="text-sm font-semibold text-ink-soft">Sales</span>
          {money(t.sales)}
          <span className={under}>{join(orders, changeText(t.sales, c?.sales, word))}</span>
        </div>
        <div className={`${tile} min-[600px]:col-span-2 min-[1024px]:col-span-1`}>
          <span className="text-sm font-semibold text-ink-soft">Money in</span>
          {money(t.money_in)}
          <span className={under}>{join(noPayments ? "No payments" : t.credit_notes > 0 && `after ${formatKes(t.credit_notes)} in credit notes`, changeText(t.money_in, c?.money_in, word))}</span>
        </div>
        <div className={`${tile} min-[600px]:col-span-2 min-[1024px]:col-span-1`}>
          <span className="text-sm font-semibold text-ink-soft">Still to collect</span>
          {money(t.to_collect_kes)}
          <span className={under}>{t.to_collect_n === 0 ? "Nothing to collect" : `${t.to_collect_n} ${t.to_collect_n === 1 ? "order" : "orders"}`}</span>
        </div>
        <div className={`${tile} min-[600px]:col-span-3 min-[1024px]:col-span-1`}>
          <span className="text-sm font-semibold text-ink-soft">Average order</span>
          {t.average === null ? <span className="font-display text-[30px] leading-tight text-ink-soft min-[1024px]:text-[26px]">—</span> : money(t.average)}
          <span className={under}>{t.average === null ? "No orders" : changeText(t.average, c?.average, word) ?? " "}</span>
        </div>
        <div className={`${tile} min-[600px]:col-span-3 min-[1024px]:col-span-1`}>
          <span className="text-sm font-semibold text-ink-soft">Cancelled</span>
          <span className="font-display text-[30px] leading-tight tabular-nums min-[1024px]:text-[26px]">{t.cancelled_n} {t.cancelled_n === 1 ? "order" : "orders"}</span>
          <span className={under}>
            {t.cancelled_n === 0 ? "None" : join(formatKes(t.cancelled_kes), t.cancelled_paid_n > 0 && `${t.cancelled_paid_n} ${t.cancelled_paid_n === 1 ? "was" : "were"} paid, ${t.cancelled_with_note_n} credit ${t.cancelled_with_note_n === 1 ? "note" : "notes"}`)}
          </span>
        </div>
      </div>
      <p className="text-[13px] font-medium text-ink-soft">Sales count the day ordered; Money in counts the day paid.</p>
      <p className="-mt-1 text-[13px] font-medium text-ink-soft">{c ? compareLabel(period, today) : "No earlier figures"}</p>
    </section>
  );
}
