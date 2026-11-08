import { notFound } from "next/navigation";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { addDays, closedDateLabel, hhmm } from "@/lib/format";
import { statusStrip } from "@/lib/kitchen";
import { getKitchen } from "@/lib/kitchen-server";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";
import { can } from "@/lib/permissions";
import { CloseEarlyCard } from "./close-early-card";
import { ClosedDates } from "./closed-dates";
import { HoursForm, type Day } from "./hours-form";
import { TillCard } from "./till-card";
import { PhoneCard } from "./phone-card";
import { formatKenyanPhone } from "@/lib/kitchen-phone";
import { hint, tile, tileHeading } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Nairobi's minutes past midnight for a moment. */
function nairobiMinutes(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export default async function SettingsPage() {
  const staff = await getStaff();
  if (!staff) notFound();
  const owner = staff.role === "owner";
  const closes = can(staff, "close_early");
  const supabase = await createClient();
  const { status, now } = await getKitchen();
  const today = status.today;
  const endOfToday = `${addDays(today, 1)}T00:00:00+03:00`;

  const [hoursResult, datesResult, settingsResult, pickupsResult] = await Promise.all([
    supabase.from("opening_hours").select("weekday, is_open, opens, closes"),
    supabase.from("closed_dates").select("day, note").gt("day", today).order("day"),
    supabase.from("kitchen_settings").select("till_number, last_orders_minutes, phone").maybeSingle(),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("mode", "pickup")
      .in("status", ["new", "preparing", "ready"])
      .gt("pickup_at", now)
      .lt("pickup_at", endOfToday),
  ]);
  // The form shows a closing of 24:00 (midnight) as 00:00, which is what a time field can hold (2A).
  const days: Day[] = must(hoursResult, "opening hours").map((d) => ({
    weekday: d.weekday,
    is_open: d.is_open,
    opens: hhmm(d.opens),
    closes: hhmm(d.closes) === "24:00" ? "00:00" : hhmm(d.closes),
  }));
  const dates = must(datesResult, "closed dates");
  const settings = must(settingsResult, "kitchen settings");
  const pickupsDue = pickupsResult.error ? 0 : (pickupsResult.count ?? 0);
  if (pickupsResult.error) console.error("[db] counting pickups due failed:", pickupsResult.error.message);
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const lastOrders = settings?.last_orders_minutes ?? 30;
  const open = status.state === "open";

  return (
    <div className="mx-auto max-w-6xl pb-28 lg:pb-16">
      <h1 className="font-display text-[34px] leading-tight">Settings</h1>
      <RefusalNote className="mt-1" />
      <p
        className={`mt-3 rounded-[var(--r-md)] px-4 py-3 text-[15px] font-semibold tabular-nums ${open ? "bg-teal-tint text-teal-deeper" : "bg-sand text-ink"}`}
      >
        {statusStrip(status)}
      </p>
      {!owner && (
        <p className={`${hint} mt-2 text-[15px]`}>
          {closes ? "Only the owner can change the hours, closed dates, till number and kitchen phone." : "Only the owner can change these."}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:items-start">
        {/* Phone and tablet: one column, close early first. 1280: hours and till left, close early and dates right. */}
        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <div className="order-2 xl:order-none">
            {owner ? (
              <HoursForm initial={days} lastOrders={lastOrders} todayWeekday={todayWeekday} nowMinutes={nairobiMinutes(now)} openNow={open} />
            ) : (
              <StaffHours days={days} lastOrders={lastOrders} todayWeekday={todayWeekday} />
            )}
          </div>
          <div className="order-4 xl:order-none">
            {owner ? (
              <TillCard initial={settings?.till_number ?? null} />
            ) : (
              <section className={tile}>
                <h2 className={tileHeading}>M-Pesa till number</h2>
                <p className="mt-2 text-base font-semibold tabular-nums">{settings?.till_number ?? "Not set"}</p>
              </section>
            )}
          </div>
          <div className="order-5 xl:order-none">
            {owner ? (
              <PhoneCard initial={settings?.phone ?? null} />
            ) : (
              <section className={tile}>
                <h2 className={tileHeading}>Kitchen phone</h2>
                <p className="mt-2 text-base font-semibold tabular-nums">{settings?.phone ? formatKenyanPhone(settings.phone) : "Not set"}</p>
              </section>
            )}
          </div>
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-5">
          {closes && (
            <div className="order-1 empty:hidden xl:order-none">
              <CloseEarlyCard status={status} pickupsDue={pickupsDue} />
            </div>
          )}
          <div className="order-3 xl:order-none">
            {owner ? (
              <ClosedDates initial={dates} today={today} canEdit />
            ) : (
              <section className={tile}>
                <h2 className={tileHeading}>Closed dates</h2>
                {dates.length === 0 ? (
                  <p className="mt-3 text-[15px] text-ink-soft">No closed dates coming up.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {dates.map((d) => (
                      <li key={d.day}>
                        <p className="text-[15px] font-semibold">{closedDateLabel(d.day, today)}</p>
                        {d.note && <p className="text-[14px] text-ink-soft [overflow-wrap:anywhere]">{d.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffHours({ days, lastOrders, todayWeekday }: { days: Day[]; lastOrders: number; todayWeekday: number }) {
  const sorted = ORDER.map((w) => days.find((d) => d.weekday === w)).filter((d): d is Day => Boolean(d));
  const show = (t: string) => (t === "00:00" ? "midnight" : t);
  return (
    <section className={tile}>
      <h2 className={tileHeading}>Weekly hours</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
        {sorted.map((d) => (
          <div key={d.weekday} className="contents">
            <dt className={d.weekday === todayWeekday ? "font-bold" : "font-semibold"}>{NAMES[d.weekday]}</dt>
            <dd className="tabular-nums">{d.is_open ? `${d.opens} – ${show(d.closes)}` : "Closed"}</dd>
          </div>
        ))}
      </dl>
      <p className={`${hint} mt-3`}>
        Last orders: {lastOrders === 0 ? "at closing time" : `${lastOrders} minutes before closing`}.
      </p>
    </section>
  );
}
