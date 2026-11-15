import Link from "next/link";
import { Plate } from "@/components/plate";
import type { MenuDish } from "@/lib/menu-model";
import { formatKes } from "@/lib/format";
import { AddButton } from "../add-button";
import { RatingMeta } from "../rating-meta";
import { DishPills } from "./pills";

export const dishHref = (d: MenuDish) => (d.entryId ? `/dish/${d.dishId}?entry=${d.entryId}` : `/dish/${d.dishId}`);

type CardProps = { dish: MenuDish; open: boolean; day: string; soldOutLine: string };

/** + or the reason there is none: sold out, or (open) outside the dish's serving hours. */
function Action({ dish }: { dish: MenuDish }) {
  if (dish.soldOut) return <span className="flex-none text-[13px] font-semibold text-ink-soft">Sold out</span>;
  if (!dish.canAdd) return null;
  return (
    <AddButton
      dishId={dish.dishId}
      menuEntryId={dish.entryId}
      name={dish.name}
      priceKes={dish.priceKes}
      rotating={dish.kind !== "regular"}
      left={dish.left}
      hasOptions={dish.hasOptions}
      href={dishHref(dish)}
      photo={dish.photo}
    />
  );
}

function DishLink({ dish, className }: { dish: MenuDish; className: string }) {
  return (
    <Link href={dishHref(dish)} className={`dish-link dish-name ${className}`} id={`dish-${dish.key}`}>
      {dish.name}
      <span className="sr-only">, {formatKes(dish.priceKes)}</span>
    </Link>
  );
}

/**
 * Today and This week (DESIGN.md "Today tile", spec-2.8 "Tiles"). The plate sits half off the edge
 * and alternates sides. On a phone a week dish is smaller (plate 76), on a computer it is a full tile.
 */
export function DishTile({ dish, open, day, index }: CardProps & { index: number }) {
  const flip = index % 2 === 1;
  const week = dish.kind === "week";
  return (
    <article
      className={`dish-card relative overflow-hidden rounded-[var(--r-lg)] bg-paper p-[18px] shadow-[var(--shadow-card)] ${
        week ? "min-h-[112px] lg:min-h-[196px] xl:min-h-[200px]" : "min-h-[176px] lg:min-h-[196px] xl:min-h-[200px]"
      } ${week ? `pr-[104px] ${flip ? "max-lg:pl-[18px]" : ""}` : flip ? "pl-[124px]" : "pr-[124px]"} ${
        flip ? "lg:pl-[150px] lg:pr-[18px] xl:pl-[200px]" : "lg:pr-[150px] xl:pr-[200px]"
      }`}
    >
      <Plate
        id={dish.dishId}
        photo={dish.photo}
        dim={dish.soldOut}
        className={`absolute ${
          week
            ? "right-[14px] top-[18px] size-[76px]"
            : `${flip ? "-left-[34px]" : "-right-[34px]"} top-[18px] size-[150px]`
        } ${flip ? "lg:-left-[18px] lg:right-auto" : "lg:-right-[18px] lg:left-auto"} lg:top-[22px] lg:size-[150px] ${
          flip ? "xl:-left-[22px]" : "xl:-right-[22px]"
        } xl:top-[2px] xl:size-[196px]`}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <DishPills dish={dish} open={open} day={day} />
        <h3 className={`font-display leading-tight ${week ? "text-[21px]" : "text-2xl"} line-clamp-3 [overflow-wrap:anywhere] lg:text-[21px] xl:text-2xl ${dish.soldOut ? "text-ink-soft" : ""}`}>
          <DishLink dish={dish} className="" />
        </h3>
        {dish.description && (
          <p className="line-clamp-3 text-sm text-ink-soft [overflow-wrap:anywhere]">{dish.description}</p>
        )}
        {dish.hours && <p className="text-[13px] font-semibold text-ink-soft">{dish.hours}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-1">
          <span className="text-lg font-bold tabular-nums">{formatKes(dish.priceKes)}</span>
          <RatingMeta avg={dish.ratingAvg} count={dish.ratingCount} />
          <Action dish={dish} />
        </div>
      </div>
    </article>
  );
}

/** Everyday dishes (DESIGN.md "Dish row", spec-2.8 "Dish rows"). */
export function DishRow({ dish, soldOutLine }: CardProps) {
  return (
    <li className="dish-card relative flex min-h-[84px] items-center gap-3.5 px-4 py-3">
      <Plate id={dish.dishId} photo={dish.photo} dim={dish.soldOut} className="size-[60px] lg:size-16" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`line-clamp-3 text-base font-semibold [overflow-wrap:anywhere] ${dish.soldOut ? "text-ink-soft" : ""}`}>
          <DishLink dish={dish} className="" />
        </span>
        {(dish.soldOut || dish.description) && (
          <span className="line-clamp-2 text-[13.5px] text-ink-soft [overflow-wrap:anywhere]">{dish.soldOut ? soldOutLine : dish.description}</span>
        )}
        {/* Phone: the price sits under the name (DESIGN.md "Dish row"); a computer has room on the right. */}
        <span className="flex flex-wrap items-center gap-x-2.5">
          <span className="text-[15px] font-bold tabular-nums lg:hidden">{formatKes(dish.priceKes)}</span>
          <RatingMeta avg={dish.ratingAvg} count={dish.ratingCount} />
        </span>
      </div>
      <div className="flex flex-none items-center gap-3">
        <span className="hidden text-base font-bold tabular-nums lg:inline">{formatKes(dish.priceKes)}</span>
        <Action dish={dish} />
      </div>
    </li>
  );
}
