"use client";
import Link from "next/link";
import { ArrowIcon } from "@/components/icons";
import { useCart } from "@/components/shop/cart-provider";
import { BottomBar, ScreenHeader, Stepper } from "@/components/shop/ui";
import { formatKes } from "@/lib/format";

export default function CartPage() {
  const { lines, subtotalKes, setQuantity } = useCart();

  return (
    <>
      <ScreenHeader title="Your order" back="/" />

      {lines.length === 0 ? (
        <div className="mx-5 mt-6 flex flex-col items-start gap-3 rounded-[20px] border border-sand bg-white p-5">
          <p className="text-[15px] text-ink-soft">Nothing here yet.</p>
          <Link href="/" className="font-semibold text-teal-deep">See today’s menu</Link>
        </div>
      ) : (
        <>
          <section aria-label="Items" className="mx-5 mt-3 rounded-[20px] border border-sand bg-white px-4 py-1">
            {lines.map((l, i) => (
              <div key={l.key} className={`flex items-start gap-3 py-3.5 ${i > 0 ? "border-t border-sand" : ""}`}>
                <div className={`size-14 flex-none rounded-[14px] ${l.rotating ? "photo-placeholder" : "bg-teal-tint"}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {l.rotating && <span className="text-[11px] font-bold uppercase tracking-wider text-coral-text">Today’s menu</span>}
                  <span className="text-[15px] font-semibold">{l.name}</span>
                  {l.optionLabel && <span className="text-[13px] text-ink-soft">{l.optionLabel}</span>}
                  {l.note && <span className="text-[13px] text-ink-soft">Note: {l.note}</span>}
                  <span className="mt-0.5 text-[15px] font-bold">{formatKes(l.unitPriceKes * l.quantity)}</span>
                </div>
                <Stepper value={l.quantity} onChange={(n) => setQuantity(l.key, n)} label={l.name} />
              </div>
            ))}
          </section>

          <section aria-label="Summary" className="mx-5 mt-[22px] flex flex-col gap-2.5 text-[15px]">
            <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span className="font-semibold">{formatKes(subtotalKes)}</span></div>
            <div className="flex justify-between"><span className="text-ink-soft">Delivery</span><span className="text-ink-soft">Set at checkout</span></div>
          </section>

          <BottomBar>
            <Link href="/checkout" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-[18px] bg-teal-deep font-semibold text-white">
              Go to checkout <ArrowIcon />
            </Link>
          </BottomBar>
        </>
      )}
    </>
  );
}
