import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { AddButton } from "@/components/shop/add-button";
import { OrderPanel } from "@/components/shop/order-panel";
import { CartBar } from "@/components/shop/ui";
import { PlusIcon } from "@/components/icons";
import type { Enums, TodaysMenuRow } from "@/lib/database.types";
import { formatKes, hhmm, nairobiToday, weekdayName } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<Enums<"dish_category">, string> = {
  mains: "Mains",
  sides: "Sides",
  breakfast: "Breakfast",
  drinks: "Drinks",
};

export default async function MenuPage() {
  const supabase = await createClient();
  const [{ data: today }, { data: regulars }, { data: optionRows }] = await Promise.all([
    supabase.from("todays_menu").select("*").order("sort_order").returns<TodaysMenuRow[]>(),
    supabase
      .from("dishes")
      .select("id, name, description, price_kes, photo_thumb_url, category, regular_available")
      .eq("is_regular", true)
      .eq("archived", false)
      .order("category")
      .order("sort_order"),
    supabase.from("dish_options").select("dish_id"),
  ]);

  const hasOptions = new Set((optionRows ?? []).map((o) => o.dish_id));
  const rotating = (today ?? []).filter((d) => !(d.sold_out && d.auto_hide_sold_out));
  const table = parseTableCookie((await cookies()).get(TABLE_COOKIE)?.value);
  const day = weekdayName(nairobiToday());

  const groups = new Map<Enums<"dish_category">, NonNullable<typeof regulars>>();
  for (const d of regulars ?? []) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);

  return (
    <>
      <header className="border-b border-sand/70 md:bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 pb-2 pt-4 md:px-8 md:py-4">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/dausis-plate-icon.svg" alt="" width={40} height={40} priority className="md:size-12" />
            <div className="flex flex-col leading-none">
              <span className="font-display text-[22px] md:text-[26px]">Dausis Plate</span>
              <span className="mt-0.5 font-script text-base text-ink-soft md:text-lg">Mama’s Flavour.</span>
            </div>
          </div>
          {table && (
            <span className="rounded-full border border-sand-deep bg-white px-3.5 py-2.5 text-sm font-semibold">{table.label}</span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:px-8 lg:pb-16">
        <main className="min-w-0">
          <h1 className="px-5 pb-3.5 pt-4 font-display text-[28px] leading-tight md:px-8 md:pb-6 md:pt-10 md:text-[44px] lg:px-0">
            Karibu! What’s on your plate today?
          </h1>

          <section aria-labelledby="today-heading" className="flex flex-col gap-2.5 md:gap-4">
            <div className="flex items-baseline justify-between px-5 md:px-8 lg:px-0">
              <div className="flex flex-col gap-0.5">
                <span className="font-script text-xl leading-none text-coral-text md:text-2xl">Fresh from Mama’s kitchen</span>
                <h2 id="today-heading" className="font-display text-2xl md:text-3xl">{day}’s menu</h2>
              </div>
              <span className="text-[13px] font-semibold text-ink-soft">Changes daily</span>
            </div>

            {rotating.length === 0 ? (
              <p className="mx-5 rounded-2xl bg-blush px-4 py-5 text-[15px] text-coral-ink md:mx-8 lg:mx-0">
                Today’s dishes are still being planned. The regular menu is below.
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto px-5 pb-1 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-8 lg:px-0 xl:grid-cols-3">
                {rotating.map((d) => (
                  <RotatingCard key={d.entry_id} dish={d} hasOptions={hasOptions.has(d.dish_id)} />
                ))}
              </div>
            )}
          </section>

          {groups.size > 0 && (
            <>
              <nav
                aria-label="Menu categories"
                className="sticky top-0 z-[5] flex gap-2 overflow-x-auto bg-cream px-5 pb-1.5 pt-5 md:mt-6 md:px-8 md:py-3 lg:px-0"
              >
                {[...groups.keys()].map((c) => (
                  <a key={c} href={`#${c}`} className="flex min-h-10 flex-none items-center rounded-full border border-sand-deep bg-white px-4 text-sm font-medium">
                    {CATEGORY_LABEL[c]}
                  </a>
                ))}
              </nav>

              <div className="px-5 md:px-8 lg:px-0">
                <h2 className="mb-1 mt-3 font-display text-xl md:mt-4 md:text-3xl">Always on the menu</h2>
                {[...groups.entries()].map(([category, dishes]) => (
                  <section key={category} id={category} aria-label={CATEGORY_LABEL[category]} className="scroll-mt-20">
                    <h3 className="mt-3 text-xs font-bold uppercase tracking-wider text-ink-soft md:mb-3 md:mt-6">{CATEGORY_LABEL[category]}</h3>
                    <div className="md:grid md:grid-cols-2 md:gap-4">
                      {dishes.map((d) => (
                        <div
                          key={d.id}
                          className={`flex items-center gap-3.5 border-b border-sand py-3 md:rounded-2xl md:border md:bg-white md:p-3 ${d.regular_available ? "" : "opacity-60"}`}
                        >
                          <div className="relative size-[68px] flex-none overflow-hidden rounded-2xl bg-teal-tint md:size-20">
                            {d.photo_thumb_url && <Image src={d.photo_thumb_url} alt="" fill sizes="80px" className="object-cover" />}
                          </div>
                          <Link href={`/dish/${d.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-base font-semibold">{d.name}</span>
                            <span className="line-clamp-2 text-[13px] text-ink-soft">{d.regular_available ? d.description : "Sold out today"}</span>
                            <span className="text-[15px] font-bold">{formatKes(d.price_kes)}</span>
                          </Link>
                          {d.regular_available &&
                            (hasOptions.has(d.id) ? (
                              <Link href={`/dish/${d.id}`} aria-label={`Choose options for ${d.name}`} className="flex size-11 flex-none items-center justify-center rounded-full border-[1.5px] border-teal-deep text-teal-deep">
                                <PlusIcon />
                              </Link>
                            ) : (
                              <AddButton dishId={d.id} menuEntryId={null} name={d.name} priceKes={d.price_kes} rotating={false} />
                            ))}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </main>

        <div className="lg:pt-10">
          <OrderPanel />
        </div>
      </div>

      <CartBar />
    </>
  );
}

function RotatingCard({ dish, hasOptions }: { dish: TodaysMenuRow; hasOptions: boolean }) {
  const src = dish.photo_thumb_url;
  const orderable = dish.open_now && !dish.sold_out;
  const status = dish.sold_out
    ? "Sold out"
    : !dish.open_now
      ? `From ${hhmm(dish.show_from)}`
      : dish.plates_left !== null
        ? `${dish.plates_left} plates left`
        : dish.kind === "week"
          ? "Available all week"
          : "Today only";
  const href = `/dish/${dish.dish_id}?entry=${dish.entry_id}`;

  return (
    <article
      className={`flex w-[250px] flex-none flex-col overflow-hidden rounded-[22px] md:w-auto ${dish.kind === "week" ? "border border-blush-deep bg-white" : "bg-blush"}`}
    >
      <Link href={href} className="photo-placeholder relative block h-[120px] md:h-48">
        {src && <Image src={src} alt={dish.name} fill sizes="(min-width: 768px) 360px, 250px" className="object-cover" />}
        <span
          className={`absolute left-3 top-3 rounded-full px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-wider ${
            dish.kind === "week" ? "bg-white text-coral-ink" : "bg-coral text-ink"
          }`}
        >
          {dish.kind === "week" ? "This week" : "Today only"}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pb-3.5 pt-3 md:px-4 md:pb-4">
        <Link href={href}>
          <h3 className="font-display text-xl leading-tight md:text-[22px]">{dish.name}</h3>
        </Link>
        {dish.description && <p className="hidden text-sm text-ink-soft md:line-clamp-2">{dish.description}</p>}
        <span className={`text-[13px] font-semibold ${dish.kind === "week" ? "text-ink-soft" : "text-coral-ink"}`}>{status}</span>
        <div className="mt-auto flex items-center justify-between pt-0.5">
          <span className="text-base font-bold">{formatKes(dish.price_kes)}</span>
          {orderable &&
            (hasOptions ? (
              <Link href={href} aria-label={`Choose options for ${dish.name}`} className="flex size-11 items-center justify-center rounded-full bg-teal-deep text-white">
                <PlusIcon />
              </Link>
            ) : (
              <AddButton dishId={dish.dish_id} menuEntryId={dish.entry_id} name={dish.name} priceKes={dish.price_kes} rotating variant="solid" />
            ))}
        </div>
      </div>
    </article>
  );
}
