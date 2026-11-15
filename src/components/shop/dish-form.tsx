"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BackIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { type CartExtra, unitPriceWithExtras } from "@/lib/cart-lines";
import { MAX_PER_LINE } from "@/lib/cart-check";
import { formatKes } from "@/lib/format";
import { addedAnnounce, buyButton, buyHint, cantAddReason, plates } from "@/lib/menu-words";
import { useCart } from "./cart-provider";
import { useKitchen } from "./kitchen-provider";
import { returnTo, takeFromMenu } from "./menu/return-to";
import { BottomBar } from "./ui";

export type ShopOption = { id: string; label: string; priceKes: number; isDefault: boolean; outToday: boolean };

type Props = {
  dishId: string;
  menuEntryId: string | null;
  name: string;
  photo: string | null;
  basePriceKes: number;
  choices: ShopOption[];
  extras: ShopOption[];
  rotating: boolean;
  /** The menu's word on the dish for its day; null when it isn't on that day's menu. */
  limit: number | null;
  left: number | null;
  soldOut: boolean;
  onMenuDay: boolean;
  /** Open, outside its serving hours: spec 2.2's words. */
  hoursText: string | null;
  /** The menu day's name ("Friday"), for the closed words. */
  dayName: string;
  /** The row on the menu to come back to. */
  focusKey: string;
};

export const priceText = (o: ShopOption) => (o.outToday ? "Out today" : o.priceKes === 0 ? "Included" : `+ ${formatKes(o.priceKes)}`);

/** The default choice, or the first one in stock when the default is out today (spec-2.6). */
export function firstChoice(choices: ShopOption[]): string | null {
  const def = choices.find((c) => c.isDefault);
  if (def && !def.outToday) return def.id;
  return choices.find((c) => !c.outToday)?.id ?? null;
}

/** Was this page opened from the menu? Read once, on mount. */
export function useFromMenu() {
  const from = useRef<boolean | null>(null);
  useEffect(() => {
    if (from.current === null) from.current = takeFromMenu();
  }, []);
  return from;
}

/** "Back to the menu" (spec-2.8): to the dish's own row, with its link focused. */
export function BackToMenu({ focusKey }: { focusKey: string }) {
  const router = useRouter();
  const from = useFromMenu();
  return (
    <button
      type="button"
      onClick={() => {
        returnTo(focusKey);
        if (from.current) router.back();
        else router.push("/", { scroll: false });
      }}
      className="press -ml-2 flex min-h-11 select-none items-center gap-1.5 rounded-full px-2 text-[15px] font-semibold text-teal-deep touch-manipulation"
    >
      <BackIcon size={18} />
      Back to the menu
    </button>
  );
}

const stepBtn =
  "press flex size-12 select-none items-center justify-center rounded-full text-teal-deep touch-manipulation disabled:text-ink-soft/50";

export function DishForm(p: Props) {
  const { add, inOrder, count, subtotalKes, announce } = useCart();
  const { open } = useKitchen();
  const router = useRouter();
  const from = useFromMenu();
  const [optionId, setOptionId] = useState<string | null>(() => firstChoice(p.choices));
  const [ticked, setTicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  const option = p.choices.find((o) => o.id === optionId) ?? null;
  // In the dish's order, so the cart line reads the same way the kitchen sees it.
  const chosenExtras: CartExtra[] = p.extras.filter((e) => ticked.includes(e.id)).map((e) => ({ id: e.id, label: e.label, priceKes: e.priceKes }));
  const unit = unitPriceWithExtras(p.basePriceKes + (option?.priceKes ?? 0), chosenExtras);

  const already = p.menuEntryId ? inOrder(p.menuEntryId) : 0;
  const room = p.left == null ? MAX_PER_LINE : Math.max(0, Math.min(MAX_PER_LINE, p.left - already));
  const allInOrder = p.left != null && room === 0;
  const reason = cantAddReason({
    open,
    soldOut: p.soldOut,
    onMenuDay: p.onMenuDay,
    hoursText: p.hoursText,
    allInOrder,
    left: p.left,
    day: open ? "today" : p.dayName,
  });
  const n = Math.min(qty, Math.max(room, 1));
  const hint = reason ? null : buyHint({ open, limit: p.limit, left: p.left, inOrder: already, day: p.dayName });

  return (
    <form
      className="flex flex-col gap-[18px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) return;
        const added = add({
          dishId: p.dishId,
          menuEntryId: p.menuEntryId,
          optionId,
          optionLabel: option?.label ?? null,
          extras: chosenExtras,
          name: p.name,
          unitPriceKes: unit,
          note,
          quantity: n,
          rotating: p.rotating,
          photo: p.photo,
          platesLeft: p.left,
        });
        if (added === 0) return;
        announce(addedAnnounce(p.name, count + added, subtotalKes + added * unit));
        setQty(1);
        // A computer keeps the page: the panel beside it shows the new line. A phone goes back to
        // the menu, as the dish sheet closes after Add (DESIGN.md).
        if (!window.matchMedia("(min-width: 1024px)").matches) {
          returnTo(p.focusKey);
          if (from.current) router.back();
          else router.push("/", { scroll: false });
        }
      }}
    >
      {p.choices.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">Comes with</legend>
          {p.choices.map((o) => {
            const on = o.id === optionId;
            return (
              <label
                key={o.id}
                className={`press flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[var(--r-md)] px-4 text-[15px] ${
                  o.outToday ? "cursor-default bg-paper text-ink-soft ring-1 ring-sand-deep" : on ? "bg-teal-tint font-semibold ring-2 ring-teal-deep" : "bg-paper ring-1 ring-sand-deep"
                }`}
              >
                <input
                  type="radio"
                  name="option"
                  checked={on}
                  disabled={o.outToday}
                  onChange={() => setOptionId(o.id)}
                  className="size-[18px] shrink-0 accent-teal-deep"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-ink-soft">{priceText(o)}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      {p.extras.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">
            Add extras <span className="text-[13px] font-medium text-ink-soft">· optional</span>
          </legend>
          {p.extras.map((o) => {
            const on = ticked.includes(o.id) && !o.outToday;
            return (
              <label
                key={o.id}
                className={`press flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[var(--r-md)] px-4 text-[15px] ${
                  o.outToday ? "cursor-default bg-paper text-ink-soft ring-1 ring-sand-deep" : on ? "bg-teal-tint font-semibold ring-2 ring-teal-deep" : "bg-paper ring-1 ring-sand-deep"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
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
          className="w-full resize-none rounded-[var(--r-md)] border-[1.5px] border-field bg-paper px-3.5 py-3 text-base focus:border-teal-deep focus:outline-none focus:ring-[3px] focus:ring-teal/30"
        />
      </div>

      <BottomBar inlineOnDesktop>
        <div className="flex w-full flex-col gap-2">
          {reason ? (
            <button type="button" disabled aria-disabled="true" className="flex min-h-12 w-full items-center justify-center rounded-full bg-sand-deep px-5 py-2.5 text-center font-semibold text-ink-soft">
              {reason}
            </button>
          ) : (
            <div className="flex items-center gap-3 max-[360px]:flex-col max-[360px]:items-stretch max-[360px]:gap-2">
              {/* Below 360 px the stepper and the button take a row each (dev.designer follow-up to RQA28-02). */}
              <div className="flex flex-none items-center rounded-full max-[360px]:justify-between bg-paper ring-1 ring-sand-deep">
                <button type="button" aria-label={`One fewer plate`} disabled={n <= 1} onClick={() => setQty(Math.max(1, n - 1))} className={stepBtn}>
                  <MinusIcon size={16} />
                </button>
                <output aria-live="polite" className="min-w-[4.5rem] text-center text-[15px] font-bold tabular-nums">
                  {plates(n)}
                </output>
                <button type="button" aria-label={`One more plate`} disabled={n >= room} onClick={() => setQty(Math.min(room, n + 1))} className={stepBtn}>
                  <PlusIcon size={16} />
                </button>
              </div>
              <button
                type="submit"
                className="press flex min-h-12 flex-1 select-none max-[360px]:flex-none flex-wrap content-center items-center justify-center gap-x-[0.3em] rounded-full bg-teal-deep px-5 py-2.5 text-center font-semibold leading-snug text-white touch-manipulation"
              >
                {/* Breaks before the price, never inside it, when a phone wraps the button. */}
                {buyButton(open, unit * n)
                  .split(" · ")
                  .map((part, i) => (
                    <span key={i} className="whitespace-nowrap">
                      {i > 0 && " · "}
                      {part}
                    </span>
                  ))}
              </button>
            </div>
          )}
          {hint && <p className="text-[13px] text-ink-soft">{hint}</p>}
        </div>
      </BottomBar>
    </form>
  );
}
