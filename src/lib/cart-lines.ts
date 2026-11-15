// Slice 2.6, customer side of options: cart lines carry ticked extras. Display only: place_order
// reprices everything from the database.

export type CartExtra = { id: string; label: string; priceKes: number };

/** One dish of a combo line (spec-2.11 B): its choice and extras, and how many plates of it one combo holds. */
export type ComboPart = {
  dishId: string;
  menuEntryId: string | null;
  optionId: string | null;
  optionLabel: string | null;
  extras: CartExtra[];
  name: string;
  per: number;
};

/** A combo line's identity: the combo and each dish's choice and extras (not the menu entry, which can move). */
export function comboLineKey(comboId: string, parts: ComboPart[]): string {
  const p = parts.map((x) => [x.dishId, x.optionId ?? "-", x.extras.map((e) => e.id).sort().join(",")].join(":"));
  return ["combo", comboId, ...p].join("|");
}

/** "Beef pilau · With rice, + Avocado" for each dish of a combo, one string per dish. */
export function partLine(part: ComboPart): string {
  const choice = extrasLine(part.optionLabel, part.extras);
  const name = part.per > 1 ? `${part.per}×\u00a0${part.name}` : part.name;
  return choice ? `${name} · ${choice}` : name;
}

/** The line's identity: two plates of a dish with different extras are separate lines. A line with no
 *  extras keeps the key it had before 2.6. */
export function cartLineKey(l: { dishId: string; menuEntryId: string | null; optionId: string | null; note: string; extras: { id: string }[] }): string {
  const base = [l.dishId, l.menuEntryId ?? "-", l.optionId ?? "-", l.note.trim()].join("|");
  if (l.extras.length === 0) return base;
  return `${base}|${l.extras.map((e) => e.id).sort().join(",")}`;
}

const isExtra = (v: unknown): v is CartExtra => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.label === "string" && typeof o.priceKes === "number";
};

const isPart = (v: unknown): v is ComboPart => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.dishId === "string" &&
    typeof o.name === "string" &&
    typeof o.per === "number" &&
    (o.menuEntryId === null || typeof o.menuEntryId === "string") &&
    (o.optionId === null || typeof o.optionId === "string") &&
    Array.isArray(o.extras) &&
    o.extras.every(isExtra)
  );
};

/** A line from localStorage, or null. Carts saved before 2.6 get `extras: []`; a combo line must have whole parts. */
export function readStoredLine<T extends Record<string, unknown>>(v: unknown): (T & { extras: CartExtra[] }) | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== "string" || typeof o.dishId !== "string" || typeof o.quantity !== "number") return null;
  if (o.kind === "combo" && (typeof o.comboId !== "string" || !Array.isArray(o.parts) || o.parts.length === 0 || !o.parts.every(isPart)))
    return null;
  const extras = Array.isArray(o.extras) ? o.extras.filter(isExtra) : [];
  return { ...(o as T), extras };
}

export const unitPriceWithExtras = (baseKes: number, extras: { priceKes: number }[]) => extras.reduce((sum, e) => sum + e.priceKes, baseKes);

/** "With chapati · + Avocado, + Extra egg". An acronym-led label keeps its capitals ("With BBQ sauce"). */
export function extrasLine(choice: string | null, extras: { label: string }[]): string | null {
  const parts: string[] = [];
  if (choice) parts.push(`With ${/^[A-Z][A-Z]/.test(choice) ? choice : choice.charAt(0).toLowerCase() + choice.slice(1)}`);
  if (extras.length > 0) parts.push(extras.map((e) => `+ ${e.label}`).join(", "));
  return parts.length > 0 ? parts.join(" · ") : null;
}
