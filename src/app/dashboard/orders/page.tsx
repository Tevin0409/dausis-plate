import { BoardFilters, BoardLayout, DoneList, Freshness, type Column } from "@/components/dashboard/board-layout";
import { BoardNotices } from "@/components/dashboard/board-notices";
import { LiveOrders } from "@/components/dashboard/live-orders";
import { TableRequests } from "@/components/dashboard/table-requests";
import { openRequests } from "@/lib/table-requests";
import { DoneRow, Ticket, type BoardOrder } from "@/components/dashboard/ticket";
import { doneRows, HEAD, OPEN, sortColumn, TITLES, type Mode, type Status } from "@/lib/board";
import { nairobiToday } from "@/lib/format";
import { closingTime, statusStrip } from "@/lib/kitchen";
import { getKitchen } from "@/lib/kitchen-server";
import { createClient } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

const SELECT =
  "id, code, status, mode, payment_method, payment_status, paid_with, total_kes, created_at, status_changed_at, pickup_at, delivery_address, delivery_notes, customer_name, customer_phone, table:dining_tables(label), zone:delivery_zones(name), items:order_items(name, option_label, quantity, note, extras:order_item_extras(label, sort_order)), " +
  // 2.11: the code and its saving, and each combo with its dishes in the combo's order.
  "discount_kes, discount_code, combos:order_combos!order_combos_order_id_fkey(name, quantity, sort_order, combo:combos(parts:combo_items(dish_id, sort_order)), " +
  "items:order_items(dish_id, name, option_label, quantity, note, extras:order_item_extras(label, sort_order)))";

const EMPTY: Record<string, string> = {
  new: "No new orders",
  preparing: "Nothing cooking",
  ready: "Nothing ready",
  on_the_way: "No deliveries out",
  completed: "Nothing done yet today",
};
const FOR: Record<Mode, string> = { dine_in: " for dine-in", pickup: " for pickup", delivery: " for delivery" };

const headerDate = (now: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "short" }).format(now);

/** "Open until 21:00", or 2.2's closed line. Null if the kitchen status can't be read. */
async function kitchenLine() {
  try {
    const { status: s } = await getKitchen();
    return s.state === "open" && s.closes_at ? `Open until ${closingTime(s.closes_at)}` : statusStrip(s);
  } catch {
    return null;
  }
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: modeParam } = await searchParams;
  const mode: Mode | null = modeParam === "dine_in" || modeParam === "pickup" || modeParam === "delivery" ? modeParam : null;
  const supabase = await createClient();
  const now = new Date();
  const startOfDay = new Date(`${nairobiToday(now)}T00:00:00+03:00`).toISOString();

  // Open orders of any date (they stay past midnight), and orders done since midnight by when they
  // were done. Never cancelled. All types, so New's ids for the chime ignore the filter.
  // The header's count is every order placed today, declined or cancelled included (spec; RQA24-05).
  const [rows, placedToday, kitchen, requestRows] = await Promise.all([
    supabase
      .from("orders")
      .select(SELECT)
      .or(`status.in.(${OPEN.join(",")}),and(status.eq.completed,status_changed_at.gte.${startOfDay})`)
      .neq("status", "cancelled")
      // A combo's dishes are under the combo, not among the order's own lines.
      .is("items.order_combo_id", null)
      .order("created_at", { ascending: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", startOfDay),
    kitchenLine(),
    supabase.rpc("open_table_requests"),
  ]);
  // spec-2.9: the first paint has the requests; a failed read leaves it to the 10 s poll.
  const requests = requestRows.error ? null : (openRequests.safeParse(requestRows.data ?? []).data ?? null);
  if (requestRows.error) console.error("[db] open_table_requests failed:", requestRows.error.code ?? "", requestRows.error.message);
  const all = must(rows, "the board’s orders") as unknown as BoardOrder[];
  const todayCount = placedToday.error ? null : (placedToday.count ?? 0);
  if (placedToday.error) console.error("[db] counting today’s orders failed:", placedToday.error.code ?? "", placedToday.error.message);

  const shown = mode ? all.filter((o) => o.mode === mode) : all;
  const of = (s: Status) => shown.filter((o) => o.status === s);
  const empty = (s: Status) => `${EMPTY[s]}${mode ? FOR[mode] : ""}.`;

  const columns: Column[] = OPEN.map((s) => {
    const list = sortColumn(of(s));
    return {
      status: s,
      count: list.length,
      node: (
        <>
          <div className={`sticky top-0 z-10 bg-cream pb-0.5 ${s === "new" ? "hidden min-[600px]:block" : "hidden min-[1280px]:block"}`}>
            <h2 className={`flex min-h-11 items-center justify-between rounded-[var(--r-md)] px-3.5 text-base font-bold ${HEAD[s]}`}>
              {TITLES[s]}
              <span className="tabular-nums">{list.length}</span>
            </h2>
          </div>
          {list.length === 0 ? (
            <p className="px-1 py-2 text-[15px] text-ink-soft">{empty(s)}</p>
          ) : (
            list.map((o) => <Ticket key={o.id} o={o} now={now} />)
          )}
        </>
      ),
    };
  });

  const done = doneRows(of("completed"));
  const unpaid = done.filter((o) => o.payment_status !== "paid").length;
  columns.push({
    status: "completed",
    count: done.length,
    node: (
      <>
        <h2 className="flex min-h-11 flex-wrap items-center gap-x-3 px-1 text-base font-bold">
          <span>
            Done today · <span className="tabular-nums">{done.length}</span>
          </span>
          {unpaid > 0 && <span className="text-sm font-bold text-amber-ink">{unpaid} not paid yet</span>}
        </h2>
        {done.length === 0 ? (
          <p className="px-1 py-2 text-[15px] text-ink-soft">{empty("completed")}</p>
        ) : (
          <DoneList rows={done.map((o) => ({ id: o.id, node: <DoneRow key={o.id} o={o} /> }))} />
        )}
      </>
    ),
  });

  const keys = shown.map((o) => `${o.status}:${o.id}`);
  const newOrderIds = all.filter((o) => o.status === "new").map((o) => o.id);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 min-[1280px]:flex-row min-[1280px]:items-end min-[1280px]:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] leading-tight">Orders</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-soft">
            <span>
              {headerDate(now)}
              {kitchen && ` · ${kitchen}`}
              {todayCount !== null && ` · ${todayCount === 1 ? "1 order" : `${todayCount} orders`} today`}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden="true">·</span>
              <Freshness renderedAt={now.toISOString()} />
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoardFilters />
          <LiveOrders newOrderIds={newOrderIds} />
        </div>
      </header>

      <BoardNotices>
        <TableRequests initial={requests} />
        <BoardLayout columns={columns} keys={keys} />
      </BoardNotices>
    </div>
  );
}
