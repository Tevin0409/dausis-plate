"use client";
import Link from "next/link";
import { BackIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { formatKes } from "@/lib/format";
import { useCart } from "./cart-provider";

export function ScreenHeader({ title, back }: { title: string; back: string }) {
  return (
    <header className="flex items-center gap-3 px-5 pb-2 pt-4">
      <Link href={back} aria-label="Back" className="flex size-11 items-center justify-center rounded-full border border-sand bg-white">
        <BackIcon />
      </Link>
      <h1 className="font-display text-[28px]">{title}</h1>
    </header>
  );
}

export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center rounded-xl border border-sand-deep bg-white">
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => onChange(value - 1)} className="flex h-11 w-9 items-center justify-center text-teal-deep">
        <MinusIcon size={16} />
      </button>
      <span className="min-w-4 text-center text-[15px] font-bold" aria-live="polite">{value}</span>
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(value + 1)} className="flex h-11 w-9 items-center justify-center text-teal-deep">
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

export function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-sand bg-cream">
      <div className="mx-auto flex max-w-md gap-3 px-5 pb-6 pt-3.5">{children}</div>
    </div>
  );
}

export function CartBar() {
  const { count, subtotalKes } = useCart();
  if (count === 0) return null;
  return (
    <BottomBar>
      <Link href="/cart" className="flex min-h-14 flex-1 items-center justify-between rounded-[18px] bg-teal-deep px-5 font-semibold text-white">
        <span className="flex items-center gap-2.5">
          <span className="flex size-[26px] items-center justify-center rounded-full bg-white text-[13px] font-bold text-teal-deep">{count}</span>
          View order
        </span>
        <span>{formatKes(subtotalKes)}</span>
      </Link>
    </BottomBar>
  );
}

export const primaryBtn =
  "flex min-h-14 items-center justify-center rounded-[18px] bg-teal-deep px-5 font-semibold text-white disabled:opacity-60";
