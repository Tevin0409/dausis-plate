import Link from "next/link";
import { notFound } from "next/navigation";
import { nairobiToday } from "@/lib/format";
import { AREAS, type Area } from "@/lib/history";
import { createClient, getStaff } from "@/lib/supabase/server";
import { HistoryList } from "./history-list";
import { readFilters, readHistory } from "./query";
import { WhoSelect } from "./who-select";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

const LABEL: Record<Area | "all", string> = { all: "All", menu: "Menu", orders: "Orders", tables: "Tables", team: "Team", settings: "Settings", ratings: "Ratings", promos: "Promos" };
// 44 px chips that wrap onto a second line at 375 rather than scroll (spec-2.3 "Phone layout").
const CHIP =
  "press inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";

/** The URL for a filter: the default is plain /dashboard/history. */
function href(area: Area | null, who: string | null) {
  const q = new URLSearchParams();
  if (area) q.set("area", area);
  if (who) q.set("who", who);
  const s = q.toString();
  return s ? `/dashboard/history?${s}` : "/dashboard/history";
}

type Props = { searchParams: Promise<{ area?: string; who?: string }> };

export default async function HistoryPage({ searchParams }: Props) {
  const staff = await getStaff();
  if (!staff) notFound();
  if (staff.role !== "owner") {
    return (
      <div className="mx-auto max-w-[760px]">
        <h1 className="font-display text-[34px] leading-tight">History</h1>
        <p className="mt-2 text-[15px] text-ink-soft">Only the owner can see the history.</p>
      </div>
    );
  }

  const params = await searchParams;
  const filters = readFilters(params);
  const db = await createClient();
  const [result, peopleResult] = await Promise.all([readHistory(db, filters, null), db.rpc("history_people")]);
  if (!result.ok) {
    console.error("[db] loading the history failed:", result.error.code ?? "", result.error.message);
    throw new Error("Couldn't load the history");
  }
  if (peopleResult.error) {
    console.error("[db] loading the history's people failed:", peopleResult.error.code ?? "", peopleResult.error.message);
    throw new Error("Couldn't load the history");
  }
  const people = peopleResult.data.map((p) => ({ id: p.actor, label: p.on_team ? p.actor_name : `${p.actor_name} (left)` }));
  const filtered = filters.area !== null || filters.who !== null;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 pb-6">
      <header>
        <h1 className="font-display text-[34px] leading-tight">History</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Every change to the menu, prices, tables, team, settings, orders and ratings, newest first.</p>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Show changes to" className="flex flex-wrap gap-2">
            {([null, ...AREAS] as const).map((a) => {
              const on = filters.area === a;
              return (
                <Link
                  key={a ?? "all"}
                  href={href(a, filters.who)}
                  aria-current={on ? "page" : undefined}
                  className={`${CHIP} ${on ? "bg-teal-deep text-white" : "border border-line-deep bg-paper text-ink hover:bg-sand"}`}
                >
                  {LABEL[a ?? "all"]}
                </Link>
              );
            })}
          </nav>
          <WhoSelect people={people} who={filters.who} area={filters.area} />
        </div>
        {filters.area === null && (
          <p className="text-sm text-ink-soft">
            Order moves are under{" "}
            <Link href={href("orders", filters.who)} className="font-semibold text-teal-deep underline underline-offset-4">
              Orders
            </Link>
            .
          </p>
        )}
      </div>

      {result.rows.length === 0 ? (
        filtered ? (
          <p className="rounded-[var(--r-md)] bg-paper px-4 py-5 text-[15px] shadow-[var(--shadow-card)]">
            No changes match.{" "}
            <Link href="/dashboard/history" className="font-semibold text-teal-deep underline underline-offset-4">
              Show everything
            </Link>
          </p>
        ) : (
          <p className="rounded-[var(--r-md)] bg-paper px-4 py-5 text-[15px] text-ink-soft shadow-[var(--shadow-card)]">
            Nothing has changed yet. Changes to the menu, prices, tables, team and settings will show here.
          </p>
        )
      ) : (
        // Keyed by the filters, so changing one starts the list again from the newest.
        <HistoryList key={href(filters.area, filters.who)} initial={result.rows} more={result.more} params={params} today={nairobiToday()} />
      )}
    </div>
  );
}
