import { z } from "zod";
import { nairobiToday } from "./format";
import type { KitchenStatus } from "./kitchen";

export const TABLE_COOKIE = "dp_table";

// `at` (when the QR was scanned, ISO) arrived in 2.8; cookies set before then have none.
const schema = z.object({ token: z.string().min(1), label: z.string().min(1), at: z.string().optional() });
export type TableCookie = z.infer<typeof schema>;

export function parseTableCookie(raw: string | undefined): TableCookie | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A dine-in cart forgets its table at closing and keeps its items (DESIGN.md "Saved cart",
 * Tevin 2026-11-05). The table is gone once the kitchen has closed since the QR was scanned:
 * scanned on an earlier Nairobi day, or before today's closing (or early close) once it is past.
 * Last orders and before opening keep it: the customer may still be at the table.
 */
export function tableExpired(at: string | undefined, s: KitchenStatus): boolean {
  const closedForToday = s.state === "closed" && s.reason !== "before_opening" && s.reason !== "past_last_orders";
  const scanned = at ? Date.parse(at) : NaN;
  if (Number.isNaN(scanned)) return closedForToday;
  if (nairobiToday(new Date(scanned)) < s.today) return true;
  if (!closedForToday) return false;
  const closedAt = s.closed_early_at ?? s.closes_at;
  return closedAt === null || scanned < Date.parse(closedAt);
}
