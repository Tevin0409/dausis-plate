/**
 * An order code as the customer typed it, in the stored shape (spec-2.8b §2): "dp-0142", "DP 0142",
 * "0142" and "142" all become "DP-0142". Without digits it stays as typed (find_order then misses).
 */
export function normaliseCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? `DP-${digits.padStart(4, "0")}` : raw.trim();
}
