import Link from "next/link";
import { notFound } from "next/navigation";
import { ComboForm, type ComboFormPart } from "@/components/shop/combo-form";
import { BackToMenu } from "@/components/shop/dish-form";
import { ComboPlates } from "@/components/shop/menu/combo-card";
import { MenuFrame } from "@/components/shop/menu/menu-view";
import { formatKes } from "@/lib/format";
import { loadMenu } from "@/lib/menu-server";
import { comboLine } from "@/lib/promos";
import { createClient } from "@/lib/supabase/server";
import { isUuid, must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

/** The combo sheet (spec-2.11 B): a combo with a choice to make opens here from the menu. */
export default async function ComboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { model, combos, address, zones } = await loadMenu();
  const combo = combos.find((c) => c.id === id) ?? null;
  const focusKey = `combo-${id}`;

  let parts: ComboFormPart[] = [];
  if (combo) {
    const supabase = await createClient();
    const options = must(
      await supabase
        .from("dish_options")
        .select("id, dish_id, label, price_delta_kes, is_default, kind, out_on")
        .in("dish_id", combo.parts.map((p) => p.dishId))
        .eq("archived", false)
        .order("sort_order"),
      "dish options",
    );
    parts = combo.parts.map((p) => {
      const mine = options
        .filter((o) => o.dish_id === p.dishId)
        .map((o) => ({ id: o.id, label: o.label, priceKes: o.price_delta_kes, isDefault: o.is_default, kind: o.kind, outToday: o.out_on === model.day }));
      return { ...p, choices: mine.filter((o) => o.kind === "choice"), extras: mine.filter((o) => o.kind === "extra") };
    });
  }
  const save = combo ? combo.dishesKes - combo.priceKes : 0;

  return (
    <MenuFrame model={model} address={address} zones={zones} onMenu={false}>
      <div className="px-4 pb-[calc(140px+env(safe-area-inset-bottom,0px))] max-[360px]:pb-[calc(196px+env(safe-area-inset-bottom,0px))] pt-3 md:pb-10 lg:px-0 lg:pt-7">
        <BackToMenu focusKey={focusKey} />
        {combo ? (
          <article className="mt-3 flex flex-col gap-7 rounded-[var(--r-lg)] bg-paper p-5 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex items-center gap-4 rounded-[20px] bg-teal-tint p-5">
              <ComboPlates ids={combo.parts.map((p) => p.dishId)} photos={combo.parts.map((p) => p.photo)} className="h-[66px] w-[82px] sm:h-20 sm:w-[100px]" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="font-display text-[28px] leading-[1.08] [overflow-wrap:anywhere]">{combo.name}</h1>
                <p className="text-[15px] text-ink-soft [overflow-wrap:anywhere]">{comboLine(combo.parts)}</p>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[22px] font-bold tabular-nums">{formatKes(combo.priceKes)}</span>
                  {save > 0 && (
                    <>
                      <s className="text-sm tabular-nums text-ink-soft">
                        <span className="sr-only">instead of </span>
                        {formatKes(combo.dishesKes)}
                      </s>
                      <span className="text-[13px] font-semibold text-teal-deep">Save {formatKes(save)}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <ComboForm combo={combo} parts={parts} focusKey={focusKey} />
          </article>
        ) : (
          <div className="mt-3 rounded-[var(--r-lg)] bg-paper p-5 text-[15px] text-ink-soft shadow-[var(--shadow-card)]">
            <p>This combo isn’t on the menu right now.</p>
            <Link href="/" className="mt-3 inline-flex min-h-11 items-center font-semibold text-teal-deep">
              Back to the menu
            </Link>
          </div>
        )}
      </div>
    </MenuFrame>
  );
}
