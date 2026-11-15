// Slice 2.3: the History's sentences (spec-2.3-roles.md "Sentences"). Plain module, so the server
// page and the client list both use it. Each line is a list of pieces; bold pieces are the person
// and the subject, set in 600.

import { addDays, dayLabel, formatKes, timeLabel, weekdayName } from "@/lib/format";
import { REASON_LABEL, TITLES } from "@/lib/board";
import type { Grant } from "@/lib/permissions";
import { daysLabel } from "@/lib/planner";
import { codeGives, dateRange, shortDate, SPACE_IN, type AdSpace } from "@/lib/promos";

export const AREAS = ["menu", "orders", "tables", "team", "settings", "ratings", "promos"] as const;
export type Area = (typeof AREAS)[number];

export type ChangeRow = {
  id: number;
  at: string;
  actor: string | null;
  actor_name: string;
  area: Area;
  action: string;
  subject_label: string | null;
  before: unknown;
  after: unknown;
};

export type Piece = { text: string; bold?: boolean; nowrap?: boolean };

/** Rows per page and per "Show older". */
export const PAGE = 50;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown) => (typeof v === "number" ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

// The board's own column titles (spec-2.4: Cooking, On the way, Done).
const COLUMN: Record<string, string> = TITLES;
const CATEGORY: Record<string, string> = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" };
const JOB_LET: Record<Grant, string> = {
  everyday_menu: "change the everyday menu",
  dishes_prices: "add and edit dishes and prices",
  tables_delivery: "change tables and delivery zones",
  close_early: "close the kitchen early",
};
const JOB_STOP: Record<Grant, string> = {
  everyday_menu: "changing the everyday menu",
  dishes_prices: "adding and editing dishes and prices",
  tables_delivery: "changing tables and delivery zones",
  close_early: "closing the kitchen early",
};

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** "Thursday 4 November". */
export const longDay = (day: string) => dayLabel(day, "long").replace(",", "");
const weekday = (v: unknown) => (isDay(v) ? weekdayName(v) : "a day");
const kes = (v: unknown) => (num(v) === null ? "no price" : formatKes(num(v)!));
/** A code's "10% off, up to KSh 300" from its History snapshot, or null. */
const codeGivesOf = (v: Record<string, unknown>) =>
  (v.kind === "percent" || v.kind === "amount") && num(v.value) !== null ? codeGives({ kind: v.kind, value: num(v.value)!, cap_kes: num(v.cap_kes) }) : null;
/** "Beef pilau · 2× Chapati" from a combo snapshot's dishes. */
const comboDishes = (v: unknown) =>
  Array.isArray(v)
    ? v.map((d: { name?: unknown; quantity?: unknown }) => `${num(d.quantity) && num(d.quantity)! > 1 ? `${num(d.quantity)}× ` : ""}${str(d.name) ?? "a dish"}`).join(" · ")
    : "its dishes";
const plates = (v: unknown) => (num(v) === null ? "no plate limit" : num(v) === 1 ? "1 plate" : `${num(v)} plates`);
const clock = (v: unknown) => (str(v) === "24:00" || str(v) === "00:00" ? "midnight" : (str(v) ?? "?"));

/** Which days a menu entry covers: "Friday", or "Monday to Friday". */
function entryDays(e: Obj) {
  const from = e.starts_on;
  const to = e.ends_on;
  return isDay(from) && isDay(to) && from !== to ? `${weekdayName(from)} to ${weekdayName(to)}` : weekday(from);
}

/** ", on the menu, 1–30 Nov" from an ad's snapshot. */
function adWhere(a: Obj) {
  const space = str(a.space);
  const where = space === "menu" || space === "order" ? `, ${SPACE_IN[space as AdSpace]}` : "";
  return isDay(a.starts_on) && isDay(a.ends_on) ? `${where}, ${dateRange(a.starts_on, a.ends_on)}` : where;
}

/** The sentence after the person: pieces, ending with a full stop. */
function rest(row: ChangeRow): Piece[] {
  const b = obj(row.before);
  const a = obj(row.after);
  const s: Piece = { text: row.subject_label ?? "something", bold: true };
  const code: Piece = { ...s, nowrap: true };
  const t = (text: string): Piece => ({ text });

  switch (row.action) {
    // ── menu: dishes
    case "dish.add":
      return [t("added "), s, t(` at ${kes(a.price)}${a.regular ? ", on the everyday menu." : ", to the dish library."}`)];
    case "dish.delete":
      return [t("deleted "), s, t(".")];
    case "dish.archive":
      return [t("archived "), s, t(" (it has past orders).")];
    case "dish.restore":
      return [t("restored "), s, t(".")];
    case "dish.regular_on":
      return [t("put "), s, t(" on the everyday menu.")];
    case "dish.regular_off":
      return [t("took "), s, t(" off the everyday menu.")];
    case "dish.rename":
      return [t("renamed "), { text: str(b.name) ?? "a dish", bold: true }, t(" to "), s, t(".")];
    case "dish.price":
      return [t("changed the price of "), s, t(` from ${kes(b.price)} to ${kes(a.price)}.`)];
    case "dish.words": {
      const what = a.description && a.photo ? "the description and photo" : a.photo ? "the photo" : "the description";
      return [t(`edited ${what} of `), s, t(".")];
    }
    case "dish.category":
      return [t("moved "), s, t(` from ${CATEGORY[str(b.category) ?? ""] ?? "?"} to ${CATEGORY[str(a.category) ?? ""] ?? "?"}.`)];
    case "dish.sale_off":
      return [t("switched "), s, t(" off for today.")];
    case "dish.sale_on":
      return [t("switched "), s, t(" back on.")];
    case "dish.order":
      return [t("moved "), s, t(" in the menu’s order.")];
    case "dish.options":
      return [t("changed "), s, t("’s options.")];
    // Slice 2.6: a choice or extra out for today.
    case "option.out":
      return [t("marked "), { text: str(a.option) ?? "an option", bold: true }, t(" out today on "), s, t(".")];
    case "option.in":
      return [t("put "), { text: str(a.option) ?? "an option", bold: true }, t(" back on "), s, t(".")];

    // ── menu: the planner
    case "entry.add": {
      const price = num(a.price) === null ? "" : `, at ${kes(a.price)}`;
      // Slice 2.5: a week dish names its days, "for the week (Mon–Wed, Fri)".
      const days = Array.isArray(a.days) ? a.days.filter(isDay) : [];
      if (a.kind === "week" && days.length > 0) return [t("added "), s, t(` for the week (${daysLabel(days)}), ${plates(a.plates)} a day${price}.`)];
      return [t("added "), s, t(` to ${entryDays(a)}, ${plates(a.plates)}${price}.`)];
    }
    case "entry.remove":
      if (b.kind === "week" && isDay(b.day)) return [t("removed "), s, t(` from the rest of the week, from ${weekday(b.day)}.`)];
      return [t("removed "), s, t(` from ${entryDays(b)}.`)];
    case "entry.off_day":
      return [t("removed "), s, t(` from ${weekday(a.day)} (all-week dish).`)];
    case "entry.day_back":
      return [t("put "), s, t(` back on ${weekday(a.day)} (all-week dish).`)];
    case "entry.restore":
      return [t("undid removing "), s, t(` from ${weekday(a.day)}.`)];
    case "entry.end_early":
      return [t("ended "), s, t(" early for today.")];
    case "entry.price":
      return num(a.price) === null
        ? [t(`cleared ${weekday(a.starts_on)}’s price for `), s, t(`. It uses the dish’s own price.`)]
        : [t(`set ${weekday(a.starts_on)}’s price for `), s, t(` at ${kes(a.price)}.`)];
    case "entry.plates":
      return [t(`changed ${weekday(a.starts_on)}’s plates for `), s, t(` from ${plates(b.plates)} to ${plates(a.plates)}.`)];
    case "entry.change":
      return [t("changed "), s, t(` on the menu for ${entryDays(a)}.`)];
    case "entry.sold_out":
      return [t("marked "), s, t(` sold out for ${weekday(a.day)}.`)];
    case "entry.back":
      return [t("put "), s, t(` back on sale for ${weekday(a.day)}.`)];
    case "menu.copy_day": {
      const n = num(a.count) ?? 0;
      return [t(`copied ${weekday(a.from)}’s menu to ${weekday(a.to)} (${n === 1 ? "1 dish" : `${n} dishes`}).`)];
    }

    // ── orders
    case "order.move": {
      const to = str(a.status) ?? "";
      if (to === "preparing" && b.status === "new") return [t("accepted "), code, t(".")];
      if (to === "completed") return [t("marked "), code, t(" done.")];
      return [t("moved "), code, t(" to "), { text: COLUMN[to] ?? to, bold: true }, t(".")];
    }
    case "order.move_undo": {
      const back = str(a.status) ?? "";
      return [t("undid moving "), code, t(" to "), { text: COLUMN[str(b.status) ?? ""] ?? str(b.status) ?? "?", bold: true }, t(`. It’s back in ${COLUMN[back] ?? back}.`)];
    }
    case "order.cancel": {
      const verb = b.status === "new" ? "declined " : "cancelled ";
      const reason = str(a.reason);
      const why = reason === "other" ? str(a.note) : reason ? (REASON_LABEL as Record<string, string>)[reason] : null;
      return why ? [t(verb), code, t(`: ${why.replace(/[.\s]+$/, "")}.`)] : [t(verb), code, t(".")];
    }
    case "order.paid": {
      const w = str(a.with);
      return [t("marked "), code, t(w ? ` paid: ${w === "mpesa" ? "M-Pesa" : w === "cash" ? "cash" : w}.` : " paid.")];
    }
    case "credit_note.issue":
      return [t("issued credit note "), { text: str(a.code) ?? "", bold: true }, t(" for "), code, t(`: ${kes(a.amount)}.`)];
    case "credit_note.void": {
      const why = str(a.reason);
      return [t("voided credit note "), { text: str(a.code) ?? "", bold: true }, t(" for "), code, t(why ? `: ${why.replace(/[.\s]+$/, "")}.` : ".")];
    }
    case "order.paid_undo":
      return [t("undid marking "), code, t(" paid.")];

    // ── tables and zones
    case "table.add":
      return [t("added "), s, t(".")];
    case "table.delete":
      return [t("deleted "), s, t(".")];
    case "table.rename":
      return [t("renamed "), { text: str(b.label) ?? "a table", bold: true }, t(" to "), s, t(".")];
    case "table.on":
      return [t("turned "), s, t(" on.")];
    case "table.off":
      return [t("turned "), s, t(" off.")];
    case "table.new_code":
      return [t("made a new QR code for "), s, t(". The old one no longer works.")];
    case "zone.add":
      return [t("added the "), s, t(` delivery zone, at ${kes(a.fee)}.`)];
    case "zone.order":
      return [t("moved the "), s, t(" delivery zone in the checkout’s list.")];
    case "zone.delete":
      return [t("deleted the "), s, t(" delivery zone.")];
    case "zone.rename":
      return [t("renamed the "), { text: str(b.name) ?? "a", bold: true }, t(" delivery zone to "), s, t(".")];
    case "zone.fee":
      return [t("changed the "), s, t(` delivery fee from ${kes(b.fee)} to ${kes(a.fee)}.`)];
    case "zone.minimum":
      return num(a.minimum) ? [t("changed "), s, t(`’s minimum to ${kes(a.minimum)}.`)] : [t("removed "), s, t("’s minimum.")];
    case "zone.on":
      return [t("started delivering to "), s, t(" again.")];
    case "zone.off":
      return [t("paused delivery to "), s, t(".")];

    // ── team
    case "staff.add":
      return [t("added "), s, t(a.role === "owner" ? " to the team as an owner." : " to the team.")];
    case "staff.remove":
      return [t("removed "), s, t(" from the team.")];
    case "staff.role":
      return [t("made "), s, t(a.role === "owner" ? " an owner." : " staff.")];
    case "staff.password_reset":
    case "staff.reset":
      return [t("reset "), s, t("’s password.")];
    // Slice 2.6: invites and names.
    case "staff.invite":
      return [t("invited "), s, t(a.role === "owner" ? " as an owner." : ".")];
    case "staff.cancel_invite":
      return [t("cancelled "), s, t("’s invite.")];
    case "staff.rename":
      return str(b.name) && str(b.name) !== s.text
        ? [t("renamed "), { text: str(b.name)!, bold: true }, t(" to "), s, t(".")]
        : [t("renamed "), s, t(".")];
    case "grant.on":
      return [t("let "), s, t(` ${JOB_LET[str(a.job) as Grant] ?? "do a new job"}.`)];
    case "grant.off":
      return [t("stopped "), s, t(` ${JOB_STOP[str(b.job) as Grant] ?? "doing a job"}.`)];

    // ── settings
    case "hours.day": {
      if (!a.is_open) return [t(`set ${s.text} as closed.`)];
      const hours = `${clock(a.opens)}–${clock(a.closes)}`;
      return [t(b.is_open ? `changed ${s.text}’s hours to ${hours}.` : `opened ${s.text}, ${hours}.`)];
    }
    case "closed_date.add": {
      const note = str(a.note) ? `: ${str(a.note)}` : "";
      return [t(`closed the kitchen on ${isDay(a.day) ? longDay(a.day) : "a day"}${note}.`)];
    }
    case "closed_date.remove":
      return [t(`reopened ${isDay(b.day) ? longDay(b.day) : "a closed date"}, which was closed.`)];
    case "closed_date.change": {
      const was = isDay(b.day) ? longDay(b.day) : "a closed date";
      const now = isDay(a.day) ? longDay(a.day) : "another day";
      const note = str(a.note);
      if (b.day !== a.day) return [t(`moved the closed date from ${was} to ${now}${note ? `: ${note}` : ""}.`)];
      return [t(note ? `changed the note on ${was}, closed, to: ${note}.` : `removed the note on ${was}, closed.`)];
    }
    case "settings.last_orders": {
      const m = num(a.minutes);
      return [t(`changed last orders to ${m === 0 ? "closing time" : `${m} minutes before closing`}.`)];
    }
    case "settings.till": {
      const was = str(b.till);
      const now = str(a.till);
      if (!now) return [t(`removed the till number${was ? ` ${was}` : ""}.`)];
      return [t(was ? `changed the till number from ${was} to ${now}.` : `set the till number to ${now}.`)];
    }
    case "settings.phone":
      return [t(str(a.phone) ? (str(b.phone) ? "changed the kitchen phone." : "added the kitchen phone.") : "removed the kitchen phone.")];
    case "settings.google_review":
      return [t("changed the Google review link.")]; // the spec's one line for saving or clearing

    // ── ratings (spec-2.10). The reply text is never copied here.
    case "ratings.hide": {
      const n = num(a.stars);
      return [t("hid the rating for "), code, t(n ? ` (${n} ★).` : ".")];
    }
    case "ratings.show":
      return [t("showed the rating for "), code, t(" again.")];
    case "ratings.reply":
      return [t("replied to "), code, t("’s rating.")];
    case "ratings.reply_change":
      return [t("changed the reply to "), code, t(".")];
    case "ratings.reply_remove":
      return [t("removed the reply to "), code, t(".")];

    case "kitchen.close_early":
      return [t(`closed the kitchen early${str(a.at) ? ` at ${timeLabel(str(a.at)!)}` : ""}.`)];
    case "kitchen.reopen":
      return [t("reopened the kitchen.")];

    // ── promos (slice 2.11)
    case "ad.create":
      return [t("added a draft ad from "), s, t(`${adWhere(a)}.`)];
    case "ad.approve": {
      // Entries from before the price (2.11 follow-up) carry no price_kes.
      const price = num(a.price_kes);
      const forWhat = !("price_kes" in a) || price === null ? "" : price === 0 ? ", for free" : `, for ${kes(price)}`;
      return [t("approved the ad from "), s, t(`${adWhere(a)}${forWhat}.`)];
    }
    case "ad.edit": {
      const price = "price_kes" in a && num(a.price_kes) !== num(b.price_kes);
      const now = num(a.price_kes);
      if (price && a.other === false) {
        if (now === null) return [t("cleared the price of the ad from "), s, t(".")];
        if (num(b.price_kes) === null) return [t("set the price of the ad from "), s, t(` to ${kes(now)}.`)];
        return [t("changed the price of the ad from "), s, t(` from ${kes(b.price_kes)} to ${kes(now)}.`)];
      }
      const tail = !price ? "" : now === null ? " The price is cleared." : ` The price is now ${kes(now)}.`;
      if (a.to_draft === true) return [t("changed the ad from "), s, t(`, so it’s a draft again until it’s approved.${tail}`)];
      if (isDay(a.ends_on) && a.ends_on !== b.ends_on) return [t("changed the ad from "), s, t(`: it now ends ${shortDate(a.ends_on)}.${tail}`)];
      return [t("changed the ad from "), s, t(`.${tail}`)];
    }
    case "ad.pause":
      return [t("paused the ad from "), s, t(".")];
    case "ad.resume":
      return [t("resumed the ad from "), s, t(".")];
    case "ad.end":
      return [t("ended the ad from "), s, t(" early.")];
    case "ad.delete":
      return [t("deleted the draft ad from "), s, t(".")];
    case "promo.pick_on":
      return [t("made "), s, t(" a Mama’s pick.")];
    case "promo.pick_off":
      return [t("took "), s, t(" off Mama’s picks.")];
    case "combo.create":
      return [t("made the combo "), s, t(`: ${comboDishes(a.dishes)} for ${kes(a.price_kes)}.`)];
    case "combo.edit": {
      const price = num(a.price_kes) !== num(b.price_kes);
      const dishes = comboDishes(a.dishes) !== comboDishes(b.dishes);
      const renamed = str(b.name) && str(a.name) !== str(b.name) ? ` (it was ${str(b.name)})` : "";
      if (price && dishes) return [t("changed the combo "), s, t(`${renamed}: now ${comboDishes(a.dishes)} for ${kes(a.price_kes)}.`)];
      if (price) return [t("changed the price of the combo "), s, t(`${renamed} from ${kes(b.price_kes)} to ${kes(a.price_kes)}.`)];
      if (dishes) return [t("changed the dishes in the combo "), s, t(`${renamed} to ${comboDishes(a.dishes)}.`)];
      return renamed ? [t("renamed the combo "), s, t(`${renamed}.`)] : [t("changed the combo "), s, t(".")];
    }
    case "combo.on":
      return [t("switched on the combo "), s, t(".")];
    case "combo.off":
      return [t("switched off the combo "), s, t(".")];
    case "combo.archive":
      return [t("archived the combo "), s, t(".")];
    case "code.create": {
      const gives = codeGivesOf(a);
      return [t("made the code "), s, t(`${gives ? `: ${gives}` : ""}${isDay(a.ends_on) ? `, until ${shortDate(a.ends_on)}` : ""}.`)];
    }
    case "code.edit": {
      const gives = codeGivesOf(a);
      if (gives && gives !== codeGivesOf(b)) return [t("changed "), s, t(` to ${gives}.`)];
      const limits = ["max_uses", "once_per_phone", "min_order_kes", "modes", "starts_on"].some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      const ends = isDay(a.ends_on) && a.ends_on !== b.ends_on ? `ends ${shortDate(a.ends_on)}` : "";
      if (ends && !limits) return [t("changed "), s, t(`: it now ${ends}.`)];
      if (ends) return [t("changed the limits on "), s, t(`, and it now ${ends}.`)];
      return [t(limits ? "changed the limits on " : "changed "), s, t(".")];
    }
    case "code.on":
      return [t("switched on the code "), s, t(".")];
    case "code.off":
      return [t("switched off the code "), s, t(".")];
  }
  return row.subject_label ? [t("changed "), s, t(".")] : [t("made a change.")];
}

/** The whole line: the person first, "The app" when nobody was signed in. */
export function sentence(row: ChangeRow): Piece[] {
  const who = row.actor ? row.actor_name : "The app";
  return [{ text: who, bold: true }, { text: " " }, ...rest(row)];
}

/** A row's day in Nairobi, YYYY-MM-DD. */
export const nairobiDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** "Today", "Yesterday", then "Thursday 4 November". */
export function dayHeading(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return longDay(day);
}

/** Rows, newest first, cut into Nairobi days. */
export function byDay(rows: ChangeRow[]) {
  const groups: { day: string; rows: ChangeRow[] }[] = [];
  for (const r of rows) {
    const day = nairobiDay(r.at);
    const last = groups.at(-1);
    if (last?.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return groups;
}

export const HISTORY_COLUMNS = "id, at, actor, actor_name, area, action, subject_label, before, after";
