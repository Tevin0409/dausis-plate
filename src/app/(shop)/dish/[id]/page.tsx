import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackIcon } from "@/components/icons";
import { DishForm } from "@/components/shop/dish-form";
import { hhmm, weekdayName, nairobiToday } from "@/lib/format";
import type { TodaysMenuRow } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string }> };

export default async function DishPage({ params, searchParams }: Props) {
  const [{ id }, { entry }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const [{ data: dish }, { data: options }, { data: todays }] = await Promise.all([
    supabase.from("dishes").select("id, name, description, price_kes, photo_url, is_regular, regular_available").eq("id", id).maybeSingle(),
    supabase.from("dish_options").select("id, label, price_delta_kes, is_default").eq("dish_id", id).order("sort_order"),
    entry ? supabase.from("todays_menu").select("*").eq("entry_id", entry).returns<TodaysMenuRow[]>().maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!dish) notFound();

  const rotating = todays && todays.dish_id === dish.id ? todays : null;
  const price = rotating?.price_kes ?? dish.price_kes;

  let unavailable: string | null = null;
  if (rotating) {
    if (rotating.sold_out) unavailable = "Sold out for today";
    else if (!rotating.open_now) unavailable = `Orders open ${hhmm(rotating.show_from)}–${hhmm(rotating.show_until)}`;
  } else if (!dish.is_regular) {
    unavailable = "Not on today’s menu";
  } else if (!dish.regular_available) {
    unavailable = "Sold out today";
  }

  const src = dish.photo_url;
  const badge = rotating ? (rotating.kind === "week" ? "This week" : "Today only") : null;

  return (
    <div className="mx-auto max-w-md pb-28 md:grid md:max-w-5xl md:grid-cols-2 md:items-start md:gap-10 md:px-8 md:pb-16 md:pt-10">
      <div className="photo-placeholder relative h-[290px] md:sticky md:top-10 md:h-auto md:aspect-[4/3] md:overflow-hidden md:rounded-[28px]">
        {src && <Image src={src} alt={dish.name} fill sizes="(min-width: 768px) 520px, 100vw" className="object-cover" priority />}
        <Link href="/" aria-label="Back to menu" className="absolute left-4 top-4 flex size-11 items-center justify-center rounded-full bg-white">
          <BackIcon />
        </Link>
      </div>

      <div className="relative -mt-7 flex flex-col gap-[18px] rounded-t-[28px] bg-cream px-5 pt-[22px] md:mt-0 md:px-0 md:pt-0">
        <div className="flex flex-col gap-2">
          {badge && (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-coral px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-wider text-ink">{badge}</span>
              {rotating?.plates_left !== null && rotating?.plates_left !== undefined && (
                <span className="text-[13px] font-semibold text-coral-ink">{rotating.plates_left} plates left</span>
              )}
            </div>
          )}
          <h1 className="font-display text-[30px] leading-[1.08] md:text-[40px]">{dish.name}</h1>
          {dish.description && <p className="text-[15px] leading-normal text-ink-soft">{dish.description}</p>}
          {rotating && (
            <span className="font-script text-xl text-coral-text">
              {rotating.kind === "week" ? "On the menu all week" : `On ${weekdayName(nairobiToday())}’s menu · back another day`}
            </span>
          )}
        </div>

        <DishForm
          dishId={dish.id}
          menuEntryId={rotating?.entry_id ?? null}
          name={dish.name}
          basePriceKes={price}
          options={options ?? []}
          unavailable={unavailable}
          rotating={Boolean(rotating)}
        />
      </div>
    </div>
  );
}
