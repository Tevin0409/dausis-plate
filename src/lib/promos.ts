// Slice 2.11: the Promos screen's and History's words for ads, in one place. Plain module (no server
// imports), so the page, the client views and the actions all use it.
import type { Database } from "./database.types";
import { formatKes } from "./format";
import { normaliseKenyanPhone } from "./phone";

export type AdSpace = Database["public"]["Enums"]["ad_space"];
export type AdRow = Database["public"]["Functions"]["ads_overview"]["Returns"][number];
export type AdStatus = AdRow["status"];

export const AD_LIMITS = { advertiser: 32, line: 70, place: 40, linkLabel: 24, link: 500, price: 10_000_000 } as const;

/** Space card headings and the "Space" column. */
export const SPACE_HEAD: Record<AdSpace, string> = { menu: "On the menu", order: "On the order page" };
export const SPACE_SHORT: Record<AdSpace, string> = { menu: "Menu", order: "Order page" };
/** In a sentence: "on the menu", "on the order page". */
export const SPACE_IN: Record<AdSpace, string> = { menu: "on the menu", order: "on the order page" };

export const STATUS_LABEL: Record<AdStatus, string> = { draft: "Draft", scheduled: "Scheduled", live: "Live", paused: "Paused", ended: "Ended" };
/** spec 2.11: Draft sand, Scheduled teal tint, Live deeper teal on teal tint, Paused amber tint, Ended sand. */
export const STATUS_TONE: Record<AdStatus, string> = {
  draft: "bg-sand text-ink",
  scheduled: "bg-teal-tint text-ink",
  live: "bg-teal-tint text-teal-deeper",
  paused: "bg-amber-tint text-amber-ink",
  ended: "bg-sand text-ink-soft",
};

const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const parts = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return { d: d.getUTCDate(), m: MONTH.format(d), y: d.getUTCFullYear() };
};

/** "30 Nov". */
export function shortDate(day: string): string {
  const p = parts(day);
  return `${p.d} ${p.m}`;
}

/** "1–30 Nov", "28 Nov – 5 Dec", "28 Dec 2026 – 3 Jan 2027". One day: "30 Nov". */
export function dateRange(from: string, to: string): string {
  if (from === to) return shortDate(from);
  const a = parts(from);
  const b = parts(to);
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${b.m}`;
  return `${a.d} ${a.m} – ${b.d} ${b.m}`;
}

/** An ad's agreed price for its run: "KSh 3,000", "Free", or "No price yet" on a draft. */
export const priceLabel = (kes: number | null) => (kes === null ? "No price yet" : kes === 0 ? "Free" : formatKes(kes));

/**
 * The price field as typed: commas and spaces are dropped ("3,000" is 3000). Empty is null (a draft
 * may have no price yet); anything else that isn't whole shillings from 0 to 10,000,000 is refused.
 */
export function parseAdPrice(input: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = input.replace(/[,\s]/g, "");
  if (!raw) return { ok: true, value: null };
  const n = /^\d{1,8}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n > AD_LIMITS.price) return { ok: false, error: "Put the price in whole shillings, like 3000. Use 0 if it’s free." };
  return { ok: true, value: n };
}
export const PRICE_NEEDED = "Add the price you agreed before approving. Use 0 if it’s free.";
/** Clearing the price of an approved (scheduled, live, paused or ended) ad. */
export const PRICE_KEPT = "An approved ad keeps a price. Use 0 if it’s free.";

/** "1,204". */
export const count = (n: number) => new Intl.NumberFormat("en-KE").format(n);

/**
 * The ad's one link, as typed: an https address, or a Kenyan phone number (which opens as a call).
 * Returns what to store, or the line to show under the field.
 */
export function parseAdLink(input: string): { ok: true; value: string; kind: "web" | "tel" } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Add a web address or a phone number." };
  if (/^https:\/\/\S+$/i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" || !u.hostname.includes(".")) throw new Error("bad");
      const value = u.toString();
      if (value.length > AD_LIMITS.link) return { ok: false, error: "That web address is too long." };
      return { ok: true, value, kind: "web" };
    } catch {
      return { ok: false, error: "That web address doesn’t look right. It starts with https://" };
    }
  }
  if (/^http:\/\//i.test(raw)) return { ok: false, error: "Use the https:// address. Plain http:// isn’t safe to send customers to." };
  const phone = normaliseKenyanPhone(raw);
  if (phone) return { ok: true, value: `tel:${phone}`, kind: "tel" };
  return { ok: false, error: "Use a web address (https://…) or a Kenyan phone number." };
}

/** What the link field shows for a stored link: the phone as typed back, or the address. */
export const linkForField = (stored: string) => (stored.startsWith("tel:+254") ? `0${stored.slice(8)}` : stored);

/** The overlap and state refusals come from the database with their own words; this is the fallback. */
export const AD_ACTION_LABEL = { approve: "Approve", pause: "Pause", resume: "Resume", end: "End now" } as const;
export type AdAction = keyof typeof AD_ACTION_LABEL;

/** The one action a row offers (spec 2.11 list): Approve for a draft, Pause or Resume, or nothing. */
export function rowAction(status: AdStatus): AdAction | null {
  if (status === "draft") return "approve";
  if (status === "live") return "pause";
  if (status === "paused") return "resume";
  return null;
}

// ── Combos (2.11 B)

export const COMBO_MAX_DISHES = 4;
export const COMBO_NAME_MAX = 40;

export type ComboPart = { dish_id: string; name: string; quantity: number };
/** A combo on the Promos screen: `showing` is null when it's switched off. */
export type ComboRow = {
  id: string;
  name: string;
  price_kes: number;
  active: boolean;
  everyday_kes: number;
  parts: ComboPart[];
  showing: { available: boolean; reason: string | null } | null;
};

/** "Beef pilau · 2× Chapati". */
export function comboLine(parts: { name: string; quantity: number }[]) {
  return parts.map((p) => `${p.quantity > 1 ? `${p.quantity}×\u00a0` : ""}${p.name}`).join(" · ");
}

export function comboStatus(c: Pick<ComboRow, "active" | "showing">) {
  if (!c.active || !c.showing) return { text: "Switched off", tone: "off" as const };
  if (c.showing.available) return { text: "Showing now", tone: "on" as const };
  return { text: `Not showing: ${c.showing.reason ?? "a dish can’t be ordered"}`, tone: "warn" as const };
}

/** "Saved X." without doubling a name's own end mark ("Two People!."). */
export const sentenceEnd = (name: string) => (/[.!?…]$/.test(name) ? name : `${name}.`);

// ── Discount codes (2.11 C)

export type OrderMode = Database["public"]["Enums"]["order_mode"];
export const ORDER_MODES: OrderMode[] = ["dine_in", "pickup", "delivery"];
export const MODE_LABEL: Record<OrderMode, string> = { dine_in: "Dine-in", pickup: "Pickup", delivery: "Delivery" };
export const CODE_MAX = 20;
export const CODE_CAP_DEFAULT = 300;

export type CodeKind = "percent" | "amount";
/** A code on the Promos screen, with its figures. */
export type CodeRow = {
  id: string;
  code: string;
  kind: CodeKind;
  value: number;
  cap_kes: number | null;
  starts_on: string;
  ends_on: string;
  max_uses: number | null;
  once_per_phone: boolean;
  min_order_kes: number | null;
  modes: OrderMode[];
  active: boolean;
  uses: number;
  discount_given: number;
};

/** Capitals, letters and numbers only, at most 20: what the code field keeps as you type. */
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_MAX);

/** "10% off, up to KSh 300" / "KSh 100 off". The same words as the database's discount_label. */
export function codeGives(c: { kind: CodeKind; value: number; cap_kes: number | null }) {
  return c.kind === "percent" ? `${c.value}% off, up to ${formatKes(c.cap_kes ?? 0)}` : `${formatKes(c.value)} off`;
}

/** "Dine-in, pickup": the order types in the app's order, sentence case. Empty when all three. */
export function modesLine(modes: OrderMode[]) {
  const on = ORDER_MODES.filter((m) => modes.includes(m));
  if (on.length === ORDER_MODES.length) return "";
  return on.map((m, i) => (i === 0 ? MODE_LABEL[m] : MODE_LABEL[m].toLowerCase())).join(", ");
}

/** The table's short Limits: "Once per phone · Over KSh 800 · Dine-in, pickup", or "No limits". */
export function codeLimits(c: Pick<CodeRow, "once_per_phone" | "min_order_kes" | "modes">) {
  const parts = [c.once_per_phone ? "Once per phone" : "", c.min_order_kes ? `Over ${formatKes(c.min_order_kes)}` : "", modesLine(c.modes)];
  return parts.filter(Boolean).join(" · ") || "No limits";
}

/** "12 of 50" or "12". */
export const codeUsed = (c: Pick<CodeRow, "uses" | "max_uses">) => (c.max_uses ? `${count(c.uses)} of ${count(c.max_uses)}` : count(c.uses));

/** Ended codes (past their end date) go under "Show ended codes". */
export const codeEnded = (c: Pick<CodeRow, "ends_on">, today: string) => c.ends_on < today;

/**
 * The form footer's summary, in words: "10% off food, up to KSh 300, once per phone, until 30 Nov.
 * Not on combos or the delivery fee."
 */
export function codeSummary(c: { kind: CodeKind; value: number | null; cap_kes: number | null; ends_on: string; starts_on: string; once_per_phone: boolean; min_order_kes: number | null; max_uses: number | null; modes: OrderMode[] }, today: string) {
  if (!c.value) return "";
  const gives = c.kind === "percent" ? `${c.value}% off food${c.cap_kes ? `, up to ${formatKes(c.cap_kes)}` : ""}` : `${formatKes(c.value)} off food`;
  const bits = [gives];
  if (c.min_order_kes) bits.push(`on orders of ${formatKes(c.min_order_kes)} or more`);
  if (c.once_per_phone) bits.push("once per phone");
  if (c.max_uses) bits.push(`${count(c.max_uses)} ${c.max_uses === 1 ? "use" : "uses"} in all`);
  if (c.starts_on > today) bits.push(`from ${shortDate(c.starts_on)}`);
  if (c.ends_on) bits.push(`until ${shortDate(c.ends_on)}`);
  const only = modesLine(c.modes);
  return `${bits.join(", ")}.${only ? ` ${only} only.` : ""} Not on combos or the delivery fee.`;
}
