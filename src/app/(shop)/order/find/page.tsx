import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon } from "@/components/icons";
import { callUsPhone } from "@/lib/call-us";
import { createClient } from "@/lib/supabase/server";
import { FindOrderForm } from "./find-form";

export const metadata: Metadata = { title: "Find my order", robots: { index: false, follow: false } };

export default async function FindOrderPage() {
  // The window comes from the database (order_lookup_days), never a literal here.
  const supabase = await createClient();
  const { data } = await supabase.rpc("order_lookup_days").then(
    (r) => r,
    () => ({ data: null }),
  );
  const days = typeof data === "number" && data > 0 ? data : null;
  const phone = await callUsPhone();

  return (
    <main className="mx-auto max-w-md pb-16 md:max-w-xl md:pt-6">
      <header className="flex flex-col items-start gap-1 px-5 pt-3">
        <Link
          href="/"
          className="press -ml-2 flex min-h-11 select-none items-center gap-1.5 rounded-full px-2 text-[15px] font-semibold text-teal-deep touch-manipulation"
        >
          <BackIcon size={18} />
          Back to the menu
        </Link>
        <h1 className="font-display text-[22px] leading-tight">Find my order</h1>
      </header>
      <FindOrderForm days={days} phone={phone} />
    </main>
  );
}
