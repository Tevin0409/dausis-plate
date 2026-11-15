import { cookies } from "next/headers";
import { MenuView } from "@/components/shop/menu/menu-view";
import { NeighbourAd } from "@/components/shop/neighbour-ad";
import { loadLiveAd } from "@/lib/ads";
import { getKitchen } from "@/lib/kitchen-server";
import { loadMenu } from "@/lib/menu-server";
import { createClient } from "@/lib/supabase/server";
import { parseTableCookie, TABLE_COOKIE, tableExpired } from "@/lib/table-cookie";
import { waiterStatus, type WaiterStatus } from "@/lib/table-requests";

export const dynamic = "force-dynamic";

/** The menu (slice 2.8): see loadMenu for what it reads. */
export default async function MenuPage({ searchParams }: { searchParams: Promise<{ qr?: string }> }) {
  const [{ model, combos, address, zones, soldOutLine }, { qr }, jar, { status }, waiter] = await Promise.all([
    loadMenu(),
    searchParams,
    cookies(),
    getKitchen(),
    tableWaiter(),
  ]);
  // The menu ad only at a table (spec 2.11 Q7 A): the table cookie is set and still good, and the
  // kitchen is open. A closed menu's saved cart has forgotten its table.
  const table = parseTableCookie(jar.get(TABLE_COOKIE)?.value);
  const atTable = table !== null && status.state === "open" && !tableExpired(table.at, status);
  const ad = atTable ? await loadLiveAd("menu") : null;
  return (
    <MenuView
      model={model}
      address={address}
      zones={zones}
      soldOutLine={soldOutLine}
      qrUnknown={qr === "unknown"}
      waiter={waiter}
      combos={combos}
      ad={ad && <NeighbourAd ad={ad} className="mx-4 lg:mx-0" />}
    />
  );
}

/**
 * spec-2.9 Q1 B: at a table, the menu can call a waiter; the table's latest call sets the button.
 * The band shows the button only while the kitchen is open and the table hasn't expired (the cart's table).
 */
async function tableWaiter(): Promise<WaiterStatus> {
  const table = parseTableCookie((await cookies()).get(TABLE_COOKIE)?.value);
  if (!table) return null;
  const { data, error } = await (await createClient()).rpc("table_waiter_status", { p_qr_token: table.token });
  if (error) {
    console.error("[db] table_waiter_status failed:", error.code ?? "", error.message);
    return null;
  }
  return waiterStatus.safeParse(data).data ?? null;
}
