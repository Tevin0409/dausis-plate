"use client";
import Link from "next/link";
import { formatKes } from "@/lib/format";
import { useCart } from "./cart-provider";
import { Stepper } from "./ui";

/** Desktop-only sticky order summary beside the menu (phones use the bottom CartBar instead). */
export function OrderPanel() {
  const { lines, subtotalKes, setQuantity, table } = useCart();
  return (
    <aside aria-label="Your order" className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] flex-col rounded-3xl border border-sand bg-white lg:flex">
      <div className="border-b border-sand px-5 py-4">
        <h2 className="font-display text-2xl">Your order</h2>
        {table && <p className="text-sm text-ink-soft">{table.label} · dine-in</p>}
      </div>
      {lines.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-ink-soft">Tap + on a dish to start your order.</p>
      ) : (
        <>
          <ul className="flex-1 overflow-y-auto px-5">
            {lines.map((l, i) => (
              <li key={l.key} className={`flex items-start gap-3 py-3.5 ${i > 0 ? "border-t border-sand" : ""}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold leading-snug">{l.name}</span>
                  {l.optionLabel && <span className="text-[13px] text-ink-soft">{l.optionLabel}</span>}
                  {l.note && <span className="text-[13px] text-ink-soft">“{l.note}”</span>}
                  <span className="text-sm font-bold">{formatKes(l.unitPriceKes * l.quantity)}</span>
                </div>
                <Stepper value={l.quantity} onChange={(n) => setQuantity(l.key, n)} label={l.name} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t border-sand px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Subtotal</span>
              <span className="font-display text-2xl">{formatKes(subtotalKes)}</span>
            </div>
            <Link href="/checkout" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-teal-deep font-semibold text-white">
              Go to checkout
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}
