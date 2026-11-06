import { CheckoutForm } from "@/components/shop/checkout-form";
import { Narrow, ScreenHeader } from "@/components/shop/ui";
import { createClient } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const supabase = await createClient();
  // Without this, a failed read would look like "no delivery here".
  const zones = must(
    await supabase.from("delivery_zones").select("id, name, fee_kes").eq("active", true).order("sort_order"),
    "delivery areas",
  );

  return (
    <Narrow>
      <ScreenHeader title="Checkout" back="/cart" />
      <CheckoutForm zones={zones} />
    </Narrow>
  );
}
