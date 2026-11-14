"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { addedAnnounce, addLabel } from "@/lib/menu-words";
import { useCart } from "./cart-provider";
import { useKitchen } from "./kitchen-provider";

type Props = {
  dishId: string;
  menuEntryId: string | null;
  name: string;
  priceKes: number;
  rotating: boolean;
  /** Plates left for the entry from the menu; null when there is no limit. */
  left: number | null;
  hasOptions: boolean;
  /** Where + goes for a dish with options. */
  href: string;
  photo: string | null;
};

const ADDED_MS = 900;
const circle =
  "add-btn press relative z-[2] flex size-12 flex-none items-center justify-center rounded-full bg-teal-deep text-white touch-manipulation select-none";

// DESIGN.md: the plus at stroke 2.4.
const Plus = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className="add-icon">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * The menu's + (DESIGN.md "Add button"): 48 px, a check for 900 ms after adding. While closed it
 * adds to the saved order. Off once every plate left is in the order. A dish with options opens
 * its page instead.
 */
export function AddButton({ dishId, menuEntryId, name, priceKes, rotating, left, hasOptions, href, photo }: Props) {
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

  const allInOrder = menuEntryId !== null && left !== null && inOrder(menuEntryId) >= left;
  const { label, disabled, title } = addLabel({ name, open, hasOptions, allInOrder, left });

  if (hasOptions)
    return (
      <Link href={href} aria-label={label} className={circle}>
        <Plus />
      </Link>
    );

  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      data-added={added ? "" : undefined}
      onClick={() => {
        const n = add({ dishId, menuEntryId, optionId: null, optionLabel: null, name, unitPriceKes: priceKes, note: "", rotating, photo, platesLeft: left });
        if (n === 0) return;
        announce(addedAnnounce(name, count + n, subtotalKes + n * priceKes));
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
