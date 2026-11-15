import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * "Call us" on Find my order and the order-not-found page (question-2.8c, parked with Tevin;
 * recommended on). Set to false to keep the kitchen phone on the status page only (2.6 Q4 A).
 */
export const CALL_US_WHEN_NOT_FOUND = true;

/** The Settings kitchen phone (+254 form) for "Call us", or null when it's off, unset or unreadable. */
export async function callUsPhone(): Promise<string | null> {
  if (!CALL_US_WHEN_NOT_FOUND) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kitchen_place").then(
    (r) => r,
    () => ({ data: null, error: true }),
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const phone = (data as { phone?: unknown }).phone;
  return typeof phone === "string" && phone !== "" ? phone : null;
}
