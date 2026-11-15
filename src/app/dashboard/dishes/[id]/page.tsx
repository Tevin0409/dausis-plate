import Link from "next/link";
import { notFound } from "next/navigation";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { DeleteDish, DishEditor, EverydaySwitch } from "@/components/dashboard/dishes/dish-editor";
import { OptionsReadOnly, type SavedOption } from "@/components/dashboard/dishes/option-out";
import { BackIcon } from "@/components/icons";
import { dayLabel, formatKes, nairobiToday } from "@/lib/format";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { isUuid, must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string; regular?: string }> };

const CATEGORY = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" } as const;

export default async function DishEditorPage({ params, searchParams }: Props) {
  const [{ id }, { day, regular }, staff] = await Promise.all([params, searchParams, getStaff()]);
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) notFound();
  if (!staff) notFound();
  const edits = can(staff, "dishes_prices");
  const everyday = can(staff, "everyday_menu");
  const owner = staff.role === "owner";
  const planDay = isNew && day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const back = planDay ? `/dashboard/menu?day=${planDay}` : regular === "1" ? "/dashboard/manage" : "/dashboard/manage?view=all";

  // A new dish is the Dishes and prices job; without it there's nothing to show.
  if (isNew && !edits) {
    return (
      <div className="flex max-w-[640px] flex-col gap-3">
        <BackLink href={back} />
        <h1 className="font-display text-[34px] leading-tight">New dish</h1>
        <p className="text-[15px] text-ink-soft">{OWNER_ONLY.dishes_prices}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [dishResult, optionsResult] = isNew
    ? [null, null]
    : await Promise.all([
        supabase.from("dishes").select("id, name, description, price_kes, category, photo_url, is_regular, archived").eq("id", id).maybeSingle(),
        supabase
          .from("dish_options")
          .select("id, kind, label, price_delta_kes, is_default, out_on")
          .eq("dish_id", id)
          .eq("archived", false)
          .order("sort_order")
          .order("label"),
      ]);
  const dish = dishResult ? must(dishResult, "the dish") : null;
  if (!isNew && (!dish || dish.archived)) notFound();
  const today = nairobiToday();
  const options: SavedOption[] = optionsResult
    ? must(optionsResult, "the dish’s options").map((o) => ({
        id: o.id,
        kind: o.kind === "extra" ? "extra" : "choice",
        label: o.label,
        extra: o.price_delta_kes,
        isDefault: o.is_default,
        outToday: o.out_on === today,
      }))
    : [];
  const listHref = dish ? (dish.is_regular ? "/dashboard/manage" : "/dashboard/manage?view=all") : back;

  // Without Dishes and prices: everything as text; the Out today switches still work (spec-2.3, Q3 B).
  if (dish && !edits) {
    return (
      <div className="flex max-w-[640px] flex-col gap-5">
        <div>
          <BackLink href={listHref} />
          <h1 className="mt-2 font-display text-[34px] leading-tight [overflow-wrap:anywhere]">{dish.name}</h1>
          <RefusalNote className="mt-1" />
          <p className="mt-1 text-sm text-ink-soft">{OWNER_ONLY.dishes_prices}</p>
        </div>
        <section className="flex flex-col gap-[18px] rounded-[18px] bg-paper p-5 ring-1 ring-sand min-[600px]:p-6">
          {dish.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- same R2 URL the editor's preview shows
            <img src={dish.photo_url} alt={`Photo of ${dish.name}`} className="aspect-[4/3] w-full rounded-2xl object-cover" />
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-[18px] text-[15px]">
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Usual price</dt>
              <dd className="font-semibold tabular-nums">{formatKes(dish.price_kes)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Type</dt>
              <dd className="font-semibold">{CATEGORY[dish.category]}</dd>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Description</dt>
              <dd className="[overflow-wrap:anywhere]">{dish.description || "No description."}</dd>
            </div>
          </dl>
          <OptionsReadOnly dishName={dish.name} options={options} />
          <div className="border-t border-sand pt-[18px]">
            {everyday ? (
              <EverydaySwitch dishId={dish.id} initial={dish.is_regular} />
            ) : (
              <p className="text-[15px]">{dish.is_regular ? "On the everyday menu." : "Not on the everyday menu."}</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <div>
        <BackLink href={dish ? listHref : back} />
        <h1 className="mt-2 font-display text-[34px] leading-tight [overflow-wrap:anywhere]">{dish ? `Edit ${dish.name}` : "New dish"}</h1>
        <RefusalNote className="mt-1" />
        {planDay && <p className="text-[15px] text-ink-soft">It’ll be added to {dayLabel(planDay, "long")} and saved to the dish library.</p>}
      </div>

      <DishEditor
        dish={dish}
        options={options}
        everyday={everyday}
        regularDefault={regular === "1" && everyday}
        planDay={planDay}
        newId={crypto.randomUUID()}
        backHref={back}
      />

      {dish && owner && <DeleteDish dish={dish} />}
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="press -ml-1 inline-flex min-h-11 items-center gap-1 rounded-[var(--r-sm)] px-1 text-sm font-semibold text-teal-deep touch-manipulation select-none">
      <BackIcon size={18} /> {href.startsWith("/dashboard/menu") ? "Menu" : "Dishes"}
    </Link>
  );
}
