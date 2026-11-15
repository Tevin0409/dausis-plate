"use client";
// The open section's cards (spec-2.12 "Sections"). Client components so the charts and tables can carry
// their tooltips, sorting and row taps; they get plain data from the server page.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { rankDishes } from "@/lib/reports/rank";
import { addDays, formatKes, weekStart } from "@/lib/format";
import { StarRow } from "@/components/shop/rating-card";
import { dishLine, ratingsHref, sentLabel, starsWord } from "@/lib/ratings";
import { creditNoteAmount, drawerLine, netOf, plainSigned } from "@/lib/reports/money";
import { bucketLabel, daysIn, grainFor, periodLabel, shortDay, type Period } from "@/lib/reports/period";
import { amountSort, amountTotal, runLabel, tapRate } from "@/lib/reports/promos";
import {
  CANCEL_LABEL, MODE_LABEL, PAY_CHOICE_LABEL, WEEKDAY_LONG, WEEKDAY_SHORT, hourLabel, minutesLabel,
  type DeliveryReport, type DishesReport, type DishRow, type PromosReport, type RatingsReport, type SalesReport, type TimesReport,
} from "@/lib/reports/types";
import { BarChart, ChartCard, ChartTable, HBarChart, HeatGrid, LineChart, Meter, type Col } from "./charts";
import { AdsRunChoice, DownloadLink } from "./controls";

const nb = (n: number) => new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(n);
const plural = (n: number, one: string, many = `${one}s`) => `${nb(n)} ${n === 1 ? one : many}`;
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const DAYFMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" });
const stamp = (iso: string) => `${shortDay(DAYFMT.format(new Date(iso)))} ${TIME.format(new Date(iso))}`;

/** A card that isn't a chart. */
export function Card({ title, note, children, wide, className = "" }: { title: string; note?: React.ReactNode; children: React.ReactNode; wide?: boolean; className?: string }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-paper p-4 min-[600px]:p-5 ${wide ? "min-[1024px]:col-span-2" : ""} ${className}`}>
      <h3 className="text-base font-bold">{title}</h3>
      {note && <p className="-mt-1.5 text-[13px] text-ink-soft">{note}</p>}
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] text-ink-soft">{children}</p>;

/** A card whose data failed to load: its own message and Retry; the other cards still show. */
export function CardError({ title, message }: { title: string; message: string }) {
  const router = useRouter();
  return (
    <Card title={title}>
      <p role="alert" className="text-[14px] font-semibold text-coral-ink">{message}</p>
      <button type="button" onClick={() => router.refresh()} className="press min-h-11 self-start rounded-full px-5 text-[15px] font-bold text-ink ring-[1.5px] ring-sand-deep ring-inset touch-manipulation">Retry</button>
    </Card>
  );
}

/** Opens the order sheet: the URL gets &order=DP-0107, so Back closes it. */
function useOpenOrder() {
  const router = useRouter();
  const sp = useSearchParams();
  return (code: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("order", code);
    router.push(`/dashboard/reports?${q}`, { scroll: false });
  };
}

const noOrders = (p: Period, today: string) => `No orders ${p.from === p.to ? `on ${periodLabel(p, today)}` : `between ${periodLabel(p, today).replace(" – ", " and ")}`}`;

// ───────────────────────── Sales & money ─────────────────────────
export function SalesSection({ d, period, today }: { d: SalesReport; period: Period; today: string }) {
  const open = useOpenOrder();
  const t = d.tiles;
  const oneDay = period.from === period.to;
  const empty = t.orders === 0 && t.cancelled_n === 0 && t.payments_n === 0 && d.credit_notes.length === 0 && d.paid_cancelled_open.length === 0;
  if (empty) return <Empty>{noOrders(period, today)}</Empty>;

  const grain = grainFor(period.from, period.to);
  const salesData = oneDay
    ? d.by_hour.map((h) => ({ key: String(h.hour), label: hourLabel(h.hour), short: String(h.hour), value: h.sales, tip: `${hourLabel(h.hour)} · ${formatKes(h.sales)} · ${plural(h.orders, "order")}` }))
    : d.by_bucket.map((b) => ({ key: b.bucket, label: bucketLabel(grain, b.bucket), short: bucketLabel(grain, b.bucket, true), value: b.sales, tip: `${bucketLabel(grain, b.bucket)} · ${formatKes(b.sales)} · ${plural(b.orders, "order")}` }));
  // Days with no orders have no bar; fill them in so the axis is honest and the tooltip says so.
  const filled = oneDay || grain !== "day" ? salesData : fillDays(period, salesData);
  const title = oneDay ? "Sales by hour, KSh" : `Sales by ${grain}, KSh`;

  const salesCols: Col<(typeof d.by_bucket)[number]>[] = [
    { key: "d", head: grain === "day" ? "Day" : grain === "week" ? "Week" : "Month", cell: (r) => bucketLabel(grain, r.bucket), sticky: true, sort: (r) => r.bucket },
    { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true, sort: (r) => r.orders },
    { key: "f", head: "Food", cell: (r) => nb(r.food), num: true, sort: (r) => r.food },
    { key: "di", head: "Discounts", cell: (r) => (r.discounts ? `−${nb(r.discounts)}` : "0"), num: true, sort: (r) => r.discounts },
    { key: "fe", head: "Delivery fees", cell: (r) => nb(r.fees), num: true, sort: (r) => r.fees },
    { key: "s", head: "Sales", cell: (r) => nb(r.sales), num: true, sort: (r) => r.sales },
  ];
  const hourCols: Col<(typeof d.by_hour)[number]>[] = [
    { key: "h", head: "Hour", cell: (r) => hourLabel(r.hour), sticky: true },
    { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true },
    { key: "s", head: "Sales", cell: (r) => nb(r.sales), num: true },
  ];

  // Money in table: optional columns appear only when the period has some.
  const m = d.money_in;
  const any = (k: "mpesa_online" | "card" | "not_recorded" | "credit_notes_voided") => m.some((r) => r[k] > 0);
  const sum = (k: keyof (typeof m)[number]) => m.reduce((n, r) => n + Number(r[k]), 0);
  const moneyCols: Col<(typeof m)[number]>[] = [
    { key: "d", head: grain === "day" ? "Day" : grain === "week" ? "Week" : "Month", cell: (r) => bucketLabel(grain, r.bucket), sticky: true, total: "Total" },
    { key: "c", head: "Cash", cell: (r) => nb(r.cash), num: true, total: nb(sum("cash")) },
    { key: "m", head: "M-Pesa", cell: (r) => nb(r.mpesa), num: true, total: nb(sum("mpesa")) },
    ...(any("mpesa_online") ? [{ key: "mo", head: "M-Pesa online", cell: (r: (typeof m)[number]) => nb(r.mpesa_online), num: true, total: nb(sum("mpesa_online")) }] : []),
    ...(any("card") ? [{ key: "ca", head: "Card", cell: (r: (typeof m)[number]) => nb(r.card), num: true, total: nb(sum("card")) }] : []),
    ...(any("not_recorded") ? [{ key: "nr", head: "Not recorded", cell: (r: (typeof m)[number]) => nb(r.not_recorded), num: true, total: nb(sum("not_recorded")) }] : []),
    { key: "cn", head: "Credit notes", cell: (r) => plainSigned(r.credit_notes, "-"), num: true, total: plainSigned(sum("credit_notes"), "-") },
    ...(any("credit_notes_voided") ? [{ key: "cv", head: "Credit notes voided", cell: (r: (typeof m)[number]) => plainSigned(r.credit_notes_voided, "+"), num: true, total: plainSigned(sum("credit_notes_voided"), "+") }] : []),
    { key: "n", head: "Net", cell: (r) => <span className="font-bold">{plainSigned(netOf(r))}{plainSigned(netOf(r)) === "" ? "0" : ""}</span>, num: true, total: plainSigned(m.reduce((n, r) => n + netOf(r), 0)) || "0" },
  ];
  const legacy = m.reduce((n, r) => n + r.legacy_n, 0);

  const modeData = d.by_mode.map((r) => ({ key: r.mode, label: MODE_LABEL[r.mode] ?? r.mode, value: r.orders, end: `${plural(r.orders, "order")} · ${formatKes(r.sales)}`, tip: `${MODE_LABEL[r.mode] ?? r.mode} · ${plural(r.orders, "order")} · ${formatKes(r.sales)}` }));
  const cancelData = d.cancellations.by_reason.map((r) => ({ key: r.reason, label: CANCEL_LABEL[r.reason] ?? r.reason, value: r.orders, end: `${plural(r.orders, "order")} · ${formatKes(r.kes)}`, tip: `${CANCEL_LABEL[r.reason] ?? r.reason} · ${plural(r.orders, "order")} · ${formatKes(r.kes)}` }));

  return (
    <div className="grid grid-cols-1 gap-3.5 min-[1024px]:grid-cols-2">
      <ChartCard
        id={`sales-${oneDay ? "hour" : grain}`}
        title={title}
        className="min-[1024px]:col-span-2"
        note={
          <span className="flex flex-wrap gap-x-4">
            <DownloadLink section="orders" period={period}>Orders (CSV)</DownloadLink>
            <DownloadLink section="credit-notes" period={period}>Credit notes (CSV)</DownloadLink>
          </span>
        }
        chart={salesData.length === 0 ? <Empty>No orders in this period.</Empty> : <BarChart data={filled} title={title} height={200} />}
        table={oneDay ? <ChartTable cols={hourCols} rows={d.by_hour} rowKey={(r) => String(r.hour)} caption={title} /> : <ChartTable cols={salesCols} rows={d.by_bucket} rowKey={(r) => r.bucket} caption={title} defaultSort={{ key: "d", dir: "asc" }} />}
      />

      <Card title="Money in" wide note={grain === "day" && !oneDay ? "Counted on the day it was paid." : undefined}>
        {oneDay && from(period.from, today) && <p className="text-[14px] leading-snug tabular-nums">{drawerLine(m[0])}</p>}
        {m.length === 0 ? <Empty>No payments{oneDay ? "" : " in this period"}.</Empty> : <ChartTable cols={moneyCols} rows={m} rowKey={(r) => r.bucket} caption="Money in by day" footer={m.length > 1} />}
        {legacy > 0 && <p className="text-[13px] text-ink-soft">Before 8 Nov, payments count on the day ordered.</p>}
      </Card>

      <Card title="Still to collect" note={t.to_collect_n > 0 ? `${plural(t.to_collect_n, "order")} · ${formatKes(t.to_collect_kes)}` : undefined}>
        {d.to_collect.length === 0 ? (
          <Empty>Everything in this period is paid.</Empty>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line">
              {d.to_collect.slice(0, 10).map((o) => (
                <li key={o.code} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-[14px]">
                  <span><strong className="tabular-nums">{o.code}</strong> · <span className="text-ink-soft tabular-nums">{stamp(o.created_at)}</span></span>
                  <span className="tabular-nums"><span className="text-ink-soft">{MODE_LABEL[o.mode] ?? o.mode}{o.table ? ` ${o.table}` : ""}</span> · <strong>{formatKes(o.total)}</strong></span>
                </li>
              ))}
            </ul>
            {t.to_collect_n > 10 && <p className="text-[13px] text-ink-soft">and {t.to_collect_n - 10} more, in the orders download.</p>}
          </>
        )}
      </Card>

      <Card title="Paid, then cancelled, no credit note" note="From any date.">
        {d.paid_cancelled_open.length === 0 ? (
          <Empty>No paid orders waiting for a decision.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {d.paid_cancelled_open.map((o) => (
              <li key={o.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[14px]">
                <span className="min-w-0">
                  <strong className="tabular-nums">{o.code}</strong> · <span className="tabular-nums">{formatKes(o.total)}</span>
                  <span className="block text-[13px] text-ink-soft">Paid {stamp(o.paid_at)}{o.reason ? ` · ${CANCEL_LABEL[o.reason] ?? o.reason}` : ""}</span>
                </span>
                <button type="button" onClick={() => open(o.code)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink ring-[1.5px] ring-sand-deep ring-inset touch-manipulation focus-visible:outline-2 focus-visible:outline-teal-deep">Credit note…</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Credit notes" wide>
        {d.credit_notes.length === 0 ? (
          <Empty>No credit notes in this period.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {[...d.credit_notes].reverse().map((c) => (
              <li key={c.code}>
                <button type="button" onClick={() => open(c.order)} className={`flex min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left text-[14px] touch-manipulation focus-visible:outline-2 focus-visible:outline-teal-deep ${c.voided_at ? "text-ink-soft" : ""}`}>
                  <span className="flex flex-wrap items-center gap-x-2">
                    <strong className="tabular-nums">{c.code}</strong>
                    {c.voided_at && <span className="inline-flex min-h-5 items-center rounded-full bg-sand px-2 text-[12px] font-bold">Void</span>}
                    <span className="tabular-nums">{c.order} · {creditNoteAmount(c.amount, c.order_total)} · {c.refunded_with === "cash" ? "Cash" : "M-Pesa"}</span>
                  </span>
                  <span className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">{stamp(c.issued_at)} · {c.reason}</span>
                  {c.voided_at && <span className="text-[13px] text-ink-soft tabular-nums">Voided {stamp(c.voided_at)} · +{nb(c.amount)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Paid and not paid" note="How customers chose to pay.">
        {d.by_payment_method.length === 0 ? <Empty>No orders in this period.</Empty> : <ChartTable
          caption="Paid and not paid"
          rows={d.by_payment_method}
          rowKey={(r) => r.method}
          cols={[
            { key: "m", head: "Chose", cell: (r) => PAY_CHOICE_LABEL[r.method] ?? r.method, sticky: true },
            { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true },
            { key: "p", head: "Paid", cell: (r) => nb(r.paid), num: true },
            { key: "n", head: "Not paid", cell: (r) => nb(r.not_paid), num: true },
          ]}
        />}
      </Card>

      <ChartCard
        id="modes"
        title="Order types"
        chart={modeData.length === 0 ? <Empty>No orders in this period.</Empty> : <HBarChart data={modeData} title="Order types" />}
        table={<ChartTable caption="Order types" rows={d.by_mode} rowKey={(r) => r.mode} cols={[{ key: "m", head: "Type", cell: (r) => MODE_LABEL[r.mode] ?? r.mode, sticky: true }, { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true }, { key: "s", head: "Sales", cell: (r) => nb(r.sales), num: true }]} />}
      />

      <ChartCard
        id="cancellations"
        title="Cancellations"
        className="min-[1024px]:col-span-2"
        note={t.cancelled_n > 0 ? `${plural(t.cancelled_n, "order")} · ${formatKes(t.cancelled_kes)}` : undefined}
        chart={cancelData.length === 0 ? <Empty>No cancellations in this period.</Empty> : <HBarChart data={cancelData} title="Cancellations by reason" />}
        table={
          d.cancellations.orders.length === 0 ? (
            <Empty>No cancellations in this period.</Empty>
          ) : (
            <ChartTable
              caption="Cancelled orders"
              rows={d.cancellations.orders}
              rowKey={(r) => r.code}
              onRow={(r) => open(r.code)}
              rowLabel={(r) => `Open ${r.code}`}
              cols={[
                { key: "c", head: "Order", cell: (r) => r.code, sticky: true },
                { key: "t", head: "Time", cell: (r) => stamp(r.created_at) },
                { key: "k", head: "Total", cell: (r) => nb(r.total), num: true },
                { key: "r", head: "Reason", cell: (r) => (r.reason ? CANCEL_LABEL[r.reason] ?? r.reason : CANCEL_LABEL.none) },
                { key: "n", head: "Note", cell: (r) => r.note ?? "" },
                { key: "p", head: "Paid", cell: (r) => (r.paid ? "Paid" : "") },
                { key: "cn", head: "Credit note", cell: (r) => r.credit_note ?? "" },
              ]}
            />
          )
        }
      />
    </div>
  );
}

const from = (day: string, today: string) => day === today;

/** One entry per day in the period, with "No orders" tooltips for the empty ones. */
function fillDays(p: Period, rows: { key: string; label: string; short?: string; value: number; tip: string }[]) {
  const by = new Map(rows.map((r) => [r.key, r]));
  const out: typeof rows = [];
  for (let d = p.from, i = 0; d <= p.to && i < 400; i++) {
    out.push(by.get(d) ?? { key: d, label: bucketLabel("day", d), short: bucketLabel("day", d, true), value: 0, tip: `${bucketLabel("day", d)} · No orders` });
    const n = new Date(`${d}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  return out;
}

// ───────────────────────── Dishes ─────────────────────────

export function DishesSection({ d, period, today }: { d: DishesReport; period: Period; today: string }) {
  const [openDish, setOpenDish] = useState<string | null>(null);
  if (d.dishes.length === 0) return <Empty>{noOrders(period, today)}</Empty>;
  const { ranked, best, slow } = rankDishes(d.dishes);
  const rankLine = (r: DishRow) => `${r.per_day} plates a day · ${plural(r.days_on, "day")} on the menu`;
  const dayRows = openDish ? d.days.filter((x) => x.dish === openDish) : [];
  const cols: Col<DishRow>[] = [
    {
      key: "n", head: "Dish", sticky: true, sort: (r) => r.name,
      cell: (r) => (
        <button type="button" aria-expanded={openDish === r.name} onClick={() => setOpenDish((v) => (v === r.name ? null : r.name))} className="min-h-11 text-left font-semibold text-teal-deep focus-visible:outline-2 focus-visible:outline-teal-deep [&:hover]:underline">{r.name}</button>
      ),
    },
    { key: "p", head: "Plates", cell: (r) => nb(r.plates), num: true, sort: (r) => r.plates },
    { key: "d", head: "Days on", cell: (r) => nb(r.days_on), num: true, sort: (r) => r.days_on },
    { key: "pd", head: "Per day", cell: (r) => (r.per_day === null ? "—" : String(r.per_day)), num: true, sort: (r) => r.per_day ?? -1 },
    { key: "l", head: "Limit used", cell: (r) => (r.limit_avg === null || r.limit_used_avg === null ? "—" : <Meter value={r.limit_used_avg} max={r.limit_avg} label={`${r.limit_used_avg} of ${r.limit_avg}`} />), sort: (r) => (r.limit_avg ? (r.limit_used_avg ?? 0) / r.limit_avg : -1) },
    { key: "s", head: "Sold out", cell: (r) => (r.sold_out_days > 0 ? `${r.sold_out_days} of ${r.limit_days ?? r.days_on} days${r.usual_sold_out_minutes !== null ? ` · usually ${minutesLabel(r.usual_sold_out_minutes)}` : ""}` : "—"), sort: (r) => r.sold_out_days },
    { key: "r", head: "Dish sales", cell: (r) => nb(r.revenue), num: true, sort: (r) => r.revenue },
    { key: "ra", head: "Rating", cell: (r) => ratingCell(r), num: true, sort: (r) => (r.rating_avg === null ? -1 : r.rating_avg + r.rating_count / 1e6) },
  ];
  const List = ({ title, rows, none }: { title: string; rows: DishRow[]; none: string }) => (
    <Card title={title}>
      {rows.length === 0 ? <Empty>{none}</Empty> : (
        <ol className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col py-2 text-[14px]"><strong className="[overflow-wrap:anywhere]">{r.name}</strong><span className="text-[13px] text-ink-soft tabular-nums">{rankLine(r)}</span></li>
          ))}
        </ol>
      )}
    </Card>
  );
  const none = "Too few days to rank. Pick a longer period.";
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 min-[768px]:grid-cols-2">
        <List title="Best this period" rows={best} none={none} />
        <List title="Slowest this period" rows={slow} none={ranked.length ? "Not enough dishes to rank a slowest list." : none} />
      </div>
      <Card title="All dishes" note="Tap a dish to see its days.">
        <ChartTable cols={cols} rows={d.dishes} rowKey={(r) => r.id} caption="All dishes" defaultSort={{ key: "p", dir: "desc" }} />
        {openDish && (
          <div className="rounded-[var(--r-md)] bg-mist p-3">
            <h4 className="mb-1 text-[14px] font-bold">{openDish}, day by day</h4>
            {dayRows.length === 0 ? <Empty>No days on the menu in this period.</Empty> : (
              <ChartTable
                caption={`${openDish} by day`}
                rows={dayRows}
                rowKey={(r) => r.day}
                cols={[
                  { key: "d", head: "Day", cell: (r) => shortDay(r.day), sticky: true },
                  { key: "p", head: "Plates", cell: (r) => (r.limit === null ? nb(r.plates) : `${r.plates} of ${r.limit}`), num: true },
                  { key: "s", head: "Sold out", cell: (r) => (r.sold_out_minutes === null ? "—" : `${minutesLabel(r.sold_out_minutes)}${r.back_on ? " · then back on" : ""}`) },
                ]}
              />
            )}
          </div>
        )}
        <p className="text-[13px] text-ink-soft">Dish sales leave out combo prices; see Promos &amp; ads. Sold-out times are kept from 8 Nov.</p>
      </Card>
    </div>
  );
}

// ───────────────────────── Busy times ─────────────────────────
export function TimesSection({ d, period, today }: { d: TimesReport; period: Period; today: string }) {
  if (d.by_hour.length === 0) return <Empty>{noOrders(period, today)}</Empty>;
  const lo = Math.min(...d.by_hour.map((h) => h.hour));
  const hi = Math.max(...d.by_hour.map((h) => h.hour));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const byH = new Map(d.by_hour.map((h) => [h.hour, h]));
  const bars = hours.map((h) => {
    const v = byH.get(h)?.per_day ?? 0;
    return { key: String(h), label: hourLabel(h), short: String(h), value: v, tip: `${hourLabel(h)} · ${v} orders a day on average` };
  });
  const wide = d.days >= 14;
  const top = [...d.by_weekday_hour].sort((a, b) => b.avg - a.avg)[0];
  const topHour = [...d.by_hour].sort((a, b) => b.per_day - a.per_day)[0]!;
  const line = wide && top
    ? `Busiest: ${WEEKDAY_SHORT[top.weekday]} ${hourLabel(top.hour)}–${hourLabel(top.hour + 1)}, ${top.avg} orders on average.`
    : `Busiest: ${hourLabel(topHour.hour)}–${hourLabel(topHour.hour + 1)}, ${topHour.per_day} orders a day on average.`;
  const cells = d.by_weekday_hour.map((c) => ({ weekday: c.weekday, hour: c.hour, avg: c.avg, tip: `${WEEKDAY_LONG[c.weekday]} ${hourLabel(c.hour)} · ${c.avg} orders on average` }));
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[15px] font-semibold">{line}</p>
      <div className="grid grid-cols-1 gap-3.5 min-[1024px]:grid-cols-2">
        <ChartCard
          id="busy-hours"
          title="Busiest hours, orders a day"
          chart={<BarChart data={bars} tone="coral" title="Busiest hours" />}
          table={<ChartTable caption="Busiest hours" rows={d.by_hour} rowKey={(r) => String(r.hour)} cols={[{ key: "h", head: "Hour", cell: (r) => hourLabel(r.hour), sticky: true }, { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true }, { key: "p", head: "Per day", cell: (r) => String(r.per_day), num: true }]} />}
        />
        <ChartCard
          id="week-glance"
          title="Week at a glance"
          chart={wide ? <HeatGrid cells={cells} hours={hours} weekdays={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, label: WEEKDAY_SHORT[n]! }))} title="Orders by weekday and hour" /> : <Empty>Pick 2 weeks or more to compare weekdays.</Empty>}
          table={wide ? <ChartTable caption="Weekday by hour" rows={d.by_weekday_hour} rowKey={(r) => `${r.weekday}-${r.hour}`} cols={[{ key: "w", head: "Weekday", cell: (r) => WEEKDAY_LONG[r.weekday], sticky: true }, { key: "h", head: "Hour", cell: (r) => hourLabel(r.hour) }, { key: "a", head: "Orders on average", cell: (r) => String(r.avg), num: true }]} /> : <Empty>Pick 2 weeks or more to compare weekdays.</Empty>}
        />
      </div>
    </div>
  );
}

// ───────────────────────── Delivery & tables ─────────────────────────
export function DeliverySection({ d, period, today }: { d: DeliveryReport; period: Period; today: string }) {
  const zones = d.zones.map((z) => ({ key: z.zone, label: z.zone, value: z.orders, end: `${plural(z.orders, "order")} · fees ${formatKes(z.fees)}`, tip: `${z.zone} · ${plural(z.orders, "order")} · fees ${formatKes(z.fees)} · food ${formatKes(z.food)}${z.discounts ? ` · discounts −${formatKes(z.discounts)}` : ""}` }));
  return (
    <div className="grid grid-cols-1 gap-3.5 min-[1024px]:grid-cols-2">
      <ChartCard
        id="delivery"
        title="Delivery by area"
        chart={zones.length === 0 ? <Empty>No delivery orders {period.from === period.to ? `on ${periodLabel(period, today)}` : "in this period"}.</Empty> : <HBarChart data={zones} title="Delivery by area" />}
        table={<ChartTable caption="Delivery by area" rows={d.zones} rowKey={(r) => r.zone} cols={[{ key: "z", head: "Area", cell: (r) => r.zone, sticky: true }, { key: "o", head: "Orders", cell: (r) => nb(r.orders), num: true }, { key: "f", head: "Fees", cell: (r) => nb(r.fees), num: true }, { key: "fo", head: "Food", cell: (r) => nb(r.food), num: true }, { key: "di", head: "Discounts", cell: (r) => (r.discounts ? `−${nb(r.discounts)}` : "0"), num: true }]} />}
      />
      <Card title="Table requests"><Empty>No table requests in this period.</Empty></Card>
    </div>
  );
}

/** "4.6 ★ · 12": the period's not-hidden ratings on orders with the dish, from the 1st (Mama's own view). */
function ratingCell(r: DishRow) {
  if (r.rating_avg === null || r.rating_count === 0) return "—";
  return (
    <span className="whitespace-nowrap">
      {Number(r.rating_avg).toFixed(1)} <span aria-hidden="true" className="text-amber">★</span>
      <span className="sr-only"> stars</span> · {nb(r.rating_count)}
      <span className="sr-only"> {r.rating_count === 1 ? "rating" : "ratings"}</span>
    </span>
  );
}

// ───────────────────────── Ratings ─────────────────────────
const hiddenTail = (n: number) => (n > 0 ? `\u00a0·\u00a0${nb(n)}\u00a0hidden` : "");

export function RatingsSection({ d, period, today }: { d: RatingsReport; period: Period; today: string }) {
  const open = useOpenOrder();
  if (d.count === 0 && d.hidden === 0) return <Empty>No ratings {period.from === period.to ? `on ${periodLabel(period, today)}` : "in this period"}.</Empty>;

  // One slot per week (Mondays) the period touches; a week with no counted ratings is a gap.
  const showWeeks = daysIn(period.from, period.to) >= 21 && d.count > 0;
  const byWeek = new Map(d.by_week.map((w) => [w.week, w]));
  const weeks: string[] = [];
  for (let w = weekStart(period.from); w <= period.to; w = addDays(w, 7)) weeks.push(w);
  const points = weeks.map((w) => {
    const r = byWeek.get(w);
    return {
      key: w,
      label: bucketLabel("week", w),
      short: bucketLabel("week", w, true),
      value: r ? Number(r.avg) : null,
      tip: r ? `${bucketLabel("week", w)} · ${Number(r.avg).toFixed(1)} ★ · ${plural(r.count, "rating")}` : `${bucketLabel("week", w)} · No ratings`,
    };
  });
  const allRatings = ratingsHref("all", { from: period.from, to: period.to });

  return (
    <div className="grid grid-cols-1 gap-3.5 min-[1024px]:grid-cols-2">
      <Card title="Average rating" note="Hidden ratings are left out, as on the menu. Counted on the day each was sent.">
        {d.count === 0 || d.avg === null ? (
          <p className="text-[17px] font-semibold tabular-nums">No ratings counted{hiddenTail(d.hidden)}</p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
            <span className="font-display text-[34px] leading-none">
              {Number(d.avg).toFixed(1)}
              <span aria-hidden="true" className="ml-1 text-[28px] text-amber">★</span>
              <span className="sr-only"> stars</span>
            </span>
            <span className="text-[15px] font-semibold text-ink-soft">from {plural(d.count, "rating")}{hiddenTail(d.hidden)}</span>
          </p>
        )}
      </Card>
      <Card title="Replies">
        <p className="text-[17px] font-semibold tabular-nums">
          {d.with_comment === 0 ? "No comments in this period." : `Replied to ${nb(d.replied)} of ${plural(d.with_comment, "comment")}.`}
        </p>
      </Card>

      {showWeeks && (
        <ChartCard
          id="ratings-week"
          className="min-[1024px]:col-span-2"
          title="Ratings by week, average stars"
          note="Weeks start on Monday. A week with no ratings is left as a gap."
          chart={<LineChart data={points} title="Ratings by week" />}
          table={
            <ChartTable
              caption="Ratings by week"
              rows={points}
              rowKey={(r) => r.key}
              cols={[
                { key: "w", head: "Week", cell: (r) => r.label, sticky: true },
                { key: "a", head: "Average stars", cell: (r) => (r.value === null ? "—" : r.value.toFixed(1)), num: true },
                { key: "n", head: "Ratings", cell: (r) => nb(byWeek.get(r.key)?.count ?? 0), num: true },
              ]}
            />
          }
        />
      )}

      <Card title="Recent comments" wide note={d.recent.length === 10 ? "The latest 10 with a comment." : undefined}>
        {d.recent.length === 0 ? <Empty>No comments in this period.</Empty> : (
          <ol className="flex flex-col divide-y divide-line">
            {d.recent.map((r) => (
              <li key={`${r.code}${r.sent_at}`} data-hidden={r.hidden ? "" : undefined} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="rating-dim inline-flex items-center gap-2">
                    <StarRow stars={r.stars} size={15} />
                    <span className="sr-only">{starsWord(r.stars)}.</span>
                  </span>
                  <span className="rating-dim text-[13px] text-ink-soft tabular-nums">
                    {sentLabel(r.sent_at)} ·{" "}
                    <button type="button" onClick={() => open(r.code)} className="press inline-flex min-h-11 items-center font-semibold text-teal-deep focus-visible:outline-2 focus-visible:outline-teal-deep [&:hover]:underline" aria-label={`Open order ${r.code}`}>{r.code}</button>
                  </span>
                  {r.hidden && <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold text-ink-soft">Hidden · not in the averages</span>}
                </div>
                <div className="rating-dim flex flex-col gap-1.5">
                  {r.dishes.length > 0 && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">{dishLine(r.dishes)}</p>}
                  <blockquote className="whitespace-pre-line text-[15px] leading-relaxed [overflow-wrap:anywhere]">“{r.comment}”</blockquote>
                  {r.reply && (
                    <div className="rounded-xl bg-teal-tint p-3.5">
                      <p className="text-[13px] font-semibold text-ink-soft">Your reply{r.replied_at ? ` · ${sentLabel(r.replied_at)}` : ""}</p>
                      <p className="mt-1 whitespace-pre-line text-[15px] [overflow-wrap:anywhere]">{r.reply}</p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <Link href={allRatings} className="press -mb-1 inline-flex min-h-11 items-center self-start text-[14px] font-semibold text-teal-deep focus-visible:outline-2 focus-visible:outline-teal-deep touch-manipulation [&:hover]:underline">
          All ratings in this period
        </Link>
      </Card>
    </div>
  );
}

// ───────────────────────── Promos & ads (2.11) ─────────────────────────
const SPACE_LABEL: Record<string, string> = { menu: "Menu", order: "Order page" };
/** Taps ÷ views, one decimal place; not shown under 50 views (spec-2.12). */
export function PromosSection({ d, period, today }: { d: PromosReport; period: Period; today: string }) {
  const inPeriod = period.from === period.to ? `on ${periodLabel(period, today)}` : "in this period";
  const codeCols: Col<PromosReport["codes"][number]>[] = [
    {
      key: "c", head: "Code", sticky: true, sort: (r) => r.code,
      cell: (r) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          {r.code}
          {!r.active && <span className="inline-flex min-h-5 items-center rounded-full bg-sand px-2 text-[12px] font-bold text-ink-soft">Off</span>}
        </span>
      ),
    },
    { key: "u", head: "Uses", cell: (r) => nb(r.uses), num: true, sort: (r) => r.uses },
    { key: "d", head: "Discount given", cell: (r) => nb(r.discount), num: true, sort: (r) => r.discount },
    { key: "s", head: "Sales with the code", cell: (r) => nb(r.sales), num: true, sort: (r) => r.sales },
  ];
  const comboCols: Col<PromosReport["combos"][number]>[] = [
    { key: "c", head: "Combo", cell: (r) => <span className="[overflow-wrap:anywhere]">{r.combo}</span>, sticky: true, sort: (r) => r.combo },
    { key: "s", head: "Sold", cell: (r) => nb(r.sold), num: true, sort: (r) => r.sold },
    { key: "r", head: "Revenue", cell: (r) => nb(r.revenue), num: true, sort: (r) => r.revenue },
  ];
  const adCols: Col<PromosReport["ads"][number]>[] = [
    { key: "a", head: "Advertiser", cell: (r) => <span className="font-semibold [overflow-wrap:anywhere]">{r.advertiser}</span>, sticky: true, sort: (r) => r.advertiser, total: "Total" },
    { key: "sp", head: "Space", cell: (r) => <span className="whitespace-nowrap">{SPACE_LABEL[r.space] ?? r.space}</span>, sort: (r) => r.space },
    { key: "r", head: "Runs", cell: (r) => <span className="whitespace-nowrap">{runLabel(r.starts_on, r.ends_on, today)}</span>, sort: (r) => r.starts_on },
    { key: "v", head: "Views", cell: (r) => nb(r.views), num: true, sort: (r) => r.views },
    { key: "t", head: "Taps", cell: (r) => nb(r.taps), num: true, sort: (r) => r.taps },
    { key: "tr", head: "Tap rate", cell: (r) => tapRate(r.taps, r.views), num: true, sort: (r) => (r.views < 50 ? -1 : r.taps / r.views) },
    {
      key: "due",
      head: "Amount due",
      // "—": the run started before this period, so its price counts there. "Not set": an ad with no price.
      cell: (r) =>
        !r.counted_here ? (
          <><span aria-hidden="true">—</span><span className="sr-only">Counted in the period the run started</span></>
        ) : r.amount_due === null ? (
          <span className="text-ink-soft">Not set</span>
        ) : (
          nb(r.amount_due)
        ),
      num: true,
      sort: amountSort,
      total: nb(amountTotal(d.ads)),
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3.5 min-[1024px]:grid-cols-2">
      <Card title="Codes" note="Orders that weren’t cancelled.">
        {d.codes.length === 0 ? <Empty>No codes yet.</Empty> : (
          <ChartTable caption="Codes" cols={codeCols} rows={d.codes} rowKey={(r) => r.code} defaultSort={{ key: "u", dir: "desc" }} dim={(r) => r.uses === 0} />
        )}
      </Card>
      <Card title="Combos" note="Revenue is the combo price with its choices and extras.">
        {d.combos.length === 0 ? <Empty>No combos sold {inPeriod}.</Empty> : (
          <ChartTable caption="Combos" cols={comboCols} rows={d.combos} rowKey={(r) => r.combo} defaultSort={{ key: "s", dir: "desc" }} />
        )}
      </Card>
      <Card
        title="Ads, for invoicing"
        wide
        note={
          <>
            Counts are a fair guide, not an audit.
            <span className="block">{d.ads_whole_run ? "Amount due is each run’s agreed price." : "Amount due counts once, in the period the run starts."}</span>
          </>
        }
      >
        <AdsRunChoice period={period} wholeRun={d.ads_whole_run} />
        {d.ads_whole_run && <p className="text-[13px] font-semibold text-ink-soft">Ignoring the period above</p>}
        {d.ads.length === 0 ? (
          <Empty>{d.ads_whole_run ? "No ad has started yet." : `No ads ${inPeriod}. An ad shows here once it has views or its run starts ${period.from === period.to ? "that day" : "in the period"}.`}</Empty>
        ) : (
          <ChartTable caption="Ads, for invoicing" cols={adCols} rows={d.ads} rowKey={(r) => r.id} defaultSort={{ key: "v", dir: "desc" }} footer={d.ads.length > 1} />
        )}
      </Card>
    </div>
  );
}

