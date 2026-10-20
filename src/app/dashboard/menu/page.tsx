import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { addDays, dayLabel, formatKes, hhmm, nairobiToday, weekdayName, weekStart } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addFromLibrary, copyDay, endEntryEarly, removeEntry, setSoldOut } from "../actions";
import { SubmitButton } from "@/components/dashboard/submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daily menu" };

type Props = { searchParams: Promise<{ day?: string; q?: string }> };

const btn = "min-h-10 rounded-[10px] border border-line-deep bg-white px-3 text-sm font-semibold";

export default async function MenuPlannerPage({ searchParams }: Props) {
  const { day: dayParam, q } = await searchParams;
  const today = nairobiToday();
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : today;
  const ws = weekStart(day);
  const we = addDays(ws, 6);
  const supabase = await createClient();

  let libraryQuery = supabase
    .from("dishes")
    .select("id, name, price_kes, last_served_on")
    .eq("archived", false)
    .eq("is_regular", false)
    .order("last_served_on", { ascending: false, nullsFirst: false })
    .limit(40);
  if (q?.trim()) libraryQuery = libraryQuery.ilike("name", `%${q.trim()}%`);

  const [{ data: entries }, { data: library }] = await Promise.all([
    supabase
      .from("menu_entries")
      .select("id, kind, starts_on, ends_on, plates_per_day, price_kes, show_from, show_until, ended_early_at, dish:dishes(id, name, price_kes)")
      .eq("published", true)
      .lte("starts_on", we)
      .gte("ends_on", ws)
      .order("sort_order"),
    libraryQuery,
  ]);

  const live = (entries ?? []).filter((e) => e.ended_early_at === null);
  const on = (d: string) => live.filter((e) => e.starts_on <= d && d <= e.ends_on);
  const selected = on(day);
  const ids = selected.map((e) => e.id);
  const { data: dayRows } = ids.length
    ? await supabase.from("menu_entry_days").select("entry_id, plates_sold, sold_out_manual").eq("day", day).in("entry_id", ids)
    : { data: [] };
  const sales = new Map((dayRows ?? []).map((r) => [r.entry_id, r]));

  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const tomorrow = addDays(today, 1);
  const tomorrowCount = on(tomorrow).length;
  const dayName = weekdayName(day);
  const isPast = day < today;

  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-sm text-ink-soft">Week of {dayLabel(ws, "long")} – {dayLabel(we, "long")}</span>
          <h1 className="mt-1 font-display text-[34px] leading-tight">Daily &amp; weekly menu</h1>
        </div>
        {!isPast && (
          <div className="flex flex-wrap gap-2">
            <form action={copyDay}>
              <input type="hidden" name="from" value={addDays(day, -7)} />
              <input type="hidden" name="to" value={day} />
              <SubmitButton className="min-h-11 rounded-xl border-[1.5px] border-line-deep bg-white px-4 text-sm font-semibold">Copy last {dayName}</SubmitButton>
            </form>
            <form action={copyDay}>
              <input type="hidden" name="from" value={addDays(day, -1)} />
              <input type="hidden" name="to" value={day} />
              <SubmitButton className="min-h-11 rounded-xl border-[1.5px] border-line-deep bg-white px-4 text-sm font-semibold">Copy {weekdayName(addDays(day, -1))}</SubmitButton>
            </form>
            <Link href={`/dashboard/dishes/new?day=${day}`} className="flex min-h-11 items-center gap-2 rounded-xl bg-teal-deep px-[18px] text-sm font-bold text-white">
              <PlusIcon size={16} /> New dish
            </Link>
          </div>
        )}
      </header>

      <nav aria-label="Days of the week" className="grid grid-cols-[repeat(7,minmax(84px,1fr))] gap-2 overflow-x-auto">
        <Link href={`/dashboard/menu?day=${addDays(ws, -7)}`} className="sr-only focus:not-sr-only">Previous week</Link>
        {week.map((d) => {
          const n = on(d).length;
          const selectedDay = d === day;
          const status = d < today ? `Done · ${n}` : n === 0 ? "Not planned" : d === today ? `Live · ${n}` : `Planned · ${n}`;
          return (
            <Link
              key={d}
              href={`/dashboard/menu?day=${d}`}
              aria-current={selectedDay ? "date" : undefined}
              className={`flex flex-col gap-0.5 rounded-[14px] px-3 py-2.5 ${
                selectedDay ? "border-2 border-teal-deep bg-teal-tint" : n === 0 && d >= today ? "border-[1.5px] border-dashed border-[#9aa5b4]" : "border border-line bg-white"
              }`}
            >
              <span className={`text-[13px] ${selectedDay ? "font-bold text-teal-deeper" : "text-ink-soft"}`}>{d === today ? `Today · ${dayLabel(d)}` : dayLabel(d)}</span>
              <span className={`text-sm font-semibold ${n === 0 && d >= today ? "text-coral-ink" : selectedDay ? "text-teal-deeper" : ""}`}>{status}</span>
            </Link>
          );
        })}
        <Link href={`/dashboard/menu?day=${addDays(ws, 7)}`} className="sr-only focus:not-sr-only">Next week</Link>
      </nav>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-[18px]">
          {(["day", "week"] as const).map((kind) => {
            const rows = selected.filter((e) => e.kind === kind);
            return (
              <section key={kind} className="flex flex-col gap-1 rounded-[20px] border border-line bg-white p-5">
                <h2 className="mb-1.5 text-[17px] font-bold">
                  {kind === "day" ? `${dayName} only` : "All week"}{" "}
                  <span className="font-medium text-ink-soft">· {kind === "day" ? `${rows.length} dishes` : `${dayLabel(ws)} – ${dayLabel(we)}`}</span>
                </h2>
                {rows.length === 0 && (
                  <p className="border-t border-line py-3 text-sm text-ink-soft">
                    {kind === "day" ? "Nothing yet. Add from the dish library or create a new dish." : "No dishes running all week."}
                  </p>
                )}
                {rows.map((e) => {
                  const s = sales.get(e.id);
                  const sold = s?.plates_sold ?? 0;
                  const pct = e.plates_per_day ? Math.min(100, Math.round((sold / e.plates_per_day) * 100)) : 0;
                  const soldOut = Boolean(s?.sold_out_manual);
                  return (
                    <div key={e.id} className="flex flex-wrap items-center gap-3.5 border-t border-line py-3">
                      <div className="flex min-w-0 flex-[2_1_180px] flex-col gap-0.5">
                        <span className="text-base font-bold">{e.dish?.name}</span>
                        <span className="text-[13px] text-ink-soft">
                          {formatKes(e.price_kes ?? e.dish?.price_kes ?? 0)} · {hhmm(e.show_from)}–{hhmm(e.show_until)}
                          {e.plates_per_day ? ` · ${e.plates_per_day} plates${kind === "week" ? " a day" : ""}` : ""}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
                        <span className="text-[13px] font-semibold">
                          {soldOut ? "Marked sold out" : e.plates_per_day ? `${sold} of ${e.plates_per_day} sold` : `${sold} sold`}
                        </span>
                        {e.plates_per_day && (
                          <div className="h-1.5 rounded-full bg-blush-deep"><div className="h-1.5 rounded-full bg-coral" style={{ width: `${pct}%` }} /></div>
                        )}
                      </div>
                      {!isPast && (
                        <div className="flex flex-wrap gap-1.5">
                          {e.dish && <Link href={`/dashboard/dishes/${e.dish.id}`} className={`${btn} flex items-center text-teal-deep`}>Edit</Link>}
                          {day === today && (
                            <form action={setSoldOut}>
                              <input type="hidden" name="entryId" value={e.id} />
                              <input type="hidden" name="soldOut" value={soldOut ? "false" : "true"} />
                              <SubmitButton className={`${btn} text-coral-ink`}>{soldOut ? "Back on" : "Sold out"}</SubmitButton>
                            </form>
                          )}
                          <form action={kind === "week" && day === today ? endEntryEarly : removeEntry}>
                            <input type="hidden" name="entryId" value={e.id} />
                            <SubmitButton className={`${btn} text-ink-soft`}>{kind === "week" && day === today ? "End early" : "Remove"}</SubmitButton>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {day === today && (
            <div className={`flex flex-wrap items-center gap-3 rounded-2xl px-[18px] py-3.5 text-sm ${tomorrowCount ? "bg-teal-tint text-teal-deeper" : "bg-amber-tint text-amber-ink"}`}>
              <span className="flex-[1_1_260px]">
                {tomorrowCount ? (
                  <><b>{weekdayName(tomorrow)} is planned.</b> It goes live on its own in the morning.</>
                ) : (
                  <><b>{weekdayName(tomorrow)} isn’t planned yet.</b> Plan it tonight and there’s nothing to do in the morning.</>
                )}
              </span>
              <Link href={`/dashboard/menu?day=${tomorrow}`} className="font-bold underline">
                {tomorrowCount ? "Review" : "Plan"} {weekdayName(tomorrow)}
              </Link>
            </div>
          )}
        </div>

        {!isPast && (
          <aside aria-label="Dish library" className="flex min-w-0 flex-[2_1_300px] flex-col gap-3 rounded-[20px] border border-line bg-white p-5">
            <div>
              <h2 className="text-[17px] font-bold">Dish library</h2>
              <span className="text-[13px] text-ink-soft">Everything she’s cooked before, photo and price saved</span>
            </div>
            <form className="flex items-center gap-2 rounded-xl border border-line-deep px-3">
              <input type="hidden" name="day" value={day} />
              <input type="search" name="q" defaultValue={q} placeholder="Search past dishes" aria-label="Search past dishes" className="min-h-11 min-w-0 flex-1 text-sm outline-none" />
            </form>
            {(library ?? []).length === 0 && <p className="text-sm text-ink-soft">No dishes yet. Create one with “New dish”.</p>}
            {(library ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-1.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{l.name}</span>
                  <span className="text-xs text-ink-soft">
                    {l.last_served_on ? `Last on ${dayLabel(l.last_served_on, "long")}` : "Not served yet"} · {formatKes(l.price_kes)}
                  </span>
                </div>
                {(["day", "week"] as const).map((kind) => (
                  <form key={kind} action={addFromLibrary}>
                    <input type="hidden" name="dishId" value={l.id} />
                    <input type="hidden" name="day" value={day} />
                    <input type="hidden" name="kind" value={kind} />
                    <SubmitButton aria-label={`Add ${l.name} ${kind === "day" ? `to ${dayName}` : "for the rest of the week"}`} className="min-h-10 rounded-[10px] border-[1.5px] border-teal-deep bg-white px-2.5 text-[13px] font-bold text-teal-deep">
                      + {kind === "day" ? dayLabel(day).split(" ")[0] : "Week"}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
