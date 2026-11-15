// Slice 2.3: the change record (spec-2.3-roles.md, "Change record", "Done means" 3 and 6).
// One line per change, with the right person, in the same transaction as the change.
// Fixture setup runs with no signed-in person and so writes no lines: each test starts empty.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures } from "./helpers";

type Tx = TransactionSQL;
type Line = { action: string; actor: string | null; actor_name: string; area: string; subject_label: string | null; before: unknown; after: unknown };

async function person(tx: Tx, role: "owner" | "staff", name: string, jobs: string[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase().replace(/\W/g, "")}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, ${role}, ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job}::public.staff_grant)`;
  return u.id as string;
}

const as = (tx: Tx, sub: string | null, fn: Parameters<typeof attempt>[3]) => attempt(tx, sub ? "authenticated" : "anon", sub, fn);

async function lines(tx: Tx): Promise<Line[]> {
  return (await tx`select action, actor, actor_name, area::text, subject_label, before, after from public.change_log order by id`) as Line[];
}
const actions = async (tx: Tx) => (await lines(tx)).map((l) => l.action);

/** Bun's toMatchObject compares array elements whole; this keeps only the keys a case names. */
function picked(got: Line[], want: Partial<Line>[]) {
  return got.map((g, i) => Object.fromEntries(Object.keys(want[i] ?? g).map((k) => [k, g[k as keyof Line]])));
}

describe("menu", () => {
  test("a price change is one line with the person, the dish and old and new prices", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const w = await person(tx, "staff", "Wanjiku", ["dishes_prices"]);
      await as(tx, w, (q) => q`update public.dishes set price_kes = 350 where id = ${f.regular.id}`);
      expect(await lines(tx)).toEqual([
        { action: "dish.price", actor: w, actor_name: "Wanjiku", area: "menu", subject_label: "Test regular", before: { price: 300 }, after: { price: 350 } },
      ]);
    }));

  test("a refused change records nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await person(tx, "staff", "Otieno");
      await expect(as(tx, o, (q) => q`update public.dishes set price_kes = 1 where id = ${f.regular.id}`)).rejects.toThrow();
      expect(await lines(tx)).toEqual([]);
    }));

  test("one save of name, description and photo: a rename and one 'words' line, no old text", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await as(tx, f.ownerId, (q) => q`update public.dishes set name = 'Pilau', description = 'Spiced rice', photo_key = 'dishes/p.webp' where id = ${f.regular.id}`);
      const l = await lines(tx);
      expect(l.map((x) => x.action)).toEqual(["dish.rename", "dish.words"]);
      expect(l[0]).toMatchObject({ actor_name: "Test owner", subject_label: "Pilau", before: { name: "Test regular" }, after: { name: "Pilau" } });
      expect(l[1]).toMatchObject({ before: null, after: { description: true, photo: true } });
    }));

  test("everyday menu on and off, on sale off and back on, category", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      await as(tx, m, (q) => q`update public.dishes set is_regular = false where id = ${f.regular.id}`);
      await as(tx, m, (q) => q`update public.dishes set is_regular = true where id = ${f.regular.id}`);
      await as(tx, m, (q) => q`select public.set_regular_on_sale(${f.regular.id}, false)`);
      await as(tx, m, (q) => q`select public.set_regular_on_sale(${f.regular.id}, true)`);
      await as(tx, m, (q) => q`update public.dishes set category = 'drinks' where id = ${f.regular.id}`);
      // last_served_on is bookkeeping, not a change anyone made to the menu.
      await as(tx, m, (q) => q`update public.dishes set last_served_on = public.nairobi_today() where id = ${f.regular.id}`);
      expect(await actions(tx)).toEqual(["dish.regular_off", "dish.regular_on", "dish.sale_off", "dish.sale_on", "dish.category"]);
    }));

  test("adding a dish is one line; its options in the same save add nothing more", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const w = await person(tx, "staff", "Wanjiku", ["dishes_prices"]);
      await as(tx, w, (q) => q`
        with d as (insert into public.dishes (name, price_kes) values ('Githeri', 250) returning id)
        insert into public.dish_options (dish_id, label) select id, l from d, unnest(array['Small', 'Large']) l`);
      { const want = [{ action: "dish.add", subject_label: "Githeri", after: { price: 250, regular: false } }]; expect(picked(await lines(tx), want)).toEqual(want); }
    }));

  test("changing several options at once is one 'options' line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await as(tx, f.ownerId, (q) => q`
        with del as (delete from public.dish_options where id = ${f.option.id})
        insert into public.dish_options (dish_id, label) values (${f.rotating.id}, 'A'), (${f.rotating.id}, 'B')`);
      expect(await actions(tx)).toEqual(["dish.options"]);
    }));

  test("deleting a dish is one line, its menu entries go with it silently", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await as(tx, f.ownerId, (q) => q`select public.delete_dish(${f.rotating.id})`);
      { const want = [{ action: "dish.delete", subject_label: "Test rotating" }]; expect(picked(await lines(tx), want)).toEqual(want); }
    }));

  test("a dish with past orders is archived: one 'archived' line, no everyday-menu or entry lines", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      await as(tx, f.ownerId, (q) => q`select public.delete_dish(${f.regular.id})`);
      expect(await actions(tx)).toEqual(["dish.archive"]);
      await as(tx, f.ownerId, (q) => q`update public.dishes set archived = false where id = ${f.regular.id}`);
      expect(await actions(tx)).toEqual(["dish.archive", "dish.restore"]);
    }));

  test("planner: added, price, plates, ended early, removed; sold out and back", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await person(tx, "staff", "Otieno");
      const [e = {}] = await as(tx, o, (q) => q`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day)
        values (${f.regular.id}, 'day', public.nairobi_today() + 3, public.nairobi_today() + 3, 40) returning id`);
      await as(tx, f.ownerId, (q) => q`update public.menu_entries set price_kes = 400 where id = ${e.id}`);
      await as(tx, o, (q) => q`update public.menu_entries set plates_per_day = 30 where id = ${e.id}`);
      await as(tx, o, (q) => q`select public.set_entry_sold_out(${f.openEntry.id}, true)`);
      await as(tx, o, (q) => q`select public.set_entry_sold_out(${f.openEntry.id}, false)`);
      await as(tx, o, (q) => q`update public.menu_entries set ended_early_at = now() where id = ${f.openEntry.id}`);
      await as(tx, o, (q) => q`delete from public.menu_entries where id = ${e.id}`);
      const l = await lines(tx);
      expect(l.map((x) => x.action)).toEqual(["entry.add", "entry.price", "entry.plates", "entry.sold_out", "entry.back", "entry.end_early", "entry.remove"]);
      expect(l[0]).toMatchObject({ actor_name: "Otieno", subject_label: "Test regular", after: { kind: "day", plates: 40 } });
      expect(l[1]).toMatchObject({ actor_name: "Test owner", after: { price: 400 } });
    }));

  test("plates sold by an order are not a change anyone made", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 3 }]));
      expect(await lines(tx)).toEqual([]);
    }));

  test("copying a day of several dishes is one line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day)
        values (${f.regular.id}, 'day', public.nairobi_today(), public.nairobi_today(), 20)`;
      const o = await person(tx, "staff", "Otieno");
      const [r = {}] = await as(tx, o, (q) => q`select public.copy_menu_day(public.nairobi_today(), public.nairobi_today() + 1) n`);
      const copied = (r.n as { copied: number }).copied; // 2.5: copy_menu_day returns what it did
      expect(copied).toBeGreaterThanOrEqual(2); // the seed may plan more dishes for today
      const l = await lines(tx);
      expect(picked(l, [{ action: "menu.copy_day", actor_name: "Otieno" }])).toEqual([{ action: "menu.copy_day", actor_name: "Otieno" }]);
      expect((l[0]?.after as { count: number }).count).toBe(copied);
    }));
});

describe("orders", () => {
  test("placing an order records nothing; every move is a line by whoever tapped it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await person(tx, "staff", "Otieno");
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { customer_name: "Amina" }));
      expect(await lines(tx)).toEqual([]);
      const [{ id }] = await tx`select id from public.orders where public_token = ${order.public_token}`;
      await as(tx, o, (q) => q`select public.advance_order(${id}, 'new', 'preparing')`);
      await as(tx, f.ownerId, (q) => q`select public.advance_order(${id}, 'preparing', 'ready')`);
      const l = await lines(tx);
      expect(l).toEqual([
        { action: "order.move", actor: o, actor_name: "Otieno", area: "orders", subject_label: `${order.code} (Amina)`, before: { status: "new" }, after: { status: "preparing" } },
        { action: "order.move", actor: f.ownerId, actor_name: "Test owner", area: "orders", subject_label: `${order.code} (Amina)`, before: { status: "preparing" }, after: { status: "ready" } },
      ]);
    }));

  test("a cancel from Preparing is one line, not a move as well", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      const [{ id }] = await tx`select id from public.orders where public_token = ${order.public_token}`;
      await as(tx, f.ownerId, (q) => q`select public.advance_order(${id}, 'new', 'preparing')`);
      await as(tx, f.ownerId, (q) => q`select public.cancel_order(${id}, 'preparing', 'too_busy')`);
      expect(await actions(tx)).toEqual(["order.move", "order.cancel"]);
      expect((await lines(tx))[1]).toMatchObject({ before: { status: "preparing" }, after: { status: "cancelled" } });
    }));

  test("marked paid is one line; a second tap adds nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      const [{ id }] = await tx`select id from public.orders where public_token = ${order.public_token}`;
      await as(tx, f.ownerId, (q) => q`select public.mark_order_paid(${id}, 'cash')`);
      await as(tx, f.ownerId, (q) => q`select public.mark_order_paid(${id}, 'cash')`);
      expect(await actions(tx)).toEqual(["order.paid"]);
    }));

  test("a move with nobody signed in is written as 'The app'", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      await tx`update public.orders set status = 'preparing' where public_token = ${order.public_token}`;
      { const want = [{ action: "order.move", actor: null, actor_name: "The app" }]; expect(picked(await lines(tx), want)).toEqual(want); }
    }));
});

describe("tables, team and settings", () => {
  test("tables and zones: new code, rename, off, fee with old and new", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const w = await person(tx, "staff", "Wanjiku", ["tables_delivery"]);
      const [z] = await tx`insert into public.delivery_zones (name, fee_kes) values ('Kilimani test', 150) returning id`;
      await as(tx, w, (q) => q`update public.dining_tables set qr_token = 'fresh-code' where id = ${f.table.id}`);
      await as(tx, w, (q) => q`update public.dining_tables set label = 'Table 4 test', active = false where id = ${f.table.id}`);
      await as(tx, w, (q) => q`update public.delivery_zones set fee_kes = 200 where id = ${z.id}`);
      const l = await lines(tx);
      expect(l.map((x) => x.action)).toEqual(["table.new_code", "table.rename", "table.off", "zone.fee"]);
      expect(l[3]).toMatchObject({ area: "tables", subject_label: "Kilimani test", before: { fee: 150 }, after: { fee: 200 } });
    }));

  test("team: added, job on, job off, role, removed (no separate job-off lines for a leaver)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [u] = await tx`insert into auth.users (email) values ('otieno@test.local') returning id`;
      const m = f.ownerId;
      await as(tx, m, (q) => q`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Otieno')`);
      await as(tx, m, (q) => q`insert into public.staff_grants (user_id, job) values (${u.id}, 'everyday_menu'), (${u.id}, 'close_early')`);
      await as(tx, m, (q) => q`delete from public.staff_grants where user_id = ${u.id} and job = 'close_early'`);
      await as(tx, m, (q) => q`update public.staff set role = 'owner' where user_id = ${u.id}`);
      await as(tx, m, (q) => q`delete from public.staff where user_id = ${u.id}`);
      const l = await lines(tx);
      expect(l.map((x) => x.action)).toEqual(["staff.add", "grant.on", "grant.on", "grant.off", "staff.role", "staff.remove"]);
      expect(l.every((x) => x.subject_label === "Otieno" && x.area === "team")).toBe(true);
      expect(l[1]?.after).toEqual({ job: "everyday_menu" });
    }));

  test("settings: one changed day of hours, last orders, till old and new, close early, reopen; closed dates", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_open: true, opens: weekday === 6 ? "10:00" : "00:00", closes: weekday === 6 ? "22:00" : "24:00" }));
      await as(tx, m, (q) => q`select public.save_opening_hours(${JSON.stringify(week)}::text::jsonb, 15)`);
      await as(tx, m, (q) => q`select public.set_till_number('123456')`);
      await as(tx, m, (q) => q`select public.set_till_number('654321')`);
      await as(tx, m, (q) => q`insert into public.closed_dates (day, note) values (public.nairobi_today() + 30, 'Family wedding')`);
      await as(tx, m, (q) => q`delete from public.closed_dates where day = public.nairobi_today() + 30`);
      const closer = await person(tx, "staff", "Closer", ["close_early"]);
      await as(tx, closer, (q) => q`select public.close_early()`);
      await as(tx, closer, (q) => q`select public.close_early()`); // a second tap keeps the first time
      await as(tx, closer, (q) => q`select public.reopen_today()`);
      const l = await lines(tx);
      expect(l.map((x) => x.action)).toEqual([
        "hours.day", "settings.last_orders", "settings.till", "settings.till", "closed_date.add", "closed_date.remove", "kitchen.close_early", "kitchen.reopen",
      ]);
      expect(l[0]).toMatchObject({ subject_label: "Saturday", before: { opens: "00:00", closes: "24:00" }, after: { opens: "10:00", closes: "22:00" } });
      expect(l[3]).toMatchObject({ before: { till: "123456" }, after: { till: "654321" } });
      expect(l[6]).toMatchObject({ actor_name: "Closer" });
    }));
});

describe("the record itself", () => {
  test("nobody can change or delete a line, not even the database owner", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await as(tx, f.ownerId, (q) => q`update public.dishes set price_kes = 350 where id = ${f.regular.id}`);
      await expect(tx.savepoint((sp) => sp`update public.change_log set actor_name = 'Someone else'`)).rejects.toThrow("The history can’t be changed.");
      await expect(tx.savepoint((sp) => sp`delete from public.change_log`)).rejects.toThrow("The history can’t be changed.");
      await expect(tx.savepoint((sp) => sp`truncate public.change_log`)).rejects.toThrow("The history can’t be changed.");
      expect(await actions(tx)).toEqual(["dish.price"]);
    }));

  test("a line keeps the person's name and the dish's name after both are gone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [loose] = await tx`insert into public.dishes (name, price_kes) values ('Matoke', 200) returning id`;
      const w = await person(tx, "staff", "Wanjiku", ["dishes_prices"]);
      await as(tx, w, (q) => q`update public.dishes set price_kes = 220 where id = ${loose.id}`);
      await as(tx, f.ownerId, (q) => q`select public.delete_dish(${loose.id})`);
      await tx`delete from public.staff where user_id = ${w}`;
      await tx`delete from auth.users where id = ${w}`;
      { const want = [
        { action: "dish.price", actor: w, actor_name: "Wanjiku", subject_label: "Matoke" },
        { action: "dish.delete", actor_name: "Test owner", subject_label: "Matoke" },
      ]; expect(picked(await lines(tx), want)).toEqual(want); }
    }));

  test("seed data and maintenance with nobody signed in write nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.dishes set price_kes = 999 where id = ${f.regular.id}`;
      await tx`insert into public.dining_tables (label) values ('Maintenance table')`;
      expect(await lines(tx)).toEqual([]);
    }));

  test("All leaves out order moves, Orders shows them, and a person filter narrows either", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await person(tx, "staff", "Otieno");
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      const [{ id }] = await tx`select id from public.orders where public_token = ${order.public_token}`;
      await as(tx, o, (q) => q`select public.advance_order(${id}, 'new', 'preparing')`);
      await as(tx, f.ownerId, (q) => q`select public.mark_order_paid(${id}, 'cash')`);
      await as(tx, f.ownerId, (q) => q`update public.dishes set price_kes = 350 where id = ${f.regular.id}`);
      const all = await as(tx, f.ownerId, (q) => q`select action from public.change_log where action <> 'order.move' order by id desc`);
      expect(all.map((r) => r.action)).toEqual(["dish.price", "order.paid"]);
      const orders = await as(tx, f.ownerId, (q) => q`select action from public.change_log where area = 'orders' order by id desc`);
      expect(orders.map((r) => r.action)).toEqual(["order.paid", "order.move"]);
      const his = await as(tx, f.ownerId, (q) => q`select action from public.change_log where area = 'orders' and actor = ${o} order by id desc`);
      expect(his.map((r) => r.action)).toEqual(["order.move"]);
    }));

  test("the Everyone list: each person once, by their last name in the record, leavers marked; staff get none", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const w = await person(tx, "staff", "Wanjiku", ["dishes_prices"]);
      const o = await person(tx, "staff", "Otieno", ["dishes_prices"]);
      await as(tx, w, (q) => q`update public.dishes set price_kes = 350 where id = ${f.regular.id}`);
      await as(tx, w, (q) => q`update public.dishes set price_kes = 360 where id = ${f.regular.id}`);
      await as(tx, o, (q) => q`update public.dishes set price_kes = 370 where id = ${f.regular.id}`);
      await as(tx, f.ownerId, (q) => q`delete from public.staff where user_id = ${o}`);
      const people = await as(tx, f.ownerId, (q) => q`select actor, actor_name, on_team from public.history_people()`);
      expect(people.map((p) => [p.actor_name, p.on_team])).toEqual([["Otieno", false], ["Test owner", true], ["Wanjiku", true]]);
      expect(await as(tx, w, (q) => q`select * from public.history_people()`)).toEqual([]);
    }));
});

// Fix round (QA 2.3, RQA23-01..03 and the same class of gap): every way a person can change these
// rows through the API writes a line, or is refused.
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return (err as { errno?: string }).errno ?? "error";
  }
};

describe("no path skips the record", () => {
  test("RQA23-01: the photo URL and thumbnail alone are each a photo line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      await as(tx, m, (q) => q`update public.dishes set photo_url = 'https://example.test/p.webp' where id = ${f.regular.id}`);
      await as(tx, m, (q) => q`update public.dishes set photo_thumb_url = 'https://example.test/p-thumb.webp' where id = ${f.regular.id}`);
      const l = await lines(tx);
      expect(l.map((x) => [x.action, x.after])).toEqual([
        ["dish.words", { description: false, photo: true }],
        ["dish.words", { description: false, photo: true }],
      ]);
    }));

  test("a dish or delivery zone moved in its list is a line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [z] = await tx`insert into public.delivery_zones (name, fee_kes, sort_order) values ('Kilimani test', 150, 1) returning id`;
      await as(tx, f.ownerId, (q) => q`update public.dishes set sort_order = sort_order + 1 where id = ${f.regular.id}`);
      await as(tx, f.ownerId, (q) => q`update public.delivery_zones set sort_order = 5 where id = ${z.id}`);
      expect(await actions(tx)).toEqual(["dish.order", "zone.order"]);
    }));

  test("RQA23-02: a grant changed in place is the old job off and the new one on; bookkeeping is not a change", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await person(tx, "staff", "Otieno", ["everyday_menu"]);
      const k = await person(tx, "staff", "Kamau");
      await as(tx, f.ownerId, (q) => q`update public.staff_grants set job = 'close_early' where user_id = ${o} and job = 'everyday_menu'`);
      await as(tx, f.ownerId, (q) => q`update public.staff_grants set user_id = ${k} where user_id = ${o} and job = 'close_early'`);
      await as(tx, f.ownerId, (q) => q`update public.staff_grants set granted_at = now() - interval '1 day' where user_id = ${k}`);
      const l = await lines(tx);
      expect(l.map((x) => [x.action, x.subject_label, x.before ?? x.after])).toEqual([
        ["grant.off", "Otieno", { job: "everyday_menu" }],
        ["grant.on", "Otieno", { job: "close_early" }],
        ["grant.off", "Otieno", { job: "close_early" }],
        ["grant.on", "Kamau", { job: "close_early" }],
      ]);
    }));

  test("RQA23-03: a closed date moved to another day, or its note changed, is a line with before and after", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      await tx`insert into public.closed_dates (day, note) values ('2027-08-11', 'Family')`;
      await as(tx, m, (q) => q`update public.closed_dates set day = '2027-08-12' where day = '2027-08-11'`);
      await as(tx, m, (q) => q`update public.closed_dates set note = 'Wedding' where day = '2027-08-12'`);
      await as(tx, m, (q) => q`update public.closed_dates set note = 'Wedding' where day = '2027-08-12'`); // no change
      const l = await lines(tx);
      expect(l.map((x) => [x.action, x.before, x.after])).toEqual([
        ["closed_date.change", { day: "2027-08-11", note: "Family" }, { day: "2027-08-12", note: "Family" }],
        ["closed_date.change", { day: "2027-08-12", note: "Family" }, { day: "2027-08-12", note: "Wedding" }],
      ]);
    }));

  test("a planned dish changed in any other way is one line: show window, days, put back, un-ended", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      const e = f.openEntry.id;
      await as(tx, m, (q) => q`update public.menu_entries set show_from = '11:00' where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set auto_hide_sold_out = not auto_hide_sold_out where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set published = false where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set published = true where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set ended_early_at = now() where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set ended_early_at = null where id = ${e}`);
      await as(tx, m, (q) => q`update public.menu_entries set starts_on = starts_on + 7, ends_on = ends_on + 7 where id = ${e}`);
      expect(await actions(tx)).toEqual([
        "entry.change", "entry.change", "entry.remove", "entry.change", "entry.end_early", "entry.change", "entry.change",
      ]);
    }));

  test("rows only the app's own functions write can't be written directly, even by an owner", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = f.ownerId;
      const w = await person(tx, "staff", "Wanjiku", ["everyday_menu"]);
      expect(await code(as(tx, m, (q) => q`delete from public.opening_hours where weekday = 0`))).toBe("42501");
      expect(await code(as(tx, m, (q) => q`insert into public.opening_hours (weekday, is_open, opens, closes) values (0, true, '08:00', '20:00')`))).toBe("42501");
      // Marking a planned dish sold out still works through its function, and writes its line.
      expect(await code(as(tx, m, (q) => q`select public.set_entry_sold_out(${f.openEntry.id}, true)`))).toBeNull();
      for (const sub of [m, w]) {
        expect(await code(as(tx, sub, (q) => q`update public.menu_entry_days set plates_sold = 0`))).toBe("42501");
        expect(await code(as(tx, sub, (q) => q`delete from public.menu_entry_days`))).toBe("42501");
        expect(await code(as(tx, sub, (q) => q`insert into public.menu_entry_days (entry_id, day) values (${f.closedEntry.id}, public.nairobi_today())`))).toBe("42501");
      }
      expect(await actions(tx)).toEqual(["entry.sold_out"]);
    }));
});
