"use client";
import Link from "next/link";
import { InfoIcon } from "@/components/icons";
import { CartLineItem, UndoStrip } from "@/components/shop/cart-line";
import { useCart } from "@/components/shop/cart-provider";
import { useKitchen } from "@/components/shop/kitchen-provider";
import { OrderButton } from "@/components/shop/order-panel";
import { BottomBar, Narrow, ScreenHeader } from "@/components/shop/ui";
import { formatKes, weekdayName } from "@/lib/format";
import { hoursCard, menuDayOf } from "@/lib/kitchen";

/** Phone: the order (DESIGN.md "Saved cart, closed kitchen" and "Recheck against the next menu"). */
export default function CartPage() {
  const { lines, checks, subtotalKes, lastAdded, removed } = useCart();
  const { open, status } = useKitchen();
  const day = weekdayName(menuDayOf(status));
  const offMenu = lines.filter((l) => checks[l.key]?.state === "not_on_menu").length;
  const opens = hoursCard(status).rest;

  return (
    <Narrow>
      <ScreenHeader title={open ? "Your order" : "Your saved order"} back="/" />

      {!open && lines.length > 0 && (
        <p className="note-in mx-5 mt-2 flex gap-2.5 rounded-[var(--r-md)] bg-teal-tint p-3.5 text-[14px] leading-snug text-teal-deeper">
          <InfoIcon size={18} className="mt-px flex-none" />
          <span>
            <strong className="font-semibold">We’re closed.</strong>{" "}
            {offMenu > 0
              ? "Plates aren’t held until then."
              : `${opens ? `${opens} ` : ""}Your order is saved here. Add to it or change it now, and place it when we open. Plates aren’t held until then.`}
          </span>
        </p>
      )}
      {offMenu > 0 && (
        <p role="status" className="note-in mx-5 mt-2 rounded-[var(--r-md)] bg-amber-tint p-3.5 text-[14px] font-semibold leading-snug text-amber-ink">
          {offMenu === 1 ? `1 dish isn’t on ${day}’s menu.` : `${offMenu} dishes aren’t on ${day}’s menu.`} Your total is now {formatKes(subtotalKes)}.
        </p>
      )}

      {lines.length === 0 ? (
        <>
          <div className="mx-5 mt-6 flex flex-col items-start gap-3 rounded-[var(--r-lg)] bg-paper p-5 ring-1 ring-sand">
            <p className="text-[15px] text-ink-soft">Nothing here yet.</p>
            <Link href="/" className="font-semibold text-teal-deep">See the menu</Link>
          </div>
          {removed && <UndoStrip className="mx-5 mt-3" />}
        </>
      ) : (
        <>
          <ul aria-label="Items" className="mx-5 mt-3 divide-y divide-sand rounded-[var(--r-lg)] bg-paper px-4 shadow-[var(--shadow-card)]">
            {lines.map((l) => (
              <CartLineItem key={l.key} line={l} plate={60} fresh={l.key === lastAdded} />
            ))}
          </ul>
          {removed && <UndoStrip className="mx-5 mt-3" />}

          <section aria-label="Summary" className="mx-5 mt-[22px] flex flex-col gap-2.5 text-[15px]">
            <div className="flex justify-between">
              <span className="text-ink-soft">Subtotal</span>
              <span className="font-semibold tabular-nums">{formatKes(subtotalKes)}</span>
            </div>
            <div className="flex justify-between"><span className="text-ink-soft">Delivery</span><span className="text-ink-soft">Set at checkout</span></div>
          </section>

          <BottomBar inlineOnDesktop="padded">
            <OrderButton className="min-h-14 flex-1" />
          </BottomBar>
        </>
      )}
    </Narrow>
  );
}
