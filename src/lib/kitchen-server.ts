import { cache } from "react";
import type { KitchenSnapshot, KitchenStatus } from "./kitchen";
import { createClient } from "./supabase/server";
import { must } from "./supabase/result";

/**
 * The kitchen's status for this request, read once however many components ask.
 * `now` is the server's clock, so a phone with a wrong clock or time zone still gets Nairobi's truth.
 */
export const getKitchen = cache(async (): Promise<KitchenSnapshot> => {
  const supabase = await createClient();
  const status = must(await supabase.rpc("kitchen_status"), "opening hours") as unknown as KitchenStatus;
  return { status, now: new Date().toISOString() };
});
