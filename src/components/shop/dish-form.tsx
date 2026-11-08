"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatKes } from "@/lib/format";
import { type CartExtra, unitPriceWithExtras } from "@/lib/cart-lines";
import { useCart } from "./cart-provider";
import { BottomBar, Stepper } from "./ui";

export type ShopOption = { id: string; label: string; priceKes: number; isDefault: boolean; outToday: boolean };

type Props = {
  dishId: string;
  menuEntryId: string | null;
  name: string;
  basePriceKes: number;
  choices: ShopOption[];
  extras: ShopOption[];
  unavailable: string | null;
  rotating: boolean;
};

const priceText = (o: ShopOption) => (o.outToday ? "Out today" : o.priceKes === 0 ? "Included" : `+ ${formatKes(o.priceKes)}`);

/** The default choice, or the first one in stock when the default is out today (spec-2.6). */
function firstChoice(choices: ShopOption[]): string | null {
  const def = choices.find((c) => c.isDefault);
  if (def && !def.outToday) return def.id;
  return choices.find((c) => !c.outToday)?.id ?? null;
}

export function DishForm({ dishId, menuEntryId, name, basePriceKes, choices, extras, unavailable, rotating }: Props) {
  const { add } = useCart();
  const router = useRouter();
  const [optionId, setOptionId] = useState<string | null>(() => firstChoice(choices));
  const [ticked, setTicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  const option = choices.find((o) => o.id === optionId) ?? null;
  // In the dish's order, so the cart line reads the same way the kitchen sees it.
  const chosenExtras: CartExtra[] = extras.filter((e) => ticked.includes(e.id)).map((e) => ({ id: e.id, label: e.label, priceKes: e.priceKes }));
  const unit = unitPriceWithExtras(basePriceKes + (option?.priceKes ?? 0), chosenExtras);

  return (
    <form
      className="flex flex-col gap-[18px] pb-32 md:pb-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (unavailable) return;
        add({ dishId, menuEntryId, optionId, optionLabel: option?.label ?? null, extras: chosenExtras, name, unitPriceKes: unit, note, quantity: qty, rotating });
        router.push("/cart");
      }}
    >
      {choices.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">
            Choose your side <span className="text-[13px] font-medium text-ink-soft">· pick one</span>
          </legend>
          {choices.map((o) => (
            <label
              key={o.id}
              className={`flex min-h-[52px] items-center gap-3 rounded-[14px] bg-white px-4 text-[15px] ${
                o.outToday ? "border border-sand-deep text-ink-soft" : o.id === optionId ? "border-2 border-teal-deep font-semibold" : "border border-sand-deep"
              }`}
            >
              <input
                type="radio"
                name="option"
                checked={o.id === optionId}
                disabled={o.outToday}
                onChange={() => setOptionId(o.id)}
                className="size-[18px] shrink-0 accent-teal-deep"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-ink-soft">{priceText(o)}</span>
            </label>
          ))}
        </fieldset>
      )}

      {extras.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">
            Add extras <span className="text-[13px] font-medium text-ink-soft">· optional</span>
          </legend>
          {extras.map((o) => {
            const on = ticked.includes(o.id);
            return (
              <label
                key={o.id}
                className={`flex min-h-12 items-center gap-3 rounded-[14px] px-4 text-[15px] ${
                  o.outToday
                    ? "border border-sand-deep bg-white text-ink-soft"
                    : on
                      ? "border-2 border-teal-deep bg-teal-tint font-semibold"
                      : "border border-sand-deep bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on && !o.outToday}
                  disabled={o.outToday}
                  onChange={(e) => setTicked((t) => (e.target.checked ? [...t, o.id] : t.filter((id) => id !== o.id)))}
                  className="size-[18px] shrink-0 accent-teal-deep"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-ink-soft">{priceText(o)}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="note" className="text-base font-bold">Note for the kitchen</label>
        <textarea
          id="note"
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. no onions, extra pili pili"
          className="w-full resize-none rounded-[14px] border border-sand-deep bg-white px-3.5 py-3 text-[15px]"
        />
      </div>

      <BottomBar inlineOnDesktop>
        {unavailable ? (
          <p className="flex min-h-14 flex-1 items-center justify-center rounded-2xl bg-sand font-semibold text-ink-soft">{unavailable}</p>
        ) : (
          <>
            <Stepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(20, n)))} label="plates" />
            <button type="submit" className="flex min-h-14 flex-1 items-center justify-between rounded-2xl bg-teal-deep px-[18px] font-semibold text-white">
              <span>Add to order</span>
              <span>{formatKes(unit * qty)}</span>
            </button>
          </>
        )}
      </BottomBar>
    </form>
  );
}
