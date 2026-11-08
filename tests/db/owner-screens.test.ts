// Slice 2.6: owner screens (spec-2.6-owner-screens.md, "Build notes: Migration" and "Done means"
// 4, 6, 10, 11, 11a, 12, 14). Everything goes straight at the database, as a direct API call would.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Q = Parameters<Parameters<typeof attempt>[3]>[0];

const MSG = {
  owner: "Only the owner can do this.",
  dishes: "Only the owner can change dishes and prices.",
  lastOwner: "There has to be at least one owner. Make someone else owner first.",
  oneChoice: "Add a second choice, or remove this one. With one, there's nothing to choose.",
  freeExtra: "An extra needs a price. If it's free, make it a choice or put it in the description.",
  nineExtras: "Eight extras is the most a dish can have.",
  nineChoices: "Eight choices is the most a dish can have.",
  extraGone: "That extra isn't available any more. Choose again.",
  choiceGone: "That choice isn't available any more. Choose again.",
  phone: "Enter a Kenyan number, like 0712 345 678 or 020 123 4567.",
};

async function person(tx: Tx, role: "owner" | "staff", name: string, jobs: string[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase()}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, ${role}, ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job}::public.staff_grant)`;
  return u.id as string;
}

/** Runs `fn` as `sub` (anon when null); returns null on success, else the SQLSTATE and message. */
async function as(tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<unknown>) {
  try {
    await attempt(tx, sub ? "authenticated" : "anon", sub, async (q) => {
      await fn(q);
      return [];
    });
    return null;
  } catch (err) {
    const e = err as { errno?: string; message: string };
    return { code: e.errno, message: e.message };
  }
}

/** Runs `fn` as `sub` and returns its rows (throws on refusal). */
function run(tx: Tx, sub: string, fn: (q: Q) => PromiseLike<Record<string, any>[]>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return attempt(tx, "authenticated", sub, fn);
}

const refused = (message: string, code = "P0001") => ({ code, message });

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected a refusal");
}

type Opt = { id?: string; kind: "choice" | "extra"; label: string; extra: number; isDefault?: boolean };
const save = (q: Q, dish: string, opts: Opt[]) =>
  q`select public.save_dish_options(${dish}::uuid, ${JSON.stringify(opts.map((o, i) => ({ isDefault: false, sortOrder: i, ...o })))}::text::jsonb) r`;

/** The fixture dish with two choices and two extras, saved by the owner. */
async function withOptions(tx: Tx, f: Fixtures) {
  await run(tx, f.ownerId, (q) =>
    save(q, f.regular.id, [
      { kind: "choice", label: "Rice", extra: 0, isDefault: true },
      { kind: "choice", label: "Chapati", extra: 30 },
      { kind: "extra", label: "Avocado", extra: 50 },
      { kind: "extra", label: "Extra egg", extra: 40 },
    ]),
  );
  const rows = await tx`select id, kind, label, price_delta_kes, is_default, sort_order from public.dish_options
                        where dish_id = ${f.regular.id} and not archived order by sort_order`;
  const by = Object.fromEntries(rows.map((r: { label: string }) => [r.label, r])) as Record<string, { id: string; is_default: boolean }>;
  return { rice: by.Rice!, chapati: by.Chapati!, avocado: by.Avocado!, egg: by["Extra egg"]! };
}

const regularItem = (f: Fixtures, extra: Record<string, unknown> = {}) => ({ dish_id: f.regular.id, quantity: 1, ...extra });

describe("save_dish_options", () => {
  test("saves choices and extras in order, with one default", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const rows = await tx`select label, kind, price_delta_kes, is_default from public.dish_options
                            where dish_id = ${f.regular.id} and not archived order by sort_order`;
      expect(rows).toEqual([
        { label: "Rice", kind: "choice", price_delta_kes: 0, is_default: true },
        { label: "Chapati", kind: "choice", price_delta_kes: 30, is_default: false },
        { label: "Avocado", kind: "extra", price_delta_kes: 50, is_default: false },
        { label: "Extra egg", kind: "extra", price_delta_kes: 40, is_default: false },
      ]);
      // Moving the default, reordering and renaming in one save.
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { id: o.chapati.id, kind: "choice", label: "Chapati", extra: 30, isDefault: true },
          { id: o.rice.id, kind: "choice", label: "Pilau rice", extra: 0 },
          { id: o.egg.id, kind: "extra", label: "Extra egg", extra: 40 },
          { id: o.avocado.id, kind: "extra", label: "Avocado", extra: 60 },
        ]),
      );
      const after = await tx`select label, price_delta_kes, is_default from public.dish_options
                             where dish_id = ${f.regular.id} and not archived order by sort_order`;
      expect(after).toEqual([
        { label: "Chapati", price_delta_kes: 30, is_default: true },
        { label: "Pilau rice", price_delta_kes: 0, is_default: false },
        { label: "Extra egg", price_delta_kes: 40, is_default: false },
        { label: "Avocado", price_delta_kes: 60, is_default: false },
      ]);
    }));

  test("no default marked makes the first choice the default", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { kind: "choice", label: "Rice", extra: 0 },
          { kind: "choice", label: "Ugali", extra: 0 },
        ]),
      );
      const rows = await tx`select label from public.dish_options where dish_id = ${f.regular.id} and is_default`;
      expect(rows).toEqual([{ label: "Rice" }]);
    }));

  test("refuses one choice, a free extra, a ninth of either, a duplicate label and a long label; nothing saved", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const nine = (kind: "choice" | "extra") =>
        Array.from({ length: 9 }, (_, i) => ({ kind, label: `${kind} ${i + 1}`, extra: 10 }));
      const cases: [Opt[], string][] = [
        [[{ kind: "choice", label: "Rice", extra: 0 }], MSG.oneChoice],
        [[{ kind: "extra", label: "Avocado", extra: 0 }], MSG.freeExtra],
        [nine("extra"), MSG.nineExtras],
        [nine("choice"), MSG.nineChoices],
        [
          [
            { kind: "choice", label: "Rice", extra: 0 },
            { kind: "choice", label: "Ugali", extra: 0 },
            { kind: "extra", label: " rice ", extra: 20 },
          ],
          "Each choice and extra needs a different name.",
        ],
        [
          [
            { kind: "choice", label: "x".repeat(41), extra: 0 },
            { kind: "choice", label: "Ugali", extra: 0 },
          ],
          "A name can be up to 40 characters.",
        ],
        [
          [
            { kind: "choice", label: "Rice", extra: 2001 },
            { kind: "choice", label: "Ugali", extra: 0 },
          ],
          "A price can be up to KSh 2,000.",
        ],
      ];
      for (const [opts, message] of cases) {
        expect(await as(tx, f.ownerId, (q) => save(q, f.regular.id, opts))).toEqual(refused(message));
      }
      const [{ n }] = await tx`select count(*)::int n from public.dish_options where dish_id = ${f.regular.id}`;
      expect(n).toBe(0);
    }));

  test("one extra alone and eight of each are fine", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      expect(await as(tx, f.ownerId, (q) => save(q, f.regular.id, [{ kind: "extra", label: "Avocado", extra: 50 }]))).toBeNull();
      const eight = (kind: "choice" | "extra") => Array.from({ length: 8 }, (_, i) => ({ kind, label: `${kind} ${i + 1}`, extra: 2000 }));
      expect(await as(tx, f.ownerId, (q) => save(q, f.regular.id, [...eight("choice"), ...eight("extra")]))).toBeNull();
    }));

  test("removing an ordered option archives it and keeps the order's labels; an unordered one is deleted", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const order = await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.chapati.id, extra_ids: [o.avocado.id] })]));
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { id: o.rice.id, kind: "choice", label: "Rice", extra: 0, isDefault: true },
          { kind: "choice", label: "Ugali", extra: 0 },
        ]),
      );
      const rows = await tx`select label, archived from public.dish_options where dish_id = ${f.regular.id} order by label`;
      expect(rows).toEqual([
        { label: "Avocado", archived: true },
        { label: "Chapati", archived: true },
        { label: "Rice", archived: false },
        { label: "Ugali", archived: false },
      ]);
      const [item] = await tx`select i.option_label, i.unit_price_kes, x.label, x.price_kes
                              from public.order_items i join public.orders o on o.id = i.order_id
                              join public.order_item_extras x on x.order_item_id = i.id
                              where o.public_token = ${order.public_token}`;
      expect(item).toEqual({ option_label: "Chapati", unit_price_kes: 380, label: "Avocado", price_kes: 50 });
      // An archived label can be used again.
      expect(
        await as(tx, f.ownerId, (q) =>
          save(q, f.regular.id, [
            { id: o.rice.id, kind: "choice", label: "Rice", extra: 0, isDefault: true },
            { kind: "choice", label: "Chapati", extra: 0 },
          ]),
        ),
      ).toBeNull();
    }));

  test("swapping two labels in one save works", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { id: o.rice.id, kind: "choice", label: "Chapati", extra: 0, isDefault: true },
          { id: o.chapati.id, kind: "choice", label: "Rice", extra: 30 },
        ]),
      );
      const rows = await tx`select id, label from public.dish_options where dish_id = ${f.regular.id} and not archived and kind = 'choice'`;
      expect(Object.fromEntries(rows.map((r: { id: string; label: string }) => [r.id, r.label]))).toEqual({ [o.rice.id]: "Chapati", [o.chapati.id]: "Rice" });
    }));

  test("needs Dishes and prices, and an unchanged save writes no History line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Plain");
      const cook = await person(tx, "staff", "Cook", ["dishes_prices"]);
      const opts: Opt[] = [
        { kind: "choice", label: "Rice", extra: 0, isDefault: true },
        { kind: "choice", label: "Ugali", extra: 0 },
      ];
      expect(await as(tx, staff, (q) => save(q, f.regular.id, opts))).toEqual(refused(MSG.dishes, "42501"));
      expect(await as(tx, cook, (q) => save(q, f.regular.id, opts))).toBeNull();
      const [{ n: once }] = await tx`select count(*)::int n from public.change_log where action = 'dish.options' and subject_id = ${f.regular.id}`;
      expect(once).toBe(1);
      const ids = await tx`select id, label from public.dish_options where dish_id = ${f.regular.id} order by sort_order`;
      const same = opts.map((o, i) => ({ ...o, id: ids[i]!.id as string }));
      await run(tx, cook, (q) => save(q, f.regular.id, same));
      const [{ n: still }] = await tx`select count(*)::int n from public.change_log where action = 'dish.options' and subject_id = ${f.regular.id}`;
      expect(still).toBe(1);
    }));
});

describe("place_order with choices and extras", () => {
  test("prices the choice and extras from the database and stores the extras", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const order = await placeOrder(
        tx,
        dineIn(f, [regularItem(f, { quantity: 2, option_id: o.chapati.id, extra_ids: [o.egg.id, o.avocado.id], unit_price_kes: 1, extras: [{ id: o.egg.id, price_kes: 1 }] })]),
      );
      // (300 + 30 + 50 + 40) × 2
      expect(order.total_kes).toBe(840);
      const extras = await tx`select x.label, x.price_kes from public.order_item_extras x
                              join public.order_items i on i.id = x.order_item_id join public.orders o on o.id = i.order_id
                              where o.public_token = ${order.public_token} order by x.sort_order`;
      expect(extras).toEqual([
        { label: "Avocado", price_kes: 50 },
        { label: "Extra egg", price_kes: 40 },
      ]);
      const [status] = await tx`select public.get_order_status(${order.public_token}) s`;
      expect(status.s.items).toEqual([
        { name: "Test regular", option_label: "Chapati", quantity: 2, unit_price_kes: 420, extras: [{ label: "Avocado", price_kes: 50 }, { label: "Extra egg", price_kes: 40 }] },
      ]);
    }));

  test("no extras, an empty list or a missing key are all fine; the idempotency key still replays", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const payload = dineIn(f, [regularItem(f, { option_id: o.rice.id, extra_ids: [] })]);
      const first = await placeOrder(tx, payload);
      expect(first.total_kes).toBe(300);
      const again = await placeOrder(tx, payload);
      expect(again).toMatchObject({ public_token: first.public_token, replayed: true });
      expect((await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.rice.id, extra_ids: null })]))).total_kes).toBe(300);
    }));

  test("refuses a duplicate, foreign, archived, non-extra or ninth extra", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const base = { option_id: o.rice.id };
      // Archive Avocado: it was ordered, so removing it archives it.
      await placeOrder(tx, dineIn(f, [regularItem(f, { ...base, extra_ids: [o.avocado.id] })]));
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { id: o.rice.id, kind: "choice", label: "Rice", extra: 0, isDefault: true },
          { id: o.chapati.id, kind: "choice", label: "Chapati", extra: 30 },
          { id: o.egg.id, kind: "extra", label: "Extra egg", extra: 40 },
        ]),
      );
      const bad = [
        [o.egg.id, o.egg.id], // duplicate
        [f.option.id], // another dish's option
        [o.avocado.id], // archived
        [o.chapati.id], // a choice, not an extra
        ["not-a-uuid"],
        Array.from({ length: 9 }, () => crypto.randomUUID()),
      ];
      for (const extra_ids of bad) {
        expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f, { ...base, extra_ids })])))).toBe(MSG.extraGone);
      }
    }));

  test("refuses an archived choice and a missing choice", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.chapati.id })]));
      await run(tx, f.ownerId, (q) =>
        save(q, f.regular.id, [
          { id: o.rice.id, kind: "choice", label: "Rice", extra: 0, isDefault: true },
          { kind: "choice", label: "Ugali", extra: 0 },
        ]),
      );
      expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.chapati.id })])))).toBe(MSG.choiceGone);
      expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f)])))).toBe("Choose a side for Test regular");
    }));

  test("refuses an out-today extra or choice, and every choice out is sold out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      await run(tx, f.ownerId, (q) => q`select public.set_option_out(${o.avocado.id}::uuid, true)`);
      await run(tx, f.ownerId, (q) => q`select public.set_option_out(${o.chapati.id}::uuid, true)`);
      expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.rice.id, extra_ids: [o.avocado.id] })])))).toBe(
        "Sorry, Avocado has run out today. Remove it from Test regular and try again.",
      );
      expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.chapati.id })])))).toBe(
        "Sorry, Chapati has run out today. Choose another side for Test regular.",
      );
      // Extras being out never stops the dish.
      expect((await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.rice.id, extra_ids: [o.egg.id] })]))).total_kes).toBe(340);
      await run(tx, f.ownerId, (q) => q`select public.set_option_out(${o.rice.id}::uuid, true)`);
      expect(await rejection(placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.rice.id })])))).toBe("Sorry, Test regular has sold out");
    }));

  test("out_on yesterday counts as back on", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      await tx`update public.dish_options set out_on = public.nairobi_today() - 1 where dish_id = ${f.regular.id}`;
      const order = await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.chapati.id, extra_ids: [o.avocado.id] })]));
      expect(order.total_kes).toBe(380);
    }));
});

describe("set_option_out", () => {
  test("any staff can switch a choice out and back; History has both lines; nothing else changes", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const waiter = await person(tx, "staff", "Waiter");
      await run(tx, waiter, (q) => q`select public.set_option_out(${o.chapati.id}::uuid, true)`);
      const [row] = await tx`select out_on = public.nairobi_today() as out from public.dish_options where id = ${o.chapati.id}`;
      expect(row.out).toBe(true);
      await run(tx, waiter, (q) => q`select public.set_option_out(${o.chapati.id}::uuid, false)`);
      const [back] = await tx`select out_on from public.dish_options where id = ${o.chapati.id}`;
      expect(back.out_on).toBeNull();
      const lines = await tx`select action, subject_label, after->>'option' as option from public.change_log
                             where action like 'option.%' order by id`;
      expect(lines).toEqual([
        { action: "option.out", subject_label: "Test regular", option: "Chapati" },
        { action: "option.in", subject_label: "Test regular", option: "Chapati" },
      ]);
      const [{ n }] = await tx`select count(*)::int n from public.change_log where action = 'dish.options' and actor = ${waiter}`;
      expect(n).toBe(0);
      // Staff still can't edit the option itself.
      expect(await as(tx, waiter, (q) => q`update public.dish_options set price_delta_kes = 0 where id = ${o.chapati.id}`)).toEqual(
        refused(MSG.dishes, "42501"),
      );
      expect(await as(tx, waiter, (q) => q`update public.dish_options set out_on = public.nairobi_today() where id = ${o.chapati.id}`)).toEqual(
        refused(MSG.dishes, "42501"),
      );
    }));

  test("customers can't call it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const r = await as(tx, null, (q) => q`select public.set_option_out(${o.chapati.id}::uuid, true)`);
      expect(r?.code).toBe("42501");
    }));

  test("todays_menu: sold out when every choice is out today, not for extras", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.dish_options (dish_id, label, sort_order) values (${f.rotating.id}, 'Rice', 1), (${f.rotating.id}, 'Ugali', 2)`;
      const soldOut = async () => (await tx`select sold_out from public.todays_menu where entry_id = ${f.openEntry.id}`)[0]!.sold_out as boolean;
      expect(await soldOut()).toBe(false);
      await tx`insert into public.dish_options (dish_id, kind, label, price_delta_kes, out_on) values (${f.rotating.id}, 'extra', 'Avocado', 50, public.nairobi_today())`;
      await tx`update public.dish_options set out_on = public.nairobi_today() where dish_id = ${f.rotating.id} and label in ('Extra kachumbari', 'Rice')`;
      expect(await soldOut()).toBe(false);
      await tx`update public.dish_options set out_on = public.nairobi_today() where dish_id = ${f.rotating.id} and label = 'Ugali'`;
      expect(await soldOut()).toBe(true);
      await tx`update public.dish_options set out_on = public.nairobi_today() - 1 where dish_id = ${f.rotating.id}`;
      expect(await soldOut()).toBe(false);
    }));
});

describe("dish_options table rules", () => {
  test("price range, priced extras, one default, no default extra, unique live label", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const d = f.regular.id;
      const fails = async (p: (q: Q) => PromiseLike<unknown>) => (await as(tx, f.ownerId, p)) !== null;
      expect(await fails((q) => q`insert into public.dish_options (dish_id, label, price_delta_kes) values (${d}, 'A', 2001)`)).toBe(true);
      expect(await fails((q) => q`insert into public.dish_options (dish_id, label, price_delta_kes) values (${d}, 'A', -1)`)).toBe(true);
      expect(await fails((q) => q`insert into public.dish_options (dish_id, kind, label, price_delta_kes) values (${d}, 'extra', 'A', 0)`)).toBe(true);
      expect(await fails((q) => q`insert into public.dish_options (dish_id, kind, label, price_delta_kes, is_default) values (${d}, 'extra', 'A', 10, true)`)).toBe(true);
      await tx`insert into public.dish_options (dish_id, label, is_default) values (${d}, 'A', true)`;
      expect(await fails((q) => q`insert into public.dish_options (dish_id, label, is_default) values (${d}, 'B', true)`)).toBe(true);
      expect(await fails((q) => q`insert into public.dish_options (dish_id, label) values (${d}, ' a ')`)).toBe(true);
      await tx`update public.dish_options set archived = true, is_default = false where dish_id = ${d}`;
      expect(await fails((q) => q`insert into public.dish_options (dish_id, label, is_default) values (${d}, 'a', true)`)).toBe(false);
    }));

  test("order_item_extras: staff read, customers and staff can't write", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      await placeOrder(tx, dineIn(f, [regularItem(f, { option_id: o.rice.id, extra_ids: [o.egg.id] })]));
      const waiter = await person(tx, "staff", "Waiter");
      const read = await run(tx, waiter, (q) => q`select label from public.order_item_extras`);
      expect(read).toEqual([{ label: "Extra egg" }]);
      expect((await as(tx, null, (q) => q`select * from public.order_item_extras`))?.code).toBe("42501");
      const [x] = await tx`select order_item_id from public.order_item_extras`;
      expect(
        (await as(tx, f.ownerId, (q) => q`insert into public.order_item_extras (order_item_id, option_id, label, price_kes) values (${x.order_item_id}, ${o.egg.id}, 'Free', 0)`))?.code,
      ).toBe("42501");
      expect((await as(tx, f.ownerId, (q) => q`update public.order_item_extras set price_kes = 0`))?.code).toBe("42501");
    }));
});

describe("delivery minimum", () => {
  async function zone(tx: Tx, min: number) {
    const [z] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Testzone', 150, ${min}) returning *`;
    return z;
  }
  const delivery = (f: Fixtures, zoneId: string, items: object[]) => ({
    ...dineIn(f, items as never),
    mode: "delivery",
    table_token: undefined,
    delivery_zone_id: zoneId,
    delivery_address: "Argwings Kodhek Rd",
  });

  test("refuses food under the minimum (fee excluded), accepts at it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx, 800);
      // 2 × 300 = 600 food, + 150 fee = 750: still under 800 of food.
      expect(await rejection(placeOrder(tx, delivery(f, z.id, [regularItem(f, { quantity: 2 })])))).toBe(
        "Your order is under Testzone's KSh 800 minimum for delivery. Add more, or choose pickup.",
      );
      const ok = await placeOrder(tx, delivery(f, z.id, [regularItem(f, { quantity: 2 }), { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id], quantity: 1 }]));
      // 600 + 500 food, + 150 fee
      expect(ok.total_kes).toBe(1250);
    }));

  test("extras count towards the minimum, with thousands written out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await withOptions(tx, f);
      const z = await zone(tx, 380);
      expect((await placeOrder(tx, delivery(f, z.id, [regularItem(f, { option_id: o.chapati.id, extra_ids: [o.avocado.id] })]))).total_kes).toBe(530);
      await tx`update public.delivery_zones set min_order_kes = 20000 where id = ${z.id}`;
      expect(await rejection(placeOrder(tx, delivery(f, z.id, [regularItem(f, { option_id: o.rice.id })])))).toBe(
        "Your order is under Testzone's KSh 20,000 minimum for delivery. Add more, or choose pickup.",
      );
    }));

  test("zone limits: fee 0–5,000, minimum 0–20,000; the minimum change is in the History", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx, 0);
      expect(await as(tx, f.ownerId, (q) => q`update public.delivery_zones set fee_kes = 5001 where id = ${z.id}`)).not.toBeNull();
      expect(await as(tx, f.ownerId, (q) => q`update public.delivery_zones set min_order_kes = 20001 where id = ${z.id}`)).not.toBeNull();
      expect(await as(tx, f.ownerId, (q) => q`update public.delivery_zones set min_order_kes = 800 where id = ${z.id}`)).toBeNull();
      const [line] = await tx`select action, subject_label, before, after from public.change_log where action = 'zone.minimum'`;
      expect(line).toEqual({ action: "zone.minimum", subject_label: "Testzone", before: { minimum: 0 }, after: { minimum: 800 } });
    }));
});

describe("dishes: has orders, restore, archived date", () => {
  test("dish_has_orders and restore_dish are the owner's; restore puts the dish on no menu", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const cook = await person(tx, "staff", "Cook", ["dishes_prices", "everyday_menu"]);
      const has = async (sub: string, dish: string) => (await run(tx, sub, (q) => q`select public.dish_has_orders(${dish}::uuid) r`))[0]!.r;
      expect(await has(f.ownerId, f.rotating.id)).toBe(false);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id], quantity: 1 }]));
      expect(await has(f.ownerId, f.rotating.id)).toBe(true);
      expect(await as(tx, cook, (q) => q`select public.dish_has_orders(${f.rotating.id}::uuid)`)).toEqual(refused(MSG.owner, "42501"));

      await run(tx, f.ownerId, (q) => q`select public.delete_dish(${f.rotating.id}::uuid)`);
      const [archived] = await tx`select archived, archived_at is not null as dated from public.dishes where id = ${f.rotating.id}`;
      expect(archived).toEqual({ archived: true, dated: true });
      expect(await as(tx, cook, (q) => q`select public.restore_dish(${f.rotating.id}::uuid)`)).toEqual(refused(MSG.owner, "42501"));
      await run(tx, f.ownerId, (q) => q`select public.restore_dish(${f.rotating.id}::uuid)`);
      const [d] = await tx`select archived, archived_at, is_regular from public.dishes where id = ${f.rotating.id}`;
      expect(d).toEqual({ archived: false, archived_at: null, is_regular: false });
      const live = await tx`select 1 from public.menu_entries where dish_id = ${f.rotating.id} and published`;
      expect(live).toHaveLength(0);
      const [line] = await tx`select action from public.change_log where subject_id = ${f.rotating.id} order by id desc limit 1`;
      expect(line!.action).toBe("dish.restore");
    }));
});

describe("kitchen phone", () => {
  test("the owner sets it, staff can't, bad formats are refused, empty clears; customers see it on the status page", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const waiter = await person(tx, "staff", "Waiter");
      const set = (q: Q, v: string | null) => q`select public.set_kitchen_phone(${v}) r`;
      expect(await as(tx, waiter, (q) => set(q, "+254712345678"))).toEqual(refused(MSG.owner, "42501"));
      for (const bad of ["+254812345678", "+25471234567", "0712345678", "+254912345678"]) {
        expect(await as(tx, f.ownerId, (q) => set(q, bad))).toEqual(refused(MSG.phone));
      }
      await run(tx, f.ownerId, (q) => set(q, "+254201234567"));
      const order = await placeOrder(tx, dineIn(f, [regularItem(f)]));
      const [s] = await tx`select public.get_order_status(${order.public_token}) s`;
      expect(s.s.phone).toBe("+254201234567");
      const [line] = await tx`select action from public.change_log where action = 'settings.phone'`;
      expect(line).toBeDefined();
      await run(tx, f.ownerId, (q) => set(q, ""));
      const [s2] = await tx`select public.get_order_status(${order.public_token}) s`;
      expect(s2.s.phone).toBeNull();
    }));
});

describe("team RPCs", () => {
  test("staff can't call any of them", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const waiter = await person(tx, "staff", "Waiter", ["dishes_prices", "everyday_menu", "tables_delivery", "close_early"]);
      const other = await person(tx, "staff", "Other");
      const calls: ((q: Q) => PromiseLike<unknown>)[] = [
        (q) => q`select public.team_set_role(${other}::uuid, 'owner')`,
        (q) => q`select public.team_set_name(${other}::uuid, 'Renamed')`,
        (q) => q`select public.team_remove(${other}::uuid)`,
        (q) => q`select public.team_log_reset(${other}::uuid)`,
      ];
      for (const call of calls) expect(await as(tx, waiter, call)).toEqual(refused(MSG.owner, "42501"));
      for (const call of calls) expect((await as(tx, null, call))?.code).toBe("42501");
    }));

  test("the last owner can't be demoted or removed; with a second owner they can", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      expect(await as(tx, f.ownerId, (q) => q`select public.team_set_role(${f.ownerId}::uuid, 'staff')`)).toEqual(refused(MSG.lastOwner));
      const second = await person(tx, "owner", "Second");
      expect(await as(tx, second, (q) => q`select public.team_remove(${f.ownerId}::uuid)`)).toBeNull();
      expect(await as(tx, second, (q) => q`select public.team_set_role(${second}::uuid, 'staff')`)).toEqual(refused(MSG.lastOwner));
      expect(await as(tx, second, (q) => q`select public.team_remove(${second}::uuid)`)).toEqual(
        refused("You can't remove yourself. Another owner can."),
      );
    }));

  test("role, name and remove write their History lines; remove takes the grants", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const otieno = await person(tx, "staff", "Otieno", ["close_early"]);
      await run(tx, f.ownerId, (q) => q`select public.team_set_name(${otieno}::uuid, '  Otieno O. ')`);
      await run(tx, f.ownerId, (q) => q`select public.team_set_role(${otieno}::uuid, 'owner')`);
      await run(tx, f.ownerId, (q) => q`select public.team_set_role(${otieno}::uuid, 'staff')`);
      expect(await as(tx, f.ownerId, (q) => q`select public.team_set_name(${otieno}::uuid, '  ')`)).toEqual(refused("Enter a name."));
      await run(tx, f.ownerId, (q) => q`select public.team_remove(${otieno}::uuid)`);
      const lines = await tx`select action, subject_label, before, after from public.change_log where subject_id = ${otieno} order by id`;
      expect(lines.map((l: { action: string }) => l.action)).toEqual(["staff.rename", "staff.role", "staff.role", "staff.remove"]);
      expect(lines[0]).toMatchObject({ before: { name: "Otieno" }, after: { name: "Otieno O." } });
      const grants = await tx`select 1 from public.staff_grants where user_id = ${otieno}`;
      expect(grants).toHaveLength(0);
    }));

  test("an invite is logged as one, and cancelling it as a cancelled invite", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [u] = await tx`insert into auth.users (email) values ('new@test.local') returning id`;
      await run(tx, f.ownerId, (q) => q`insert into public.staff (user_id, role, display_name, invited_at) values (${u.id}, 'staff', 'Newbie', now())`);
      await run(tx, f.ownerId, (q) => q`select public.team_remove(${u.id}::uuid, true)`);
      const lines = await tx`select action, subject_label from public.change_log where subject_id = ${u.id} order by id`;
      expect(lines).toEqual([
        { action: "staff.invite", subject_label: "Newbie" },
        { action: "staff.cancel_invite", subject_label: "Newbie" },
      ]);
    }));

  test("cancel invite refuses someone who has already accepted", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const otieno = await person(tx, "staff", "Otieno");
      expect(await as(tx, f.ownerId, (q) => q`select public.team_remove(${otieno}::uuid, true)`)).toEqual(
        refused("That person has already accepted the invite. Refresh the page."),
      );
      expect(await tx`select 1 from public.staff where user_id = ${otieno}`).toHaveLength(1);
    }));

  test("reset: owner-checked, never another owner or yourself, forces a change, no password in the History", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`alter table auth.users add column if not exists encrypted_password text`;
      const otieno = await person(tx, "staff", "Otieno");
      const second = await person(tx, "owner", "Second");
      expect(await as(tx, f.ownerId, (q) => q`select public.team_log_reset(${second}::uuid)`)).toEqual(
        refused("Owners reset their own password with Forgot password on the sign-in page."),
      );
      expect(await as(tx, f.ownerId, (q) => q`select public.team_log_reset(${f.ownerId}::uuid)`)).toEqual(
        refused("Owners reset their own password with Forgot password on the sign-in page."),
      );
      // The action sets the temporary password through the admin API first, then logs the reset.
      await tx`update auth.users set encrypted_password = '$2a$10$temporaryhashtemporaryha' where id = ${otieno}`;
      await run(tx, f.ownerId, (q) => q`select public.team_log_reset(${otieno}::uuid)`);
      const [s] = await tx`select must_change_password from public.staff where user_id = ${otieno}`;
      expect(s.must_change_password).toBe(true);
      const [line] = await tx`select action, before, after from public.change_log where subject_id = ${otieno} and action = 'staff.reset'`;
      expect(line).toEqual({ action: "staff.reset", before: null, after: null });

      // The person clears it themselves, only after choosing a new password, and only their own row.
      expect(await as(tx, otieno, (q) => q`select public.clear_must_change_password()`)).toEqual(
        refused("Choose a new password, not the temporary one."),
      );
      await tx`update auth.users set encrypted_password = '$2a$10$theirownhashtheirownhash' where id = ${otieno}`;
      await run(tx, otieno, (q) => q`select public.clear_must_change_password()`);
      const [s2] = await tx`select must_change_password from public.staff where user_id = ${otieno}`;
      expect(s2.must_change_password).toBe(false);
      expect(await tx`select 1 from public.password_resets where user_id = ${otieno}`).toHaveLength(0);
    }));

  test("the forced change can't be skipped: no password, the temporary one, or reading the stored hash", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`alter table auth.users add column if not exists encrypted_password text`;
      const otieno = await person(tx, "staff", "Otieno");
      await tx`update auth.users set encrypted_password = '$2a$10$temporaryhashtemporaryha' where id = ${otieno}`;
      await run(tx, f.ownerId, (q) => q`select public.team_log_reset(${otieno}::uuid)`);

      // The stored hash is out of reach of everyone, the owner included.
      for (const who of [otieno, f.ownerId]) {
        expect((await as(tx, who, (q) => q`select * from public.password_resets`))?.code).toBe("42501");
      }
      expect((await as(tx, null, (q) => q`select public.clear_must_change_password()`))?.code).toBe("42501");

      // A second reset replaces the stored hash; the first temporary password still doesn't count.
      await tx`update auth.users set encrypted_password = '$2a$10$secondtemporarysecondtem' where id = ${otieno}`;
      await run(tx, f.ownerId, (q) => q`select public.team_log_reset(${otieno}::uuid)`);
      expect(await as(tx, otieno, (q) => q`select public.clear_must_change_password()`)).toEqual(
        refused("Choose a new password, not the temporary one."),
      );
      await tx`update auth.users set encrypted_password = '' where id = ${otieno}`;
      expect(await as(tx, otieno, (q) => q`select public.clear_must_change_password()`)).toEqual(refused("Choose a password first."));
      const [still] = await tx`select must_change_password from public.staff where user_id = ${otieno}`;
      expect(still.must_change_password).toBe(true);

      // An invite: "Invited" ends only once a password exists.
      const [u] = await tx`insert into auth.users (email, encrypted_password) values ('new@test.local', '') returning id`;
      await tx`insert into public.staff (user_id, role, display_name, invited_at) values (${u.id}, 'staff', 'Newbie', now())`;
      expect(await as(tx, u.id, (q) => q`select public.clear_must_change_password()`)).toEqual(refused("Choose a password first."));
      await tx`update auth.users set encrypted_password = '$2a$10$newbiehashnewbiehashnewb' where id = ${u.id}`;
      await run(tx, u.id, (q) => q`select public.clear_must_change_password()`);
      const [n] = await tx`select invited_at from public.staff where user_id = ${u.id}`;
      expect(n.invited_at).toBeNull();

      // Nothing pending: a no-op, not an error.
      const amina = await person(tx, "staff", "Amina");
      expect(await as(tx, amina, (q) => q`select public.clear_must_change_password()`)).toBeNull();
    }));

  test("remove and reset end the person's sessions at once, and only theirs", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx.unsafe(`create table if not exists auth.sessions (
        id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
        refresh_token text not null unique, created_at timestamptz not null default now())`);
      await tx`alter table auth.users add column if not exists encrypted_password text`;
      const otieno = await person(tx, "staff", "Otieno");
      const amina = await person(tx, "staff", "Amina");
      const open = async (who: string) => tx`insert into auth.sessions (user_id, refresh_token) values (${who}, ${crypto.randomUUID()})`;
      const count = async (who: string) => Number((await tx`select count(*)::int as n from auth.sessions where user_id = ${who}`)[0].n);
      await open(otieno);
      await open(otieno);
      await open(amina);
      await open(f.ownerId);
      await run(tx, f.ownerId, (q) => q`select public.team_log_reset(${otieno}::uuid)`);
      expect(await count(otieno)).toBe(0);
      await open(otieno);
      await run(tx, f.ownerId, (q) => q`select public.team_remove(${otieno}::uuid)`);
      expect(await count(otieno)).toBe(0);
      expect(await count(amina)).toBe(1);
      expect(await count(f.ownerId)).toBe(1);
      // Nobody calls it directly.
      expect((await as(tx, f.ownerId, (q) => q`select public.end_sessions(${amina}::uuid)`))?.code).toBe("42501");
    }));

  test("clear_must_change_password also ends the invited state", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`alter table auth.users add column if not exists encrypted_password text`;
      const [u] = await tx`insert into auth.users (email, encrypted_password) values ('inv@test.local', '$2a$10$invitedhashinvitedhashin') returning id`;
      await tx`insert into public.staff (user_id, role, display_name, invited_at) values (${u.id}, 'staff', 'Inv', now())`;
      await run(tx, u.id, (q) => q`select public.clear_must_change_password()`);
      const [s] = await tx`select invited_at from public.staff where user_id = ${u.id}`;
      expect(s.invited_at).toBeNull();
      void f;
    }));
});

describe("has_password", () => {
  test("true only for the caller's own set password; links-only and anon get false", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      // The hosted auth.users has this column; the local stand-ins add it later or not at all.
      await tx`alter table auth.users add column if not exists encrypted_password text`;
      const withPw = await person(tx, "staff", "Haspw");
      const linksOnly = await person(tx, "staff", "Linksonly");
      const invited = await person(tx, "staff", "Invitee");
      await tx`update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv' where id = ${withPw}`;
      await tx`update auth.users set encrypted_password = '' where id = ${invited}`;
      const ask = async (sub: string) => (await run(tx, sub, (q) => q`select public.has_password() as v`))[0]!.v;
      expect(await ask(withPw)).toBe(true);
      expect(await ask(linksOnly)).toBe(false);
      expect(await ask(invited)).toBe(false);
      expect((await as(tx, null, (q) => q`select public.has_password()`))?.code).toBe("42501");
    }));
});
