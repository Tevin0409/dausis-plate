"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Plate } from "@/components/plate";
import type { ComboPart } from "@/lib/cart-lines";
import { formatKes } from "@/lib/format";
import type { MenuCombo } from "@/lib/menu-model";
import { addedAnnounce } from "@/lib/menu-words";
import { comboLine } from "@/lib/promos";
import { useCart } from "../cart-provider";
import { useKitchen } from "../kitchen-provider";

const ADDED_MS = 900;
const circle =
  "add-btn press relative z-[2] flex size-12 flex-none items-center justify-center rounded-full bg-teal-deep text-white touch-manipulation select-none";

const Plus = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className="add-icon">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const comboHref = (id: string) => `/combo/${id}`;

/** The combo's dishes with no choices made: what one tap adds. */
export const plainParts = (c: MenuCombo): ComboPart[] =>
  c.parts.map((p) => ({ dishId: p.dishId, menuEntryId: p.menuEntryId, optionId: null, optionLabel: null, extras: [], name: p.name, per: p.quantity }));

export const partsLeft = (c: MenuCombo) =>
  Object.fromEntries(c.parts.filter((p) => p.menuEntryId).map((p) => [p.menuEntryId as string, p.left]));

/** How many more of this combo the plates left allow, given what the order already holds. */
export function comboRoom(c: MenuCombo, inOrder: (entry: string) => number) {
  let room = 20;
  for (const p of c.parts) if (p.menuEntryId && p.left != null) room = Math.min(room, Math.floor((p.left - inOrder(p.menuEntryId)) / p.quantity));
  return Math.max(0, room);
}

function ComboAdd({ combo }: { combo: MenuCombo }) {
  const { add, inOrder, count, subtotalKes, announce } = useCart();
  const { open } = useKitchen();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const label = `Add ${combo.name}, ${formatKes(combo.priceKes)}`;

  if (combo.hasChoices)
    return (
      <Link href={comboHref(combo.id)} aria-label={`Choose for ${combo.name}, ${formatKes(combo.priceKes)}`} className={circle}>
        <Plus />
      </Link>
    );

  const full = comboRoom(combo, inOrder) === 0;
  return (
    <button
      type="button"
      aria-label={full ? `Every plate left for ${combo.name} is in your order` : open ? label : `${label}, to your saved order`}
      title={full ? "That’s every plate left" : undefined}
      disabled={full}
      data-added={added ? "" : undefined}
      onClick={() => {
        const n = add({
          kind: "combo",
          comboId: combo.id,
          dishId: combo.id,
          menuEntryId: null,
          optionId: null,
          optionLabel: null,
          name: combo.name,
          unitPriceKes: combo.priceKes,
          note: "",
          rotating: false,
          photo: combo.parts[0]?.photo ?? null,
          photo2: combo.parts[1]?.photo ?? null,
          parts: plainParts(combo),
          partsLeft: partsLeft(combo),
        });
        if (n === 0) return;
        announce(addedAnnounce(combo.name, count + n, subtotalKes + n * combo.priceKes));
        setAdded(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAdded(false), ADDED_MS);
      }}
      className={`${circle} disabled:bg-sand disabled:text-ink-soft`}
    >
      <Plus />
      <CheckIcon size={18} className="add-check" />
    </button>
  );
}

/** Two overlapping plates: the combo's first two dishes. */
export function ComboPlates({ ids, photos, className = "" }: { ids: string[]; photos: (string | null)[]; className?: string }) {
  return (
    <div className={`relative flex-none ${className}`} aria-hidden>
      <Plate id={ids[0] ?? "a"} photo={photos[0] ?? null} className="absolute left-0 top-0 size-[52px] sm:size-16" />
      {ids[1] && <Plate id={ids[1]} photo={photos[1] ?? null} className="absolute left-[30px] top-[14px] size-[52px] ring-2 ring-teal-tint sm:left-9 sm:top-4 sm:size-16" />}
    </div>
  );
}

/** The combo card (spec-2.11 "Customer: menu — combo card"): teal tint, after today's dishes. */
export function ComboCard({ combo }: { combo: MenuCombo }) {
  const save = combo.dishesKes - combo.priceKes;
  return (
    <article className="relative flex items-center gap-3.5 rounded-[var(--r-lg)] bg-teal-tint p-[14px] sm:p-[18px]">
      <ComboPlates ids={combo.parts.map((p) => p.dishId)} photos={combo.parts.map((p) => p.photo)} className="h-[66px] w-[82px] sm:h-20 sm:w-[100px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-display text-[21px] leading-tight [overflow-wrap:anywhere]">
          {combo.hasChoices ? (
            <Link href={comboHref(combo.id)} className="dish-link" id={`dish-combo-${combo.id}`}>
              {combo.name}
            </Link>
          ) : (
            combo.name
          )}
        </h3>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{comboLine(combo.parts)}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
          <span className="text-base font-bold tabular-nums">{formatKes(combo.priceKes)}</span>
          {save > 0 && (
            <>
              <s className="text-sm tabular-nums text-ink-soft">
                <span className="sr-only">instead of </span>
                {formatKes(combo.dishesKes)}
              </s>
              <span className="text-[13px] font-semibold text-teal-deep max-sm:basis-full">Save {formatKes(save)}</span>
            </>
          )}
        </p>
      </div>
      <ComboAdd combo={combo} />
    </article>
  );
}
