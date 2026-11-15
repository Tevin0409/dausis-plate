import { RefusalNote } from "@/components/dashboard/refusal-note";
import { Planner } from "@/components/dashboard/planner/planner";
import { runsOn, type PlannerData, type PlannerDay, type PlannerEntry } from "@/components/dashboard/planner/types";
import { addDays, nairobiToday, weekStart } from "@/lib/format";
import { can } from "@/lib/permissions";
import { dow, nextOpenDay, weekDays } from "@/lib/planner";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu planner" };

type Props = { searchParams: Promise<{ day?: string }> };

const ENTRY_COLUMNS =
  "id, kind, starts_on, ends_on, plates_per_day, price_kes, show_from, show_until, dish:dishes(id, name, price_kes, photo_thumb_url)" as const;

export default async function MenuPlannerPage({ searchParams }: Props) {
  const { day: dayParam } = await searchParams;
  const today = nairobiToday();
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && !Number.isNaN(Date.parse(dayParam)) ? dayParam : today;
  const monday = weekStart(day);
  const sunday = addDays(monday, 6);
  const horizon = addDays(today, 14);
  const supabase = await createClient();
  const staff = await getStaff();
  const prices = staff ? can(staff, "dishes_prices") : false;

  const [entriesResult, hoursResult, closedResult, previewResult] = await Promise.all([
    supabase
      .from("menu_entries")
      .select(ENTRY_COLUMNS)
      .eq("published", true)
      .is("ended_early_at", null)
      .lte("starts_on", sunday)
      .gte("ends_on", monday)
      .order("sort_order")
      .order("created_at"),
    supabase.from("opening_hours").select("weekday, is_open, opens, closes"),
    supabase
      .from("closed_dates")
      .select("day, note")
      .gte("day", monday < today ? monday : today)
      .lte("day", sunday > horizon ? sunday : horizon),
    supabase.rpc("copy_menu_week_preview", { p_week_start: monday }),
  ]);
  const rows = must(entriesResult, "the week’s menu");
  const hours = must(hoursResult, "the opening hours");
  const closed = new Map(must(closedResult, "the closed dates").map((c) => [c.day, c.note ?? ""]));
  const preview = (must(previewResult, "the copy counts") ?? {}) as Record<string, { prev?: number; last_week?: number }>;

  const ids = rows.map((r) => r.id);
  const [offResult, salesResult] = await Promise.all([
    ids.length ? supabase.from("menu_entry_off_days").select("entry_id, day").in("entry_id", ids) : null,
    ids.length && today >= monday && today <= sunday
      ? supabase.from("menu_entry_days").select("entry_id, plates_sold, sold_out_manual").eq("day", today).in("entry_id", ids)
      : null,
  ]);
  const off = new Map<string, string[]>();
  for (const o of offResult ? must(offResult, "the days off") : []) off.set(o.entry_id, [...(off.get(o.entry_id) ?? []), o.day]);
  const sales = new Map((salesResult ? must(salesResult, "plates sold") : []).map((s) => [s.entry_id, s]));

  const weekly = new Map(hours.map((h) => [h.weekday, h]));
  const hoursOn = (d: string) => {
    const h = weekly.get(dow(d));
    return h && h.is_open ? { opens: h.opens, closes: h.closes } : null;
  };

  const entries: PlannerEntry[] = rows
    .filter((r) => r.dish)
    .map((r) => {
      const e: PlannerEntry = {
        id: r.id,
        kind: r.kind,
        dishId: r.dish!.id,
        name: r.dish!.name,
        photo: r.dish!.photo_thumb_url,
        usualPrice: r.dish!.price_kes,
        price: r.price_kes,
        plates: r.plates_per_day,
        from: r.show_from,
        until: r.show_until,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        off: (off.get(r.id) ?? []).sort(),
        today: null,
      };
      if (runsOn(e, today) && hoursOn(today)) {
        const s = sales.get(r.id);
        e.today = { sold: s?.plates_sold ?? 0, manual: Boolean(s?.sold_out_manual) };
      }
      return e;
    });

  const days: PlannerDay[] = weekDays(monday).map((d) => ({
    day: d,
    hours: hoursOn(d),
    closedNote: closed.has(d) ? closed.get(d)! : null,
    copy: { prev: preview[d]?.prev ?? 0, lastWeek: preview[d]?.last_week ?? 0 },
  }));

  // Plan tomorrow: the next day the kitchen opens, skipping weekly closed days and closed dates.
  let next: PlannerData["next"] = null;
  if (weekStart(today) === monday) {
    const nextDay = nextOpenDay(today, (d) => hoursOn(d) !== null && !closed.has(d));
    if (nextDay) {
      let count: number;
      if (nextDay <= sunday) count = entries.filter((e) => runsOn(e, nextDay)).length;
      else {
        const later = must(
          await supabase
            .from("menu_entries")
            .select("id, starts_on, ends_on, off:menu_entry_off_days(day)")
            .eq("published", true)
            .is("ended_early_at", null)
            .lte("starts_on", nextDay)
            .gte("ends_on", nextDay),
          "the next day’s menu",
        );
        count = later.filter((e) => !e.off.some((o) => o.day === nextDay)).length;
      }
      next = { day: nextDay, count };
    }
  }

  const data: PlannerData = { today, monday, days, entries, prices, next };

  return (
    <div className="flex max-w-[1240px] flex-col gap-4">
      <header>
        <h1 className="font-display text-[34px] leading-tight text-ink">Menu planner</h1>
        <RefusalNote className="mt-1" />
        <p className="mt-0.5 text-[15px] text-ink-soft">What customers can order, day by day</p>
      </header>
      <Planner data={data} />
    </div>
  );
}
