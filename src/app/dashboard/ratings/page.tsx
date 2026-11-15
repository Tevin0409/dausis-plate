import { redirect } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { FILTERS, parseDates, parseFilter, summaryLine, type OwnerRating } from "@/lib/ratings";
import { periodLabel } from "@/lib/reports/period";
import { nairobiToday } from "@/lib/format";
import { createClient, getStaff } from "@/lib/supabase/server";
import { RatingsList } from "./ratings-list";
import { FilterBar } from "./filter-bar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ratings" };

type Props = { searchParams: Promise<{ show?: string | string[]; from?: string | string[]; to?: string | string[] }> };

/** spec-2.10 "Owner: Ratings". Owner only; staff are sent to the board. */
export default async function RatingsPage({ searchParams }: Props) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner") redirect("/dashboard");

  const sp = await searchParams;
  const show = parseFilter(sp.show);
  // Reports' "All ratings" opens this screen on its period (spec-2.12 Ratings).
  const dates = parseDates(sp.from, sp.to);
  const db = await createClient();
  const [list, summary, me] = await Promise.all([
    db.rpc("list_ratings", { p_show: show, p_from: dates?.from ?? null, p_to: dates?.to ?? null }),
    db.rpc("ratings_summary"),
    db.from("staff").select("ratings_seen_at").eq("user_id", staff.id).maybeSingle(),
  ]);
  for (const [what, r] of [["ratings", list], ["the ratings summary", summary], ["the last visit", me]] as const) {
    if (r.error) {
      console.error(`[db] loading ${what} failed:`, r.error.code ?? "", r.error.message);
      throw new Error("Couldn't load the ratings");
    }
  }
  // The "New" pills show on this visit and clear on the next (spec: run after rendering).
  after(async () => {
    const { error } = await db.rpc("mark_ratings_seen");
    if (error) console.error("[db] marking ratings seen failed:", error.code ?? "", error.message);
  });

  const rows = (list.data ?? []) as OwnerRating[];
  const empty = dates ? "No ratings like this sent in these dates." : FILTERS.find((f) => f.key === show)!.empty;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 pb-6">
      <header>
        <h1 className="font-display text-[34px] leading-tight">Ratings</h1>
        <p className="mt-1 text-[15px] text-ink-soft">{summaryLine(summary.data?.[0] ?? null)}</p>
      </header>
      {dates && (
        <p className="-mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px] font-semibold tabular-nums">
          <span>Sent {periodLabel({ range: "custom", ...dates }, nairobiToday())}</span>
          <Link href={show === "all" ? "/dashboard/ratings" : `/dashboard/ratings?show=${show}`} scroll={false} className="press inline-flex min-h-11 items-center text-teal-deep focus-visible:outline-2 focus-visible:outline-teal-deep [&:hover]:underline">
            Show all dates
          </Link>
        </p>
      )}
      <FilterBar show={show} dates={dates} />
      <RatingsList key={`${show}${dates?.from ?? ""}${dates?.to ?? ""}`} show={show} dates={dates} initial={rows} seenAt={me.data?.ratings_seen_at ?? null} empty={empty} />
    </div>
  );
}
