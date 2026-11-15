// Slice 2.3: the four jobs Mama can hand to one person (spec-2.3-roles.md "The rules").
// The screens use this to leave out controls; the database is the real check.

export const GRANTS = ["everyday_menu", "dishes_prices", "tables_delivery", "close_early"] as const;
export type Grant = (typeof GRANTS)[number];

export type Permissions = { role: "owner" | "staff"; grants: readonly Grant[] };

/** Owners hold every job; staff hold the ones switched on for them. */
export const can = (who: Permissions, job: Grant) => who.role === "owner" || who.grants.includes(job);

/** The quiet line staff see where a job's controls are left out, and the database's refusal text. */
export const OWNER_ONLY: Record<Grant | "owner", string> = {
  everyday_menu: "Only the owner can change the everyday menu.",
  dishes_prices: "Only the owner can change dishes and prices.",
  tables_delivery: "Only the owner can change tables and delivery zones.",
  close_early: "Only the owner can close the kitchen early.",
  owner: "Only the owner can do this.",
};
