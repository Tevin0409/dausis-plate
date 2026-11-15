import { pickPill, platesPill, type PillTone } from "@/lib/menu-words";
import type { MenuDish } from "@/lib/menu-model";

const TONE: Record<PillTone, string> = {
  teal: "bg-teal-tint text-teal-deeper",
  amber: "bg-amber-tint text-amber-ink",
  sand: "bg-sand text-ink",
  blush: "bg-blush text-coral-ink",
};

export function Pill({ text, tone }: { text: string; tone: PillTone }) {
  return (
    <span className={`inline-flex h-6 flex-none items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold tabular-nums ${TONE[tone]}`}>
      {text}
    </span>
  );
}

/** Mama's pick first, then the plates pill (spec-2.8 "Pills", spec 2.11 A). */
export function DishPills({ dish, open, day }: { dish: MenuDish; open: boolean; day: string }) {
  const pill = platesPill({ open, limit: dish.limit, left: dish.left, soldOut: dish.soldOut, day });
  if (!pill && !dish.pick) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {dish.pick && <Pill {...pickPill} />}
      {pill && <Pill {...pill} />}
    </div>
  );
}
