import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { AddButton } from "@/components/shop/add-button";
import { CartBar } from "@/components/shop/ui";
import { PlusIcon } from "@/components/icons";
import type { Enums, TodaysMenuRow } from "@/lib/database.types";
import { formatKes, hhmm, nairobiToday, weekdayName } from "@/lib/format";
import { photoUrl } from "@/lib/photos";
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
    supabase.from("todays_menu").select("*").order("sort_order"),
    supabase
      .from("dishes")
      .select("id, name, description, price_kes, photo_key, category, regular_available")
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
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <Image src="/brand/dausis-plate-icon.svg" alt="" width={40} height={40} priority />
          <div className="flex flex-col leading-none">
            <span className="font-display text-[22px]">Dausis Plate</span>
            <span className="mt-0.5 font-script text-base text-ink-soft">Mama’s Flavour.</span>
          </div>
        </div>
        {table && (
          <span className="rounded-full border border-sand-deep bg-white px-3.5 py-2.5 text-sm font-semibold">{table.label}</span>
        )}
      </header>

      <h1 className="px-5 pb-3.5 pt-2 font-display text-[28px] leading-tight">Karibu! What’s on your plate today?</h1>

      <section aria-labelledby="today-heading" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between px-5">
          <div className="flex flex-col gap-0.5">
            <span className="font-script text-xl leading-none text-coral-text">Fresh from Mama’s kitchen</span>
            <h2 id="today-heading" className="font-display text-2xl">{day}’s menu</h2>
          </div>
          <span className="text-[13px] font-semibold text-ink-soft">Changes daily</span>
        </div>

        {rotating.length === 0 ? (
          <p className="mx-5 rounded-2xl bg-blush px-4 py-5 text-[15px] text-coral-ink">
            Today’s dishes are still being planned. The regular menu is below.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto px-5 pb-1">
            {rotating.map((d) => (
              <RotatingCard key={d.entry_id} dish={d} hasOptions={hasOptions.has(d.dish_id)} />
            ))}
          </div>
        )}
      </section>

      <nav aria-label="Menu categories" className="flex gap-2 overflow-x-auto px-5 pb-1.5 pt-5">
        {[...groups.keys()].map((c) => (
          <a key={c} href={`#${c}`} className="flex min-h-10 items-center rounded-full border border-sand-deep bg-white px-4 text-sm font-medium">
            {CATEGORY_LABEL[c]}
          </a>
        ))}
      </nav>

      <div className="px-5">
        <h2 className="mb-1 mt-3 font-display text-xl">Always on the menu</h2>
        {[...groups.entries()].map(([category, dishes]) => (
          <section key={category} id={category} aria-label={CATEGORY_LABEL[category]} className="scroll-mt-4">
            <h3 className="mt-3 text-xs font-bold uppercase tracking-wider text-ink-soft">{CATEGORY_LABEL[category]}</h3>
            {dishes.map((d) => {
              const src = photoUrl(d.photo_key, 160);
              return (
                <div key={d.id} className={`flex items-center gap-3.5 border-b border-sand py-3 ${d.regular_available ? "" : "opacity-60"}`}>
                  <div className="relative size-[68px] flex-none overflow-hidden rounded-2xl bg-teal-tint">
                    {src && <Image src={src} alt="" fill sizes="68px" className="object-cover" />}
                  </div>
                  <Link href={`/dish/${d.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-base font-semibold">{d.name}</span>
                    <span className="text-[13px] text-ink-soft">{d.regular_available ? d.description : "Sold out today"}</span>
                    <span className="text-[15px] font-bold">{formatKes(d.price_kes)}</span>
                  </Link>
                  {d.regular_available &&
                    (hasOptions.has(d.id) ? (
                      <Link href={`/dish/${d.id}`} aria-label={`Choose options for ${d.name}`} className="flex size-11 items-center justify-center rounded-full border-[1.5px] border-teal-deep text-teal-deep">
                        <PlusIcon />
                      </Link>
                    ) : (
                      <AddButton dishId={d.id} menuEntryId={null} name={d.name} priceKes={d.price_kes} rotating={false} />
                    ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <CartBar />
    </>
  );
}

function RotatingCard({ dish, hasOptions }: { dish: TodaysMenuRow; hasOptions: boolean }) {
  const src = photoUrl(dish.photo_key, 520);
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
    <article className={`w-[250px] flex-none overflow-hidden rounded-[22px] ${dish.kind === "week" ? "border border-blush-deep bg-white" : "bg-blush"}`}>
      <Link href={href} className="photo-placeholder relative block h-[120px]">
        {src && <Image src={src} alt={dish.name} fill sizes="250px" className="object-cover" />}
        <span
          className={`absolute left-3 top-3 rounded-full px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-wider ${
            dish.kind === "week" ? "bg-white text-coral-ink" : "bg-coral text-ink"
          }`}
        >
          {dish.kind === "week" ? "This week" : "Today only"}
        </span>
      </Link>
      <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 pt-3">
        <Link href={href}>
          <h3 className="font-display text-xl leading-tight">{dish.name}</h3>
        </Link>
        <span className={`text-[13px] font-semibold ${dish.kind === "week" ? "text-ink-soft" : "text-coral-ink"}`}>{status}</span>
        <div className="mt-0.5 flex items-center justify-between">
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
