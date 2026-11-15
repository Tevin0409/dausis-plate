// Plain module, so server pages (More) can call these too: values exported from a "use client" file are client references on the server.

export type Role = "owner" | "staff";

/** Shared by rail items, tabs and More rows: press feedback, no tap flash, no long-press selection. */
export const NAV_TOUCH = "press touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]";

/** Display name, or the part of the email before the @: a full email breaks into three lines in the rail. */
export const shortName = (name: string | null, email: string | null) => name?.trim() || email?.split("@")[0] || "Signed in";
export const roleLabel = (role: Role) => (role === "owner" ? "Owner" : "Staff");
