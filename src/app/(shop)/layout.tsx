import { cookies } from "next/headers";
import { CartProvider } from "@/components/shop/cart-provider";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";

// Each page sets its own width: the menu spreads out on desktop, ordering steps stay focused.
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const table = parseTableCookie((await cookies()).get(TABLE_COOKIE)?.value);
  return (
    <CartProvider table={table}>
      <div className="min-h-dvh bg-cream">{children}</div>
    </CartProvider>
  );
}
