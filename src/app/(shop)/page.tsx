import { cookies } from "next/headers";
import { MenuView } from "@/components/shop/menu/menu-view";
import { loadMenu } from "@/lib/menu-server";
import { createClient } from "@/lib/supabase/server";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";
import { waiterStatus, type WaiterStatus } from "@/lib/table-requests";

export const dynamic = "force-dynamic";

/** The menu (slice 2.8): see loadMenu for what it reads. */
export default async function MenuPage({ searchParams }: { searchParams: Promise<{ qr?: string }> }) {
  const [{ model, address, zones, soldOutLine }, { qr }, waiter] = await Promise.all([loadMenu(), searchParams, tableWaiter()]);
  return <MenuView model={model} address={address} zones={zones} soldOutLine={soldOutLine} qrUnknown={qr === "unknown"} waiter={waiter} />;
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
