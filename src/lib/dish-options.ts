// Slice 2.6: a dish's choices and extras (spec-2.6 "Dish options"). The editor checks these rules
// before it sends anything, the server action checks them again, and save_dish_options is the
// real check. The words match the database's refusals.

export type OptionKind = "choice" | "extra";

/** One row as the editor sends it: position is the order in the list. */
export type OptionInput = { id?: string; kind: OptionKind; label: string; extra: number | null; isDefault: boolean };

export const OPTION_LABEL_MAX = 40;
export const OPTION_PRICE_MAX = 2000;
export const OPTIONS_PER_KIND = 8;

export const OPTION_MESSAGES = {
  label: "Each choice and extra needs a name.",
  labelLong: `A name can be up to ${OPTION_LABEL_MAX} characters.`,
  whole: "A price is in whole shillings.",
  priceMax: "A price can be up to KSh 2,000.",
  freeExtra: "An extra needs a price. If it’s free, make it a choice or put it in the description.",
  oneChoice: "Add a second choice, or remove this one. With one, there’s nothing to choose.",
  manyChoices: "Eight choices is the most a dish can have.",
  manyExtras: "Eight extras is the most a dish can have.",
  duplicate: "Each choice and extra needs a different name.",
  stale: "These options changed since you opened the dish. Refresh the page and try again.",
  shape: "Something went wrong saving the options. Refresh the page.",
} as const;

/** Which row a problem belongs to (index in the list), or null for the list as a whole. */
export type OptionProblem = { message: string; index: number | null; kind: OptionKind | null };

/** The first problem with these rows, in the database's order, or null when they can be saved. */
export function optionProblem(rows: readonly OptionInput[]): OptionProblem | null {
  const at = (i: number, message: string): OptionProblem => ({ message, index: i, kind: rows[i]!.kind });
  for (let i = 0; i < rows.length; i++) if (rows[i]!.label.trim() === "") return at(i, OPTION_MESSAGES.label);
  for (let i = 0; i < rows.length; i++) if (rows[i]!.label.trim().length > OPTION_LABEL_MAX) return at(i, OPTION_MESSAGES.labelLong);
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i]!.extra ?? 0;
    if (!Number.isInteger(p) || p < 0) return at(i, OPTION_MESSAGES.whole);
  }
  for (let i = 0; i < rows.length; i++) if ((rows[i]!.extra ?? 0) > OPTION_PRICE_MAX) return at(i, OPTION_MESSAGES.priceMax);
  for (let i = 0; i < rows.length; i++) if (rows[i]!.kind === "extra" && (rows[i]!.extra ?? 0) < 1) return at(i, OPTION_MESSAGES.freeExtra);
  const choices = rows.filter((r) => r.kind === "choice").length;
  const extras = rows.length - choices;
  if (choices === 1) return { message: OPTION_MESSAGES.oneChoice, index: rows.findIndex((r) => r.kind === "choice"), kind: "choice" };
  if (choices > OPTIONS_PER_KIND) return { message: OPTION_MESSAGES.manyChoices, index: null, kind: "choice" };
  if (extras > OPTIONS_PER_KIND) return { message: OPTION_MESSAGES.manyExtras, index: null, kind: "extra" };
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i]!.label.trim().toLowerCase();
    if (seen.has(k)) return at(i, OPTION_MESSAGES.duplicate);
    seen.add(k);
  }
  return null;
}

/**
 * The price field's text as shillings: "" is null (Included for a choice), digits are the number,
 * anything else is NaN so optionProblem reports "whole shillings".
 */
export function readPrice(text: string): number | null {
  const t = text.trim().replace(/[,\s]/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** "Included", "+ KSh 30". */
export function optionPriceLabel(extra: number): string {
  return extra > 0 ? `+ KSh ${extra.toLocaleString("en-KE")}` : "Included";
}
