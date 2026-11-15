"use server";
import { cookies } from "next/headers";
import type { CheckResult } from "@/lib/cart-check";
import type { Json } from "@/lib/database.types";
import { type CodeCheck, codeReason } from "@/lib/discount-words";
import { normaliseKenyanPhone } from "@/lib/phone";
import type { OrderMode } from "@/lib/promos";
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

const MODES: OrderMode[] = ["dine_in", "pickup", "delivery"];

/**
 * 2.11 C: the cart's and checkout's check of a code. The amounts are the cart's (display) figures;
 * place_order checks everything again from the database. Null: the check could not run.
 */
export async function checkCode(input: {
  code: string;
  foodKes: number;
  coveredKes: number;
  mode?: OrderMode | null;
  phone?: string | null;
}): Promise<CodeCheck | null> {
  const code = String(input.code ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 40);
  const int = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(Math.round(n), 10_000_000)) : 0);
  const mode = MODES.find((m) => m === input.mode) ?? null;
  // A phone that isn't a Kenyan mobile yet isn't checked (the form says why on its own).
  const phone = input.phone ? normaliseKenyanPhone(input.phone) : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_discount_code", {
    p_code: code,
    p_food_kes: int(input.foodKes),
    p_covered_kes: int(input.coveredKes),
    ...(mode ? { p_mode: mode } : {}),
    ...(phone ? { p_phone: phone } : {}),
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    console.error("[db] check_discount_code failed:", error?.code ?? "", error?.message ?? "no data");
    return null;
  }
  return {
    ok: row.ok,
    code: row.code,
    discountKes: row.discount_kes,
    reason: row.ok ? null : (codeReason(row.reason) ?? "unknown"),
    label: row.label,
    startsOn: row.starts_on,
    minOrderKes: row.min_order_kes,
    modes: row.modes ? (row.modes.filter((m) => MODES.includes(m as OrderMode)) as OrderMode[]) : null,
  };
}
