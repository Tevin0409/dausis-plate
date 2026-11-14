import Link from "next/link";
import { shopPrimary, shopSecondary } from "@/components/state-styles";
import { callUsPhone } from "@/lib/call-us";

export default async function OrderNotFound() {
  const phone = await callUsPhone();
  return (
    <main className="flex flex-col gap-4 px-5 pt-16 md:mx-auto md:max-w-xl">
      <h1 className="font-display text-[28px] leading-tight">We can’t find that order</h1>
      <p className="text-[15px] leading-normal text-ink-soft">
        The link may be cut short. Find it with your phone number and order code, or open the link again from where you saved it.
      </p>
      <div className="mt-2 flex flex-col gap-3">
        <Link href="/order/find" className={shopPrimary}>Find my order</Link>
        <Link href="/" className={shopSecondary}>Back to menu</Link>
        {phone && (
          <a href={`tel:${phone}`} className="flex min-h-11 items-center justify-center font-semibold text-teal-deep underline underline-offset-2">
            Call us
          </a>
        )}
      </div>
    </main>
  );
}
