// Slice 2.6, delivery minimum (Q1 A): food only, before the fee. place_order checks it again.
import { formatKes } from "@/lib/format";

export type ZoneMin = { name: string; feeKes: number; minOrderKes: number };

export const foodSubtotal = (lines: { unitPriceKes: number; quantity: number }[]) => lines.reduce((s, l) => s + l.unitPriceKes * l.quantity, 0);

export const minimumShortfall = (foodKes: number, zone: ZoneMin) => Math.max(0, zone.minOrderKes - foodKes);

export const minimumBlockLine = (shortKes: number, zoneName: string) => `Add ${formatKes(shortKes)} more for delivery to ${zoneName}, or choose pickup.`;

export function zoneOptionLabel(z: ZoneMin): string {
  const parts = [z.name, z.feeKes === 0 ? "Free delivery" : `${formatKes(z.feeKes)} delivery`];
  if (z.minOrderKes > 0) parts.push(`${formatKes(z.minOrderKes)} minimum`);
  return parts.join(" · ");
}
