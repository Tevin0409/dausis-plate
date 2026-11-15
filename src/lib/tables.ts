// Slice 2.6, Tables & delivery: the rules and wording the panels and their actions share.
import { formatKes } from "@/lib/format";

export const TABLE_MESSAGES = {
  count: "Add between 1 and 50 tables at a time.",
  name: "Give it a name of up to 40 characters.",
  taken: (name: string) => `There’s already a table called ${name}.`,
} as const;

export const ZONE_MESSAGES = {
  name: "Give the zone a name of up to 40 characters.",
  fee: "Fee must be between KSh 0 and 5,000.",
  minimum: "Minimum must be between KSh 0 and 20,000.",
  taken: (name: string) => `There’s already a zone called ${name}.`,
} as const;

export const FEE_MAX = 5000;
export const MINIMUM_MAX = 20000;

/** Labels for `count` new tables after the highest "Table N", skipping any already taken. */
export function nextTableLabels(existing: readonly string[], count: number): string[] {
  const taken = new Set(existing.map((l) => l.trim().toLowerCase()));
  const highest = Math.max(0, ...existing.map((l) => Number(/^table (\d+)$/i.exec(l.trim())?.[1] ?? 0)));
  const out: string[] = [];
  for (let n = highest + 1; out.length < count; n++) if (!taken.has(`table ${n}`)) out.push(`Table ${n}`);
  return out;
}

/** "Adds Table 13 to Table 15", or "Adds Table 13" for one. */
export function addsLine(existing: readonly string[], count: number): string {
  const labels = nextTableLabels(existing, count);
  if (labels.length === 0) return "";
  return labels.length === 1 ? `Adds ${labels[0]}` : `Adds ${labels[0]} to ${labels[labels.length - 1]}`;
}

/** A KSh amount as typed: null when empty, NaN when it isn't a whole number of shillings. */
export function readKes(text: string): number | null {
  const t = text.replace(/[\s,]/g, "");
  if (t === "") return null;
  return /^\d{1,6}$/.test(t) ? Number(t) : Number.NaN;
}

export type ZoneInput = { name: string; fee: number | null; minimum: number | null; active: boolean };
export type ZoneField = "name" | "fee" | "minimum";

/** The first problem with a zone, by field, or null. An empty minimum means no minimum. */
export function zoneProblem(z: ZoneInput): { field: ZoneField; message: string } | null {
  const name = z.name.trim();
  if (name.length === 0 || name.length > 40) return { field: "name", message: ZONE_MESSAGES.name };
  if (z.fee === null || !Number.isInteger(z.fee) || z.fee < 0 || z.fee > FEE_MAX) return { field: "fee", message: ZONE_MESSAGES.fee };
  if (z.minimum !== null && (!Number.isInteger(z.minimum) || z.minimum < 0 || z.minimum > MINIMUM_MAX))
    return { field: "minimum", message: ZONE_MESSAGES.minimum };
  return null;
}

/** A zone row's line: "KSh 150 delivery · KSh 800 minimum", or "· No minimum". */
export function zoneLine(feeKes: number, minOrderKes: number): string {
  const fee = feeKes === 0 ? "Free delivery" : `${formatKes(feeKes)} delivery`;
  return `${fee} · ${minOrderKes > 0 ? `${formatKes(minOrderKes)} minimum` : "No minimum"}`;
}
