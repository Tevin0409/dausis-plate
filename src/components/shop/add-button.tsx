"use client";
import { PlusIcon } from "@/components/icons";
import { useCart } from "./cart-provider";

type Props = {
  dishId: string;
  menuEntryId: string | null;
  name: string;
  priceKes: number;
  rotating: boolean;
  variant?: "solid" | "outline";
};

/** One-tap add for dishes without choices. Dishes with options link to the detail page instead. */
export function AddButton({ dishId, menuEntryId, name, priceKes, rotating, variant = "outline" }: Props) {
  const { add } = useCart();
  return (
    <button
      type="button"
      aria-label={`Add ${name}`}
      onClick={() =>
        add({ dishId, menuEntryId, optionId: null, optionLabel: null, name, unitPriceKes: priceKes, note: "", rotating })
      }
      className={
        variant === "solid"
          ? "flex size-11 flex-none items-center justify-center rounded-full bg-teal-deep text-white"
          : "flex size-11 flex-none items-center justify-center rounded-full border-[1.5px] border-teal-deep bg-white text-teal-deep"
      }
    >
      <PlusIcon />
    </button>
  );
}
