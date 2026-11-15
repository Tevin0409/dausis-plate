import { redirect } from "next/navigation";
import { after } from "next/server";
import { FILTERS, parseFilter, summaryLine, type OwnerRating } from "@/lib/ratings";
import { createClient, getStaff } from "@/lib/supabase/server";
import { RatingsList } from "./ratings-list";
import { FilterBar } from "./filter-bar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ratings" };

type Props = { searchParams: Promise<{ show?: string | string[] }> };

/** spec-2.10 "Owner: Ratings". Owner only; staff are sent to the board. */
export default async function RatingsPage({ searchParams }: Props) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner") redirect("/dashboard");

  const show = parseFilter((await searchParams).show);
  const db = await createClient();
  const [list, summary, me] = await Promise.all([
    db.rpc("list_ratings", { p_show: show }),
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
  const empty = FILTERS.find((f) => f.key === show)!.empty;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 pb-6">
      <header>
        <h1 className="font-display text-[34px] leading-tight">Ratings</h1>
        <p className="mt-1 text-[15px] text-ink-soft">{summaryLine(summary.data?.[0] ?? null)}</p>
      </header>
      <FilterBar show={show} />
      <RatingsList key={show} show={show} initial={rows} seenAt={me.data?.ratings_seen_at ?? null} empty={empty} />
    </div>
  );
}
