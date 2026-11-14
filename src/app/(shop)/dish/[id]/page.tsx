import { notFound } from "next/navigation";
import { Plate } from "@/components/plate";
import { BackToMenu, DishForm } from "@/components/shop/dish-form";
import { MenuFrame } from "@/components/shop/menu/menu-view";
import { DishPills } from "@/components/shop/menu/pills";
import { formatKes } from "@/lib/format";
import type { MenuDish } from "@/lib/menu-model";
import { loadMenu } from "@/lib/menu-server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string }> };

export default async function DishPage({ params, searchParams }: Props) {
  const [{ id }, { entry }] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  // A malformed entry id just means "not from the menu", same as none.
  const entryId = entry && isUuid(entry) ? entry : null;
  const supabase = await createClient();

  const [dishResult, optionsResult, menu] = await Promise.all([
    supabase.from("dishes").select("id, name, description, price_kes, photo_url, photo_thumb_url, is_regular").eq("id", id).maybeSingle(),
    supabase
      .from("dish_options")
      .select("id, label, price_delta_kes, is_default, kind, out_on")
      .eq("dish_id", id)
      .eq("archived", false)
      .order("sort_order"),
    loadMenu(),
  ]);
  const dish = must(dishResult, "the dish");
  if (!dish) notFound();
  const { model, address, zones } = menu;

  // The dish as the menu shows it for its day: the entry the link came from, else the regular,
  // else any entry of this dish. None: it isn't on that day's menu.
  const all = model.sections.flatMap((s) => s.dishes);
  const mine = all.filter((d) => d.dishId === dish.id);
  const md: MenuDish | null =
    (entryId ? mine.find((d) => d.entryId === entryId) : undefined) ?? mine.find((d) => d.kind === "regular") ?? mine[0] ?? null;

  // A choice marked out is out for that day only; the menu's day decides.
  const options = must(optionsResult, "dish options").map((o) => ({
    id: o.id,
    label: o.label,
    priceKes: o.price_delta_kes,
    isDefault: o.is_default,
    kind: o.kind,
    outToday: o.out_on === model.day,
  }));
  const choices = options.filter((o) => o.kind === "choice");
  const extras = options.filter((o) => o.kind === "extra");
  // Every choice out: the dish can't be ordered.
  const choicesAllOut = choices.length > 0 && choices.every((c) => c.outToday);

  const price = md?.priceKes ?? dish.price_kes;
  const focusKey = md?.key ?? dish.id;

  return (
    <MenuFrame model={model} address={address} zones={zones} onMenu={false}>
      <div className="px-4 pb-[calc(140px+env(safe-area-inset-bottom,0px))] max-[360px]:pb-[calc(196px+env(safe-area-inset-bottom,0px))] pt-3 md:pb-10 lg:px-0 lg:pt-7">
        <BackToMenu focusKey={focusKey} />
        <article className="mt-3 grid gap-7 rounded-[var(--r-lg)] bg-paper p-5 shadow-[var(--shadow-card)] sm:p-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:items-start">
          <div className="flex items-center justify-center rounded-[20px] bg-cream p-6">
            <Plate
              id={dish.id}
              photo={dish.photo_url ?? dish.photo_thumb_url}
              dim={Boolean(md?.soldOut)}
              className="aspect-square w-[min(220px,100%)] xl:w-[min(300px,100%)]"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            <div className="flex flex-col gap-2.5">
              {md && <DishPills dish={md} open={model.open} day={model.dayName} />}
              <h1 className="font-display text-[28px] leading-[1.08] [overflow-wrap:anywhere] xl:text-[34px]">{dish.name}</h1>
              {dish.description && <p className="text-[15.5px] leading-normal text-ink-soft [overflow-wrap:anywhere]">{dish.description}</p>}
              {md?.hours && <p className="text-[14px] text-ink-soft">{md.hours}</p>}
              <p className="text-[22px] font-bold tabular-nums">{formatKes(price)}</p>
            </div>

            <DishForm
              dishId={dish.id}
              menuEntryId={md?.entryId ?? null}
              name={dish.name}
              photo={md?.photo ?? dish.photo_thumb_url}
              basePriceKes={price}
              choices={choices}
              extras={extras}
              rotating={md ? md.kind !== "regular" : false}
              limit={md?.limit ?? null}
              left={md?.left ?? null}
              soldOut={Boolean(md?.soldOut) || choicesAllOut}
              onMenuDay={md !== null}
              hoursText={md?.notNow ?? null}
              dayName={model.dayName}
              focusKey={focusKey}
            />
          </div>
        </article>
      </div>
    </MenuFrame>
  );
}
