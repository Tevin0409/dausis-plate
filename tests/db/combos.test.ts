// Slice 2.11 part B: combos (spec-2.11-ads-promos.md, "Tests: Combos"). save_combo, combo_action,
// customer_combos and who can read what. Ordering combos (place_order) is tested once place_order
// learns them, on the composed wave-2 definition.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Q = Parameters<Parameters<typeof attempt>[3]>[0];
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function staffMember(tx: Tx) {
  const [u] = await tx`insert into auth.users (email) values ('staff@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Test staff')`;
  return u.id as string;
}

async function as(tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<unknown>) {
  try {
    await attempt(tx, sub ? "authenticated" : "anon", sub, async (q) => {
      await fn(q);
      return [];
    });
    return null;
  } catch (err) {
    const e = err as { errno?: string; message: string; detail?: string };
    return { code: e.errno, message: e.message, detail: e.detail ?? null };
  }
}

const run = (tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<Row[]>) => attempt(tx, sub ? "authenticated" : "anon", sub, fn);

type Item = { dish_id: string; quantity: number };
const payload = (name: string, price: number, items: Item[], id?: string) => JSON.stringify({ id, name, price_kes: price, items });

async function save(tx: Tx, sub: string, name: string, price: number, items: Item[], id?: string) {
  const [r] = await run(tx, sub, (q) => q`select public.save_combo(${payload(name, price, items, id)}::text::jsonb) id`);
  return r!.id as string;
}
const trySave = (tx: Tx, sub: string | null, name: string, price: number, items: Item[], id?: string) =>
  as(tx, sub, (q) => q`select public.save_combo(${payload(name, price, items, id)}::text::jsonb)`);

/** The regular dish on all week, all day (the fixtures leave it off the menu). */
async function serveRegular(tx: Tx, f: Fixtures, plates: number | null = null) {
  const [e] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
    values (${f.regular.id}, 'week', public.nairobi_today(), public.nairobi_today() + 6, ${plates}, '00:00', '23:59:59')
    returning *`;
  return e!;
}

const lunch = (f: Fixtures, rotating = 1): Item[] => [
  { dish_id: f.regular.id, quantity: 1 },
  { dish_id: f.rotating.id, quantity: rotating },
];

async function combos(tx: Tx, sub: string | null = null) {
  return run(tx, sub, (q) => q`select * from public.customer_combos()`);
}

describe("save_combo", () => {
  test("only the owner can save; staff and anon are refused", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      expect(await trySave(tx, staff, "Lunch combo", 650, lunch(f))).toMatchObject({ code: "42501" });
      expect(await trySave(tx, null, "Lunch combo", 650, lunch(f))).toMatchObject({ code: "42501" });
      expect(await trySave(tx, f.ownerId, "Lunch combo", 650, lunch(f))).toBeNull();
    });
  });

  test("a price at or above the everyday total is refused, naming that total", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      // Everyday: 300 + 500 = 800. Today's entry price (450) doesn't count here.
      for (const price of [800, 900]) {
        expect(await trySave(tx, f.ownerId, "Lunch combo", price, lunch(f))).toEqual({
          code: "P0001",
          detail: "combo_no_saving",
          message: "Price it below KSh 800 so it’s a deal.",
        });
      }
      expect(await trySave(tx, f.ownerId, "Lunch combo", 799, lunch(f))).toBeNull();
      // Quantities count: 300 + 2 × 500 = 1,300.
      expect(await trySave(tx, f.ownerId, "Big lunch", 1300, lunch(f, 2))).toMatchObject({
        detail: "combo_no_saving",
        message: "Price it below KSh 1,300 so it’s a deal.",
      });
    });
  });

  test("2 to 4 dishes in total, each 1 to 4 times, each dish once; names 1–40", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const r = (q: number) => ({ dish_id: f.rotating.id, quantity: q });
      expect(await trySave(tx, o, "One", 400, [r(1)])).toMatchObject({ detail: "combo_items" });
      expect(await trySave(tx, o, "Two of one", 900, [r(2)])).toBeNull(); // 2 in total is enough
      expect(await trySave(tx, o, "Five", 2000, [{ dish_id: f.regular.id, quantity: 1 }, r(4)])).toMatchObject({ detail: "combo_items" });
      expect(await trySave(tx, o, "Zero", 200, [{ dish_id: f.regular.id, quantity: 2 }, r(0)])).toMatchObject({ detail: "combo_items" });
      expect(await trySave(tx, o, "Twice", 900, [r(1), r(1)])).toMatchObject({ detail: "combo_items" });
      expect(await trySave(tx, o, " ", 500, lunch(f))).toMatchObject({ detail: "combo_name" });
      expect(await trySave(tx, o, "x".repeat(41), 500, lunch(f))).toMatchObject({ detail: "combo_name" });
      expect(await trySave(tx, o, "x".repeat(40), 500, lunch(f))).toBeNull();
      expect(await trySave(tx, o, "Free", 0, lunch(f))).toMatchObject({ detail: "combo_price" });
      await tx`update public.dishes set archived = true where id = ${f.late.id}`;
      expect(await trySave(tx, o, "Gone", 500, [{ dish_id: f.late.id, quantity: 1 }, r(1)])).toMatchObject({ detail: "combo_dish" });
    });
  });

  test("History: created, changed (only when something changed), switched off and on, archived", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const id = await save(tx, o, "Lunch combo", 650, lunch(f));
      await save(tx, o, "Lunch combo", 650, lunch(f), id); // no change, no line
      await save(tx, o, "Lunch combo", 700, lunch(f), id);
      expect(await as(tx, o, (q) => q`select public.combo_action(${id}::uuid, 'off')`)).toBeNull();
      expect(await as(tx, o, (q) => q`select public.combo_action(${id}::uuid, 'off')`)).toBeNull(); // already off: no line
      expect(await as(tx, o, (q) => q`select public.combo_action(${id}::uuid, 'on')`)).toBeNull();
      expect(await as(tx, o, (q) => q`select public.combo_action(${id}::uuid, 'archive')`)).toBeNull();
      const lines = await tx`select action, subject_label, before->>'price_kes' b, after->>'price_kes' a
                             from public.change_log where area = 'promos' and subject_id = ${id} order by id`;
      expect(lines.map((l: Row) => l.action)).toEqual(["combo.create", "combo.edit", "combo.off", "combo.on", "combo.archive"]);
      expect(lines[1]).toMatchObject({ subject_label: "Lunch combo", b: "650", a: "700" });
      // An archived combo can't be saved or switched again.
      expect(await trySave(tx, o, "Lunch combo", 600, lunch(f), id)).toMatchObject({ detail: "combo_missing" });
      expect(await as(tx, o, (q) => q`select public.combo_action(${id}::uuid, 'on')`)).toMatchObject({ detail: "combo_missing" });
    });
  });

  test("the tables can't be written directly, even by the owner", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, "Lunch combo", 650, lunch(f));
      expect(await as(tx, f.ownerId, (q) => q`update public.combos set price_kes = 1 where id = ${id}`)).toMatchObject({ code: "42501" });
      expect(await as(tx, f.ownerId, (q) => q`insert into public.combo_items (combo_id, dish_id, quantity) values (${id}, ${f.late.id}, 1)`)).toMatchObject({
        code: "42501",
      });
      expect(await as(tx, null, (q) => q`insert into public.combos (name, price_kes) values ('x', 1)`)).toMatchObject({ code: "42501" });
    });
  });
});

describe("customer_combos", () => {
  test("available with today's prices when every dish can be ordered now", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const reg = await serveRegular(tx, f);
      const id = await save(tx, f.ownerId, "Lunch combo", 650, lunch(f));
      const [c] = await combos(tx);
      expect(c).toMatchObject({ combo_id: id, name: "Lunch combo", price_kes: 650, everyday_total: 800, today_total: 750, available: true, reason: null });
      expect(c!.parts).toEqual([
        { dish_id: f.regular.id, menu_entry_id: reg.id, name: "Test regular", quantity: 1, price_kes: 300, photo_thumb_url: null, has_choices: false },
        { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, name: "Test rotating", quantity: 1, price_kes: 450, photo_thumb_url: null, has_choices: false },
      ]);
    });
  });

  test("not available, with the first reason, when one dish is off, sold out, short of plates or not being served", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await save(tx, f.ownerId, "Lunch combo", 650, lunch(f));
      // The everyday dish counts from the everyday menu, with no entry, until it's marked out today.
      expect((await combos(tx))[0]).toMatchObject({ available: true, reason: null });
      expect((await combos(tx))[0]!.parts[0]).toMatchObject({ dish_id: f.regular.id, menu_entry_id: null, price_kes: 300 });
      await tx`update public.dishes set unavailable_on = public.nairobi_today() where id = ${f.regular.id}`;
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test regular is sold out" });
      await tx`update public.dishes set is_regular = false, unavailable_on = null where id = ${f.regular.id}`;
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test regular isn’t on the menu" });

      const reg = await serveRegular(tx, f);
      await tx`insert into public.menu_entry_days (entry_id, day, sold_out_manual) values (${f.openEntry.id}, public.nairobi_today(), true)`;
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test rotating is sold out" });

      // 3 plates a day, 2 sold: one left, the combo needs 3 of it.
      await tx`update public.menu_entry_days set sold_out_manual = false, plates_sold = 2 where entry_id = ${f.openEntry.id}`;
      expect((await combos(tx))[0]).toMatchObject({ available: true });
      await tx`update public.menu_entry_days set plates_sold = 3 where entry_id = ${f.openEntry.id}`;
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test rotating is sold out" });
      await tx`update public.menu_entry_days set plates_sold = 1 where entry_id = ${f.openEntry.id}`;
      await save(tx, f.ownerId, "Big lunch", 1100, lunch(f, 3));
      const big = (await combos(tx)).find((c) => c.name === "Big lunch");
      expect(big).toMatchObject({ available: false, reason: "Test rotating has too few plates left" });

      // Switched off (unpublished) entry: gone from the menu.
      await tx`update public.menu_entries set published = false where id = ${reg.id}`;
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test regular isn’t on the menu" });
    });
  });

  test("a dish outside its serving hours makes the combo unavailable", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await save(tx, f.ownerId, "Late combo", 700, [
        { dish_id: f.rotating.id, quantity: 1 },
        { dish_id: f.late.id, quantity: 1 },
      ]);
      expect((await combos(tx))[0]).toMatchObject({ available: false, reason: "Test late isn’t being served now" });
    });
  });

  test("switched-off and archived combos aren't listed; anon can't read archived rows", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await serveRegular(tx, f);
      const off = await save(tx, f.ownerId, "Off combo", 650, lunch(f));
      const gone = await save(tx, f.ownerId, "Gone combo", 640, lunch(f));
      await save(tx, f.ownerId, "Lunch combo", 600, lunch(f));
      await run(tx, f.ownerId, (q) => q`select public.combo_action(${off}::uuid, 'off')`);
      await run(tx, f.ownerId, (q) => q`select public.combo_action(${gone}::uuid, 'archive')`);
      expect((await combos(tx)).map((c) => c.name)).toEqual(["Lunch combo"]);
      const seen = await run(tx, null, (q) => q`select name from public.combos order by name`);
      expect(seen.map((c) => c.name)).toEqual(["Lunch combo", "Off combo"]);
      const items = await run(tx, null, (q) => q`select count(*)::int n from public.combo_items where combo_id = ${gone}`);
      expect(items[0]!.n).toBe(0);
      const owner = await run(tx, f.ownerId, (q) => q`select count(*)::int n from public.combos`);
      expect(owner[0]!.n).toBe(3);
    });
  });

  test("anon can't read order_combos", async () => {
    await inTx(async (tx) => {
      await seedFixtures(tx);
      expect(await as(tx, null, (q) => q`select * from public.order_combos`)).toMatchObject({ code: "42501" });
    });
  });
});
