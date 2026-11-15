"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FindResult = { ok: true; token: string } | { ok: false; kind: "no_match" | "paused" | "network" };

const input = z.object({ phone: z.string().trim().min(1).max(40), code: z.string().trim().min(1).max(20) });

/**
 * spec-2.8b §2: an order from the last few days by phone and code. find_order matches the code's
 * digits, counts misses per phone and pauses after 5 in 15 minutes. A miss never says which part
 * was wrong.
 */
export async function findOrder(phone: string, code: string): Promise<FindResult> {
  const parsed = input.safeParse({ phone, code });
  if (!parsed.success) return { ok: false, kind: "no_match" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("find_order", { p_phone: parsed.data.phone, p_code: parsed.data.code });
    if (error) {
      if (error.code === "P0001" && error.details === "lookup_paused") return { ok: false, kind: "paused" };
      console.error("[db] find_order failed:", error.message);
      return { ok: false, kind: "network" };
    }
    return typeof data === "string" ? { ok: true, token: data } : { ok: false, kind: "no_match" };
  } catch (e) {
    console.error("[db] find_order threw:", e);
    return { ok: false, kind: "network" };
  }
}
