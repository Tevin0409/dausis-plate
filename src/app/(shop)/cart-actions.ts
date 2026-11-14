"use server";
import { cookies } from "next/headers";
import type { CheckResult } from "@/lib/cart-check";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { TABLE_COOKIE } from "@/lib/table-cookie";

/** check_cart for the saved cart. Null if the check could not run (the cart is left as it is). */
export async function recheckCart(lines: unknown[]): Promise<CheckResult[] | null> {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_cart", { p_lines: lines.slice(0, 30) as Json });
  if (error || !Array.isArray(data)) {
    console.error("[db] check_cart failed:", error?.code ?? "", error?.details ?? "", error?.message ?? "no data");
    return null;
  }
  return data as unknown as CheckResult[];
}

/** The table is forgotten at closing (DESIGN.md "Saved cart"); the items stay in the browser. */
export async function forgetTable(): Promise<void> {
  (await cookies()).delete(TABLE_COOKIE);
}
