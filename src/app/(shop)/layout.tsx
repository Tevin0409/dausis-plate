import { cookies } from "next/headers";
import { OrderAnnouncer } from "@/components/shop/cart-line";
import { CartProvider } from "@/components/shop/cart-provider";
import { KitchenProvider } from "@/components/shop/kitchen-provider";
import { getKitchen } from "@/lib/kitchen-server";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";

// Each page sets its own width: the menu spreads out on desktop, ordering steps stay focused.
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [jar, kitchen] = await Promise.all([cookies(), getKitchen()]);
  const table = parseTableCookie(jar.get(TABLE_COOKIE)?.value);
  return (
    <KitchenProvider initial={kitchen}>
      <CartProvider table={table}>
        <div className="min-h-dvh bg-cream">{children}</div>
        <OrderAnnouncer />
      </CartProvider>
    </KitchenProvider>
  );
}
