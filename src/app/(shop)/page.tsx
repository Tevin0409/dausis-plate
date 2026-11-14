import { MenuView } from "@/components/shop/menu/menu-view";
import { loadMenu } from "@/lib/menu-server";

export const dynamic = "force-dynamic";

/** The menu (slice 2.8): see loadMenu for what it reads. */
export default async function MenuPage({ searchParams }: { searchParams: Promise<{ qr?: string }> }) {
  const [{ model, address, zones, soldOutLine }, { qr }] = await Promise.all([loadMenu(), searchParams]);
  return <MenuView model={model} address={address} zones={zones} soldOutLine={soldOutLine} qrUnknown={qr === "unknown"} />;
}
