// Slice 2.3: the History's sentences (spec-2.3-roles.md "Sentences"), read as plain text.
import { describe, expect, test } from "bun:test";
import { byDay, dayHeading, sentence, type ChangeRow } from "@/lib/history";

const row = (r: Partial<ChangeRow>): ChangeRow => ({
  id: 1,
  at: "2026-11-06T11:10:00Z",
  actor: "00000000-0000-4000-8000-000000000009",
  actor_name: "Wanjiku",
  area: "menu",
  action: "dish.price",
  subject_label: "Pilau",
  before: null,
  after: null,
  ...r,
});
const text = (r: Partial<ChangeRow>) => sentence(row(r)).map((p) => p.text).join("").replace(/ /g, " ");

describe("sentences", () => {
  test("the spec's examples", () => {
    expect(text({ before: { price: 450 }, after: { price: 500 } })).toBe("Wanjiku changed the price of Pilau from KSh 450 to KSh 500.");
    expect(text({ action: "entry.price", after: { starts_on: "2026-11-06", price: 400 } })).toBe("Wanjiku set Friday’s price for Pilau at KSh 400.");
    expect(text({ action: "dish.regular_off", actor_name: "Mama", subject_label: "Mandazi" })).toBe("Mama took Mandazi off the everyday menu.");
    expect(text({ action: "dish.sale_off", subject_label: "Chapati" })).toBe("Wanjiku switched Chapati off for today.");
    expect(text({ action: "dish.words", after: { description: true, photo: false } })).toBe("Wanjiku edited the description of Pilau.");
    expect(text({ action: "dish.archive", subject_label: "Githeri" })).toBe("Wanjiku archived Githeri (it has past orders).");
    expect(text({ action: "entry.add", after: { kind: "day", starts_on: "2026-11-06", ends_on: "2026-11-06", plates: 40, price: null } })).toBe(
      "Wanjiku added Pilau to Friday, 40 plates.",
    );
    expect(text({ action: "menu.copy_day", subject_label: null, after: { from: "2026-11-02", to: "2026-11-03", count: 6 } })).toBe(
      "Wanjiku copied Monday’s menu to Tuesday (6 dishes).",
    );
    // Slice 2.5: the planner's lines.
    expect(text({ action: "entry.add", after: { kind: "week", starts_on: "2026-11-02", ends_on: "2026-11-06", days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"], plates: 25, price: null } })).toBe(
      "Wanjiku added Pilau for the week (Mon–Wed, Fri), 25 plates a day.",
    );
    expect(text({ action: "entry.off_day", after: { day: "2026-11-04", entry: "x" } })).toBe("Wanjiku removed Pilau from Wednesday (all-week dish).");
    expect(text({ action: "entry.day_back", after: { day: "2026-11-04", entry: "x" } })).toBe("Wanjiku put Pilau back on Wednesday (all-week dish).");
    expect(text({ action: "entry.restore", after: { kind: "day", starts_on: "2026-11-06", day: "2026-11-06" } })).toBe("Wanjiku undid removing Pilau from Friday.");
    expect(text({ action: "entry.remove", before: { kind: "day", starts_on: "2026-11-06", ends_on: "2026-11-06", day: "2026-11-06" } })).toBe("Wanjiku removed Pilau from Friday.");
    expect(text({ action: "entry.remove", before: { kind: "week", starts_on: "2026-11-02", ends_on: "2026-11-08", day: "2026-11-04" } })).toBe(
      "Wanjiku removed Pilau from the rest of the week, from Wednesday.",
    );
    const order = { area: "orders" as const, subject_label: "DP-0107 (Amina)" };
    expect(text({ ...order, action: "order.cancel", before: { status: "new" } })).toBe("Wanjiku declined DP-0107 (Amina).");
    expect(text({ ...order, action: "order.cancel", before: { status: "preparing" } })).toBe("Wanjiku cancelled DP-0107 (Amina).");
    expect(text({ ...order, action: "order.paid" })).toBe("Wanjiku marked DP-0107 (Amina) paid.");
    // Slice 2.4: reasons, undone moves and undone Mark paid.
    expect(text({ ...order, action: "order.cancel", before: { status: "new" }, after: { status: "cancelled", reason: "sold_out" } })).toBe("Wanjiku declined DP-0107 (Amina): Sold out.");
    expect(text({ ...order, action: "order.cancel", before: { status: "ready" }, after: { status: "cancelled", reason: "other", note: "Rider’s bike broke down." } })).toBe("Wanjiku cancelled DP-0107 (Amina): Rider’s bike broke down.");
    expect(text({ ...order, action: "order.move_undo", before: { status: "ready" }, after: { status: "preparing" } })).toBe("Wanjiku undid moving DP-0107 (Amina) to Ready. It’s back in Cooking.");
    expect(text({ ...order, action: "order.move", before: { status: "ready" }, after: { status: "on_the_way" } })).toBe("Wanjiku moved DP-0107 (Amina) to On the way.");
    expect(text({ ...order, action: "order.paid_undo" })).toBe("Wanjiku undid marking DP-0107 (Amina) paid.");
    expect(text({ ...order, action: "order.move", before: { status: "new" }, after: { status: "preparing" } })).toBe("Wanjiku accepted DP-0107 (Amina).");
    expect(text({ ...order, action: "order.move", before: { status: "preparing" }, after: { status: "ready" } })).toBe("Wanjiku moved DP-0107 (Amina) to Ready.");
    expect(text({ ...order, action: "order.move", before: { status: "ready" }, after: { status: "completed" } })).toBe("Wanjiku marked DP-0107 (Amina) done.");
    expect(text({ area: "tables", action: "table.new_code", subject_label: "Table 4" })).toBe("Wanjiku made a new QR code for Table 4. The old one no longer works.");
    expect(text({ area: "tables", action: "zone.fee", subject_label: "Kilimani", before: { fee: 150 }, after: { fee: 200 } })).toBe(
      "Wanjiku changed the Kilimani delivery fee from KSh 150 to KSh 200.",
    );
    expect(text({ area: "team", action: "grant.on", actor_name: "Mama", after: { job: "everyday_menu" } })).toBe("Mama let Pilau change the everyday menu.");
    expect(text({ area: "team", action: "grant.off", actor_name: "Mama", before: { job: "everyday_menu" } })).toBe("Mama stopped Pilau changing the everyday menu.");
    const settings = { area: "settings" as const, subject_label: null, actor_name: "Mama" };
    expect(text({ ...settings, action: "settings.till", before: { till: "123456" }, after: { till: "654321" } })).toBe("Mama changed the till number from 123456 to 654321.");
    // Fix round (RQA23-03): a closed date changed in place.
    expect(text({ ...settings, action: "closed_date.change", before: { day: "2027-08-11", note: "Family" }, after: { day: "2027-08-12", note: "Family" } })).toBe(
      "Mama moved the closed date from Wednesday 11 August to Thursday 12 August: Family.",
    );
    expect(text({ ...settings, action: "closed_date.change", before: { day: "2027-08-11", note: null }, after: { day: "2027-08-11", note: "Wedding" } })).toBe(
      "Mama changed the note on Wednesday 11 August, closed, to: Wedding.",
    );
    expect(text({ ...settings, action: "closed_date.change", before: { day: "2027-08-11", note: "Wedding" }, after: { day: "2027-08-11", note: null } })).toBe(
      "Mama removed the note on Wednesday 11 August, closed.",
    );
    expect(text({ action: "dish.order", before: { order: 2 }, after: { order: 1 } })).toBe("Wanjiku moved Pilau in the menu’s order.");
    expect(text({ area: "tables", action: "zone.order", subject_label: "Kilimani" })).toBe("Wanjiku moved the Kilimani delivery zone in the checkout’s list.");
    // Any other change to a planned dish (its dish, days, show window, put back on the menu).
    expect(text({ action: "entry.change", after: { kind: "day", starts_on: "2026-11-06", ends_on: "2026-11-06" } })).toBe("Wanjiku changed Pilau on the menu for Friday.");
    expect(text({ ...settings, action: "kitchen.close_early", after: { at: "2026-11-06T11:10:00Z" } })).toBe("Mama closed the kitchen early at 14:10.");
    expect(text({ ...settings, action: "hours.day", subject_label: "Saturday", before: { is_open: true }, after: { is_open: true, opens: "10:00", closes: "22:00" } })).toBe(
      "Mama changed Saturday’s hours to 10:00–22:00.",
    );
  });

  test("nobody signed in reads as The app; an unknown action still makes a sentence", () => {
    expect(text({ actor: null, actor_name: "The app", area: "orders", action: "order.move", subject_label: "DP-0001 (Jo)", before: { status: "ready" }, after: { status: "completed" } })).toBe(
      "The app marked DP-0001 (Jo) done.",
    );
    expect(text({ action: "dish.something_new" })).toBe("Wanjiku changed Pilau.");
  });
});

describe("days", () => {
  test("Today, Yesterday, then the long date; rows are grouped by Nairobi day", () => {
    expect(dayHeading("2026-11-08", "2026-11-08")).toBe("Today");
    expect(dayHeading("2026-11-07", "2026-11-08")).toBe("Yesterday");
    expect(dayHeading("2026-11-05", "2026-11-08")).toBe("Thursday 5 November");
    // 22:30 UTC is 01:30 the next day in Nairobi.
    const g = byDay([row({ id: 3, at: "2026-11-07T22:30:00Z" }), row({ id: 2, at: "2026-11-07T20:00:00Z" }), row({ id: 1, at: "2026-11-07T08:00:00Z" })]);
    expect(g.map((x) => [x.day, x.rows.map((r) => r.id)])).toEqual([["2026-11-08", [3]], ["2026-11-07", [2, 1]]]);
  });
});
