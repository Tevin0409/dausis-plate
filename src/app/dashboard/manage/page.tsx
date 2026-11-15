import Link from "next/link";
import { notFound } from "next/navigation";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { AddDish, AllList, ArchivedList, DoneNote, EverydayList, type DishRowData } from "@/components/dashboard/dishes/dish-list";
import { nairobiToday } from "@/lib/format";
import { regularOnSale } from "@/lib/kitchen";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dishes" };

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
  const dishesResult = await query;
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
            {/* Sales moved to Reports (2.12); the owner gets a pointer, staff just the header. */}
            {owner && (
              <p className="mt-1 text-sm text-ink-soft">
                Today’s sales are in <Link href="/dashboard/reports" className="font-semibold text-teal-deep underline underline-offset-2">Reports →</Link>
              </p>
            )}
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
