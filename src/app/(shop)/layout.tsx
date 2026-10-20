import { cookies } from "next/headers";
import { CartProvider } from "@/components/shop/cart-provider";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const table = parseTableCookie((await cookies()).get(TABLE_COOKIE)?.value);
  return (
    <CartProvider table={table}>
      <div className="min-h-dvh bg-cream">
        <div className="mx-auto min-h-dvh max-w-md bg-cream pb-28">{children}</div>
      </div>
    </CartProvider>
  );
}
