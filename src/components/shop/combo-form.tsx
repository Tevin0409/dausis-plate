"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MinusIcon, PlusIcon } from "@/components/icons";
import type { CartExtra, ComboPart } from "@/lib/cart-lines";
import type { MenuCombo } from "@/lib/menu-model";
import { addedAnnounce, buyButton } from "@/lib/menu-words";
import { useCart } from "./cart-provider";
import { firstChoice, priceText, type ShopOption, useFromMenu } from "./dish-form";
import { useKitchen } from "./kitchen-provider";
import { comboRoom, partsLeft } from "./menu/combo-card";
import { returnTo } from "./menu/return-to";
import { BottomBar } from "./ui";

export type ComboFormPart = MenuCombo["parts"][number] & { choices: ShopOption[]; extras: ShopOption[] };

const stepBtn =
  "press flex size-12 select-none items-center justify-center rounded-full text-teal-deep touch-manipulation disabled:text-ink-soft/50";
const optionRow = (out: boolean, on: boolean) =>
  `press flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[var(--r-md)] px-4 text-[15px] ${
    out ? "cursor-default bg-paper text-ink-soft ring-1 ring-sand-deep" : on ? "bg-teal-tint font-semibold ring-2 ring-teal-deep" : "bg-paper ring-1 ring-sand-deep"
  }`;

/**
 * The dish sheet as a combo sheet (spec-2.11 B): one "Comes with" per dish that has a choice, then
 * extras. A choice's difference and any extras go on top of the combo price, per plate of the dish.
 */
export function ComboForm({ combo, parts, focusKey }: { combo: MenuCombo; parts: ComboFormPart[]; focusKey: string }) {
  const { add, inOrder, count, subtotalKes, announce } = useCart();
  const { open } = useKitchen();
  const router = useRouter();
  const from = useFromMenu();
  const [chosen, setChosen] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(parts.map((p) => [p.dishId, firstChoice(p.choices)])),
  );
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);

  const cartParts: ComboPart[] = parts.map((p) => {
    const option = p.choices.find((o) => o.id === chosen[p.dishId]) ?? null;
    const extras: CartExtra[] = p.extras
      .filter((e) => (ticked[p.dishId] ?? []).includes(e.id) && !e.outToday)
      .map((e) => ({ id: e.id, label: e.label, priceKes: e.priceKes }));
    return { dishId: p.dishId, menuEntryId: p.menuEntryId, optionId: option?.id ?? null, optionLabel: option?.label ?? null, extras, name: p.name, per: p.quantity };
  });
  const unit =
    combo.priceKes +
    cartParts.reduce((sum, cp, i) => {
      const o = parts[i]!.choices.find((c) => c.id === cp.optionId);
      return sum + cp.per * ((o?.priceKes ?? 0) + cp.extras.reduce((n, e) => n + e.priceKes, 0));
    }, 0);
  const room = comboRoom(combo, inOrder);
  const missing = parts.some((p) => p.choices.length > 0 && !chosen[p.dishId]);
  const reason = room === 0 ? "Every plate left is in your order" : missing ? "A choice is sold out today" : null;
  const n = Math.min(qty, Math.max(room, 1));

  // Nothing to choose: no empty block under the hero; the stepper and Add follow it directly (design check 2.11).
  const choosing = parts.some((p) => p.choices.length > 0 || p.extras.length > 0);
  return (
    <form
      className={choosing ? "flex flex-col gap-[18px]" : "contents"}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) return;
        const added = add({
          kind: "combo",
          comboId: combo.id,
          dishId: combo.id,
          menuEntryId: null,
          optionId: null,
          optionLabel: null,
          name: combo.name,
          unitPriceKes: unit,
          note: "",
          quantity: n,
          rotating: false,
          photo: combo.parts[0]?.photo ?? null,
          photo2: combo.parts[1]?.photo ?? null,
          parts: cartParts,
          partsLeft: partsLeft(combo),
        });
        if (added === 0) return;
        announce(addedAnnounce(combo.name, count + added, subtotalKes + added * unit));
        setQty(1);
        if (!window.matchMedia("(min-width: 1024px)").matches) {
          returnTo(focusKey);
          if (from.current) router.back();
          else router.push("/", { scroll: false });
        }
      }}
    >
      {parts.filter((p) => p.choices.length > 0 || p.extras.length > 0).map((p) => (
        <div key={p.dishId} className="flex flex-col gap-[18px]">
          {p.choices.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-bold [overflow-wrap:anywhere]">
                {p.name} <span className="font-medium text-ink-soft">comes with</span>
              </legend>
              {p.choices.map((o) => {
                const on = o.id === chosen[p.dishId];
                return (
                  <label key={o.id} className={optionRow(o.outToday, on)}>
                    <input
                      type="radio"
                      name={`option-${p.dishId}`}
                      checked={on}
                      disabled={o.outToday}
                      onChange={() => setChosen((c) => ({ ...c, [p.dishId]: o.id }))}
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
              <legend className="mb-2 text-base font-bold [overflow-wrap:anywhere]">
                Extras for {p.name} <span className="text-[13px] font-medium text-ink-soft">· optional</span>
              </legend>
              {p.extras.map((o) => {
                const on = (ticked[p.dishId] ?? []).includes(o.id) && !o.outToday;
                return (
                  <label key={o.id} className={optionRow(o.outToday, on)}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={o.outToday}
                      onChange={(e) =>
                        setTicked((t) => {
                          const cur = t[p.dishId] ?? [];
                          return { ...t, [p.dishId]: e.target.checked ? [...cur, o.id] : cur.filter((id) => id !== o.id) };
                        })
                      }
                      className="size-[18px] shrink-0 accent-teal-deep"
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
                    <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-ink-soft">
                      {priceText(o)}
                      {p.quantity > 1 && !o.outToday && o.priceKes > 0 ? ` each` : ""}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>
      ))}

      <BottomBar inlineOnDesktop>
        <div className="flex w-full flex-col gap-2">
          {reason ? (
            <button type="button" disabled aria-disabled="true" className="flex min-h-12 w-full items-center justify-center rounded-full bg-sand-deep px-5 py-2.5 text-center font-semibold text-ink-soft">
              {reason}
            </button>
          ) : (
            <div className="flex items-center gap-3 max-[360px]:flex-col max-[360px]:items-stretch max-[360px]:gap-2">
              <div className="flex flex-none items-center rounded-full max-[360px]:justify-between bg-paper ring-1 ring-sand-deep">
                <button type="button" aria-label="One fewer combo" disabled={n <= 1} onClick={() => setQty(Math.max(1, n - 1))} className={stepBtn}>
                  <MinusIcon size={16} />
                </button>
                <output aria-live="polite" className="min-w-[4.5rem] text-center text-[15px] font-bold tabular-nums">
                  {n}
                </output>
                <button type="button" aria-label="One more combo" disabled={n >= room} onClick={() => setQty(Math.min(room, n + 1))} className={stepBtn}>
                  <PlusIcon size={16} />
                </button>
              </div>
              <button
                type="submit"
                className="press flex min-h-12 flex-1 select-none max-[360px]:flex-none flex-wrap content-center items-center justify-center gap-x-[0.3em] rounded-full bg-teal-deep px-5 py-2.5 text-center font-semibold leading-snug text-white touch-manipulation"
              >
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
        </div>
      </BottomBar>
    </form>
  );
}
