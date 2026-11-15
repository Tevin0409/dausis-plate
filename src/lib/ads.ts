import "server-only";
import type { Database } from "./database.types";
import { createClient } from "./supabase/server";

// Slice 2.11 A: the neighbour ad a customer page shows, if any (DESIGN.md "Ad placement format").
export type AdSpace = Database["public"]["Enums"]["ad_space"];
export type LiveAd = Database["public"]["Functions"]["live_ads"]["Returns"][number];

/**
 * The live ad for a space, or null. An ad is never worth breaking the page for: a failed read is
 * logged and the page shows no ad.
 */
export async function loadLiveAd(space: AdSpace): Promise<LiveAd | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("live_ads", { p_space: space });
  if (error) {
    console.error(`[db] live_ads(${space}) failed:`, error.message);
    return null;
  }
  return data?.[0] ?? null;
}
