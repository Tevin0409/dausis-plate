import { CheckoutForm } from "@/components/shop/checkout-form";
import { Narrow, ScreenHeader } from "@/components/shop/ui";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const supabase = await createClient();
  const { data: zones } = await supabase
    .from("delivery_zones")
    .select("id, name, fee_kes")
    .eq("active", true)
    .order("sort_order");

  return (
    <Narrow>
      <ScreenHeader title="Checkout" back="/cart" />
      <CheckoutForm zones={zones ?? []} />
    </Narrow>
  );
}
