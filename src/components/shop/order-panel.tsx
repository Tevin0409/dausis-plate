"use client";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { InfoIcon, TableIcon } from "@/components/icons";
import { formatKes } from "@/lib/format";
import { closedButton } from "@/lib/kitchen";
import { plates } from "@/lib/menu-words";
import { CartLineItem, UndoStrip, useOrderButton } from "./cart-line";
import { useCart } from "./cart-provider";
import { useKitchen } from "./kitchen-provider";

/**
 * Its height is the room left under its top edge, minus 16 px, read again on scroll and resize
 * (spec-2.8 break-ui fix 1): the panel starts under the band, so a fixed calc(100dvh) overshoots.
 * Instant, never animated.
 */
function useFitHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const fit = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const top = Math.max(el.getBoundingClientRect().top, 16);
      el.style.maxHeight = `${Math.max(window.innerHeight - top - 16, 240)}px`;
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);
  return ref;
}

const button =
  "press flex min-h-12 w-full select-none items-center justify-center rounded-full px-5 py-2.5 text-center text-[15px] font-semibold leading-snug touch-manipulation text-balance";

/** The order's main button, shared by the panel and the phone cart. */
export function OrderButton({ className = "" }: { className?: string }) {
  const { kind, subtotalKes } = useOrderButton();
  const { status } = useKitchen();
  if (kind === "checkout")
    return (
      <Link href="/checkout" className={`${button} bg-teal-deep text-white ${className}`}>
        Go to checkout · {formatKes(subtotalKes)}
      </Link>
    );
  return (
    <button type="button" disabled aria-disabled="true" className={`${button} bg-sand-deep text-ink-soft ${className}`}>
      {kind === "nothing" ? "Nothing left to order" : `${closedButton(status)} · ${formatKes(subtotalKes)}`}
    </button>
  );
}

/** "Your order is saved here. Order from 11:00 tomorrow. Plates aren't held until then." */
export function SavedNote({ className = "" }: { className?: string }) {
  const { status } = useKitchen();
  return (
    <p className={`flex gap-2.5 rounded-[var(--r-md)] bg-teal-tint p-3 text-[13.5px] leading-snug text-teal-deeper ${className}`}>
      <InfoIcon size={18} className="mt-px flex-none" />
      <span>
        <strong className="font-semibold">Your order is saved here.</strong> {closedButton(status)}. Plates aren’t held until then.
      </span>
    </p>
  );
}

/** Computer: the "Your order" panel beside the menu (spec-2.8 "The Your order panel"). Phones use the CartBar. */
export function OrderPanel() {
  const { lines, count, subtotalKes, table, lastAdded, removed } = useCart();
  const { open } = useKitchen();
  const ref = useFitHeight();
  const head = useId();
  const atTable = open ? table : null;
  const empty = lines.length === 0;

  return (
    <aside
      ref={ref}
      aria-labelledby={head}
      className="sticky top-4 mt-7 hidden max-h-[calc(100dvh-2rem)] flex-col self-start rounded-[var(--r-lg)] bg-paper shadow-[var(--shadow-card)] ring-1 ring-sand lg:flex"
    >
      <div className="border-b border-sand px-5 pb-3 pt-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={head} className="font-display text-2xl">Your order</h2>
          {count > 0 && <span className="text-[13px] font-semibold text-ink-soft tabular-nums">{plates(count)}</span>}
        </div>
        {atTable && (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-teal-deeper">
            <TableIcon size={16} />
            {atTable.label} · we bring it to you
          </p>
        )}
      </div>

      {empty ? (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span aria-hidden="true" className="size-16 rounded-full ring-[6px] ring-inset ring-sand" />
          <p className="text-[15px] text-ink-soft">Choose + on a dish to start your order.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-sand overflow-y-auto px-5 [overscroll-behavior:contain]">
          {lines.map((l) => (
            <CartLineItem key={l.key} line={l} plate={44} fresh={l.key === lastAdded} />
          ))}
        </ul>
      )}

      {(!empty || removed) && (
        <div className="flex flex-col gap-3 border-t border-sand px-5 pb-[18px] pt-3.5">
          {!empty && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Subtotal</span>
                <span className="text-[17px] font-bold tabular-nums">{formatKes(subtotalKes)}</span>
              </div>
              {open ? (
                <p className="-mt-1.5 text-[13px] text-ink-soft">
                  {atTable ? "No delivery fee at the table." : "Pickup or delivery, and any delivery fee, at checkout."}
                </p>
              ) : (
                <SavedNote />
              )}
            </>
          )}
          <UndoStrip />
          {!empty && <OrderButton />}
        </div>
      )}
    </aside>
  );
}
