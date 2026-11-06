import Link from "next/link";
import { shopPrimary, shopSecondary } from "@/components/state-styles";

export default function OrderNotFound() {
  const phone = process.env.NEXT_PUBLIC_RESTAURANT_PHONE;
  return (
    <main className="flex flex-col gap-4 px-5 pt-16">
      <h1 className="font-display text-[28px] leading-tight">We can’t find that order</h1>
      <p className="text-[15px] leading-normal text-ink-soft">
        The link may be incomplete. Open it again from the page you saw after ordering{phone ? ", or call us and give your order code" : ""}.
      </p>
      <div className="mt-2 flex flex-col gap-3">
        {phone && <a href={`tel:${phone}`} className={shopPrimary}>Call us</a>}
        <Link href="/" className={phone ? shopSecondary : shopPrimary}>Back to menu</Link>
      </div>
    </main>
  );
}
