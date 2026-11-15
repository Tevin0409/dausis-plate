"use server";
import type { KitchenSnapshot, KitchenStatus } from "@/lib/kitchen";
import { createClient } from "@/lib/supabase/server";

/** Read the status again: on focus, at the next change, and after place_order refuses. Null if it failed. */
export async function readKitchen(): Promise<KitchenSnapshot | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kitchen_status");
  if (error || !data) {
    console.error("[db] reading kitchen_status failed:", error?.code ?? "", error?.message ?? "no data");
    return null;
  }
  return { status: data as unknown as KitchenStatus, now: new Date().toISOString() };
}
