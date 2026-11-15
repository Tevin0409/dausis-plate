// Slice 2.11 B and C on the order side (spec-2.11-ads-promos.md, "Tests: Combos" and "Tests: Codes"):
// place_order with combos and discount codes, check_cart's combo lines and get_order_status.
// Two orders racing for a code's last use need two connections: scripts/check-promo-races.ts.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, platesSold, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Everyday 300 + 500 = 800; the combo is 700. The rotating dish comes from the open entry (3 plates). */
async function lunchCombo(tx: Tx, f: Fixtures, rotating = 1) {
  const items = [{ dish_id: f.regular.id, quantity: 1 }, { dish_id: f.rotating.id, quantity: rotating }];
  const [r] = await attempt(tx, "authenticated", f.ownerId, (q) =>
    q`select public.save_combo(${JSON.stringify({ name: "Lunch combo", price_kes: 700, items })}::text::jsonb) id`);
  return r!.id as string;
}
const parts = (f: Fixtures, rotating: Row = {}) => [
  { dish_id: f.regular.id },
  { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, ...rotating },
];
const comboLine = (id: string, f: Fixtures, quantity = 1, rotating: Row = {}) => ({ combo_id: id, quantity, parts: parts(f, rotating) });

type Refusal = { message: string; detail: string | null; hint: string | null };
const refused = (p: Promise<unknown>): Promise<Refusal> =>
  p.then(
    () => { throw new Error("expected a refusal"); },
    (e: { message: string; detail?: string; hint?: string }) => ({ message: e.message, detail: e.detail ?? null, hint: e.hint ?? null }),
  );

async function orderRow(tx: Tx, token: string) {
  const [o] = await tx`select * from public.orders where public_token = ${token}`;
  return o!;
}
async function status(tx: Tx, token: string) {
  const [r] = await attempt(tx, "anon", null, (q) => q`select public.get_order_status(${token}::uuid) s`);
  return r!.s as Row;
}
async function cart(tx: Tx, lines: object[]) {
  const [r] = await attempt(tx, "anon", null, (q) => q`select public.check_cart(${JSON.stringify(lines)}::text::jsonb) r`);
  return r!.r as Row[];
}

type CodeIn = Partial<{ code: string; kind: string; value: number; cap_kes: number | null; starts_on: string; ends_on: string;
  max_uses: number | null; once_per_phone: boolean; min_order_kes: number | null; modes: string; active: boolean }>;
async function code(tx: Tx, c: CodeIn = {}) {
  const v = { code: "KARIBU10", kind: "percent", value: 10, cap_kes: 300, max_uses: null, once_per_phone: false,
              min_order_kes: null, modes: "{dine_in,pickup,delivery}", active: true, ...c };
  const [r] = await tx`
    insert into public.discount_codes (code, kind, value, cap_kes, starts_on, ends_on, max_uses, once_per_phone, min_order_kes, modes, active)
    values (${v.code}, ${v.kind}, ${v.value}, ${v.cap_kes}, coalesce(${v.starts_on ?? null}::date, public.nairobi_today()),
            coalesce(${v.ends_on ?? null}::date, public.nairobi_today() + 30), ${v.max_uses}, ${v.once_per_phone},
            ${v.min_order_kes}, ${v.modes}::public.order_mode[], ${v.active})
    returning *`;
  return r!;
}
const regular = (f: Fixtures, quantity = 1) => [{ dish_id: f.regular.id, quantity }];

describe("place_order: combos", () => {
  test("priced as the combo plus choices and extras; client prices ignored; plates go down per dish", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      const o = await placeOrder(tx, dineIn(f, regular(f), {
        combos: [{ ...comboLine(id, f, 2, { extra_ids: [f.option.id] }), price_kes: 1, unit_price_kes: 1 }],
        subtotal_kes: 1, total_kes: 1,
      }));
      // 300 regular + 2 × (700 + 50 extra)
      expect(o.total_kes).toBe(1800);
      const row = await orderRow(tx, o.public_token);
      expect(row).toMatchObject({ subtotal_kes: 1800, discount_kes: 0, total_kes: 1800, discount_code_id: null, discount_code: null });
      const [oc] = await tx`select * from public.order_combos where order_id = ${row.id}`;
      expect(oc).toMatchObject({ combo_id: id, name: "Lunch combo", unit_price_kes: 700, quantity: 2 });
      const items = await tx`
        select name, unit_price_kes, quantity, order_combo_id is not null as in_combo
        from public.order_items where order_id = ${row.id} order by in_combo, name`;
      expect(items).toEqual([
        { name: "Test regular", unit_price_kes: 300, quantity: 1, in_combo: false },
        { name: "Test regular", unit_price_kes: 0, quantity: 2, in_combo: true },
        { name: "Test rotating", unit_price_kes: 50, quantity: 2, in_combo: true },
      ]);
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);
      // The subtotal is the sum of the rows, as Reports reads it.
      const [sum] = await tx`
        select (select sum(unit_price_kes * quantity) from public.order_items where order_id = ${row.id})
             + (select sum(unit_price_kes * quantity) from public.order_combos where order_id = ${row.id}) s`;
      expect(Number(sum!.s)).toBe(1800);
    }));

  test("parts that don't match the combo are refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      const tries = [
        [{ dish_id: f.regular.id }],
        [...parts(f), { dish_id: f.late.id, menu_entry_id: f.closedEntry.id }],
        [{ dish_id: f.regular.id }, { dish_id: f.regular.id }],
        [{ dish_id: f.regular.id, quantity: 2 }, { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id }],
        [{ dish_id: f.regular.id }, { dish_id: f.late.id }],
      ];
      for (const p of tries) {
        const r = await refused(placeOrder(tx, dineIn(f, [], { combos: [{ combo_id: id, quantity: 1, parts: p }] })));
        expect(r.detail).toBe("combo_parts");
      }
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);
    }));

  test("a combo switched off, archived or missing is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      await tx`update public.combos set active = false where id = ${id}`;
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(id, f)] })))).detail).toBe("combo_off");
      await tx`update public.combos set active = true, archived = true where id = ${id}`;
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(id, f)] })))).detail).toBe("combo_off");
      const gone = await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(crypto.randomUUID(), f)] })));
      expect(gone).toMatchObject({ detail: "combo_off", message: "A combo in your order isn’t available any more. Remove it and try again." });
    }));

  test("a sold-out or short part refuses the whole order and takes no plates", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      // 4 combos need 4 of the rotating dish's 3 plates.
      expect((await refused(placeOrder(tx, dineIn(f, regular(f), { combos: [comboLine(id, f, 4)] })))).detail).toBe("over_plates");
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);
      // Items and combos share the plates: 2 as an item and 2 in combos is 4.
      const item = [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }];
      expect((await refused(placeOrder(tx, dineIn(f, item, { combos: [comboLine(id, f, 2)] })))).detail).toBe("over_plates");
      await tx`update public.dishes set unavailable_on = public.nairobi_today() where id = ${f.regular.id}`;
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(id, f)] })))).detail).toBe("sold_out");
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);
    }));

  test("the item limit counts each dish of a combo; a combo alone is an order; quantity limits", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      const many = Array.from({ length: 29 }, () => ({ dish_id: f.regular.id, quantity: 1 }));
      expect((await refused(placeOrder(tx, dineIn(f, many, { combos: [comboLine(id, f)] })))).message).toBe("Too many items in one order");
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(id, f, 21)] })))).message).toBe("Invalid quantity");
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [] })))).message).toBe("Your order is empty");
      expect((await placeOrder(tx, dineIn(f, [], { items: undefined, combos: [comboLine(id, f)] }))).total_kes).toBe(700);
    }));

  test("check_cart: a combo line's state, capped quantity and price", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      const [dish, ok] = await cart(tx, [
        { key: "d", dish_id: f.regular.id, quantity: 1 },
        { key: "c", ...comboLine(id, f, 1, { extra_ids: [f.option.id] }) },
      ]);
      expect(dish).toMatchObject({ key: "d", state: "ok", unit_price_kes: 300 });
      expect(ok).toMatchObject({ key: "c", kind: "combo", state: "ok", quantity: 1, unit_price_kes: 750 });
      expect(ok!.parts).toHaveLength(2);
      // 5 combos, 3 plates: capped to 3.
      expect((await cart(tx, [{ key: "c", ...comboLine(id, f, 5) }]))[0]).toMatchObject({ state: "capped", quantity: 3, unit_price_kes: 700 });
      // A dish line ahead of it takes plates first.
      const [, after] = await cart(tx, [
        { key: "d", dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 3 },
        { key: "c", ...comboLine(id, f, 1) },
      ]);
      expect(after).toMatchObject({ state: "sold_out", quantity: 0 });
      expect((await cart(tx, [{ key: "c", combo_id: id, quantity: 1, parts: [{ dish_id: f.regular.id }] }]))[0])
        .toMatchObject({ state: "combo_parts", quantity: 0 });
      await tx`update public.combos set active = false where id = ${id}`;
      expect((await cart(tx, [{ key: "c", ...comboLine(id, f) }]))[0]).toMatchObject({ state: "combo_off", quantity: 0 });
      // A dish line can't pass itself off as a combo part to get a price of 0.
      expect((await cart(tx, [{ key: "d", dish_id: f.regular.id, quantity: 1, combo_n: 1, per: 1 }]))[0])
        .toMatchObject({ unit_price_kes: 300 });
    }));

  test("check_cart: a capped or refused combo keeps only the plates its whole combos use (R211-02)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx); // the rotating dish (A) has 3 plates; the regular (B) has no limit
      const save = async (name: string, items: { dish_id: string; quantity: number }[]) => {
        const [r] = await attempt(tx, "authenticated", f.ownerId, (q) =>
          q`select public.save_combo(${JSON.stringify({ name, price_kes: 700, items })}::text::jsonb) id`);
        return r!.id as string;
      };
      const c1 = await save("Double A", [{ dish_id: f.rotating.id, quantity: 2 }, { dish_id: f.regular.id, quantity: 1 }]);
      const c2 = await save("Single A", [{ dish_id: f.rotating.id, quantity: 1 }, { dish_id: f.regular.id, quantity: 1 }]);
      const a = { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id };
      const b = { dish_id: f.regular.id };
      // r1's repro: 2 × (2A + B) is capped to 1, which uses 2 of the 3 plates, so 1 × (A + B) fits.
      const [one, two] = await cart(tx, [
        { key: "c1", combo_id: c1, quantity: 2, parts: [a, b] },
        { key: "c2", combo_id: c2, quantity: 1, parts: [a, b] },
      ]);
      expect([one!.state, one!.quantity, two!.state, two!.quantity]).toEqual(["capped", 1, "ok", 1]);
      // And place_order takes exactly that cart.
      const placed = await placeOrder(tx, dineIn(f, [], { combos: [
        { combo_id: c1, quantity: 1, parts: [a, b] }, { combo_id: c2, quantity: 1, parts: [a, b] }] }));
      expect(placed.total_kes).toBe(1400);
    }));

  test("check_cart: an unavailable part gives back its combo's plates; a dish line still comes first (R211-02)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const save = async (name: string, items: { dish_id: string; quantity: number }[]) => {
        const [r] = await attempt(tx, "authenticated", f.ownerId, (q) =>
          q`select public.save_combo(${JSON.stringify({ name, price_kes: 700, items })}::text::jsonb) id`);
        return r!.id as string;
      };
      const c1 = await save("Double A", [{ dish_id: f.rotating.id, quantity: 2 }, { dish_id: f.regular.id, quantity: 1 }]);
      const c2 = await save("Single A", [{ dish_id: f.rotating.id, quantity: 1 }, { dish_id: f.regular.id, quantity: 1 }]);
      const a = { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id };
      const b = { dish_id: f.regular.id };
      // B asks for an extra that isn't B's: the first combo can't be had and takes no plates of A.
      const [off, after] = await cart(tx, [
        { key: "c1", combo_id: c1, quantity: 1, parts: [a, { ...b, extra_ids: [crypto.randomUUID()] }] },
        { key: "c2", combo_id: c2, quantity: 3, parts: [a, b] },
      ]);
      expect([off!.state, off!.quantity]).toEqual(["option_out", 0]);
      expect([after!.state, after!.quantity]).toEqual(["ok", 3]);
      // A dish line of A first (1 plate), then 2 × (2A + B) capped to 1 (2 plates): nothing left for A + B.
      const [dish, capped, out] = await cart(tx, [
        { key: "d", ...a, quantity: 1 },
        { key: "c1", combo_id: c1, quantity: 2, parts: [a, b] },
        { key: "c2", combo_id: c2, quantity: 1, parts: [a, b] },
      ]);
      expect([dish!.state, capped!.state, capped!.quantity, out!.state, out!.quantity]).toEqual(["ok", "capped", 1, "sold_out", 0]);
    }));

  test("get_order_status: combos with their dishes, items without them, the discount and its code", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      await code(tx);
      const o = await placeOrder(tx, dineIn(f, regular(f, 2), {
        combos: [comboLine(id, f, 2, { extra_ids: [f.option.id], note: "Less salt" })], discount_code: " karibu10 ",
      }));
      const s = await status(tx, o.public_token);
      expect(s).toMatchObject({ subtotal_kes: 2100, discount_kes: 60, discount_code: "KARIBU10", total_kes: 2040 });
      expect(s.items).toEqual([{ name: "Test regular", option_label: null, quantity: 2, unit_price_kes: 300, note: null, extras: [] }]);
      expect(s.combos).toEqual([{
        name: "Lunch combo", quantity: 2, unit_price_kes: 750,
        parts: expect.arrayContaining([
          { name: "Test regular", option_label: null, quantity: 1, note: null, extras: [] },
          { name: "Test rotating", option_label: null, quantity: 1, note: "Less salt", extras: [{ label: "Extra kachumbari", price_kes: 50 }] },
        ]),
      }]);
      expect(s.rate_dishes).toEqual(["Test regular", "Test rotating"]);
    }));
});

describe("place_order: discount codes", () => {
  test("percent floors and caps, covers dishes only, never the delivery fee", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      await code(tx, { value: 15, cap_kes: 100 });
      // Food 3 × 300 + 700 = 1600; covered 900; 15% = 135, capped at 100.
      const [z] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Test zone', 150, 0) returning *`;
      const o = await placeOrder(tx, dineIn(f, regular(f, 3), {
        mode: "delivery", table_token: null, delivery_zone_id: z!.id, delivery_address: "Hse 12, Rose Ave",
        combos: [comboLine(id, f)], discount_code: "KARIBU10",
      }));
      expect(await orderRow(tx, o.public_token)).toMatchObject({ subtotal_kes: 1600, discount_kes: 100, delivery_fee_kes: 150, total_kes: 1650 });
      // 7% of 300 is 21; of 900 is 63: floored.
      await code(tx, { code: "SEVEN", value: 7 });
      const p = await placeOrder(tx, dineIn(f, regular(f, 3), { discount_code: "SEVEN" }));
      expect(await orderRow(tx, p.public_token)).toMatchObject({ subtotal_kes: 900, discount_kes: 63, total_kes: 837, discount_code: "SEVEN" });
    }));

  test("a fixed amount never goes past the dishes it covers", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      await code(tx, { code: "BIG500", kind: "amount", value: 500, cap_kes: null });
      const o = await placeOrder(tx, dineIn(f, regular(f), { combos: [comboLine(id, f)], discount_code: "BIG500" }));
      expect(await orderRow(tx, o.public_token)).toMatchObject({ subtotal_kes: 1000, discount_kes: 300, total_kes: 700 });
    }));

  test("a code typed with spaces or in lower case is the same code (RQA211-02)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await code(tx, { code: "BIG500", kind: "amount", value: 100, cap_kes: null });
      const o = await placeOrder(tx, dineIn(f, regular(f, 2), { discount_code: " big 5\t00 " }));
      expect(await orderRow(tx, o.public_token)).toMatchObject({ subtotal_kes: 600, discount_kes: 100, total_kes: 500, discount_code: "BIG500" });
      const [r] = await attempt(tx, "anon", null, (q) =>
        q`select * from public.check_discount_code(${"b i g500"}, ${600}, ${600}, ${null}::public.order_mode, ${null})`);
      expect(r).toMatchObject({ ok: true, code: "BIG500", discount_kes: 100 });
    }));

  test("each refusal: hint discount_code:<reason>, nothing placed, no plates taken", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await lunchCombo(tx, f);
      await code(tx, { code: "OFF10", active: false });
      await code(tx, { code: "LATER10", starts_on: "2099-01-01", ends_on: "2099-02-01" });
      await code(tx, { code: "OLD10", starts_on: "2020-01-01", ends_on: "2020-01-31" });
      await code(tx, { code: "MIN10", min_order_kes: 800 });
      await code(tx, { code: "PICK10", modes: "{pickup}" });
      await code(tx, { code: "ONE10", max_uses: 1 });
      await code(tx, { code: "PHONE10", once_per_phone: true });
      const entry = [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }];
      const reason = async (c: string, extra: Row = {}) =>
        (await refused(placeOrder(tx, dineIn(f, entry, { discount_code: c, ...extra })))).hint;
      expect(await reason("NOPE99")).toBe("discount_code:unknown");
      expect(await reason("x!")).toBe("discount_code:unknown");
      expect(await reason("OFF10")).toBe("discount_code:off");
      expect(await reason("LATER10")).toBe("discount_code:not_started");
      expect(await reason("OLD10")).toBe("discount_code:ended");
      expect(await reason("MIN10")).toBe("discount_code:min_order");
      expect(await reason("PICK10")).toBe("discount_code:mode");
      await code(tx);
      expect((await refused(placeOrder(tx, dineIn(f, [], { combos: [comboLine(id, f)], discount_code: "KARIBU10" })))))
        .toMatchObject({ detail: "discount_code", hint: "discount_code:combos_only", message: "KARIBU10 can’t be used: codes don’t apply to combos." });
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);
      expect(Number((await tx`select count(*) n from public.orders`)[0]!.n)).toBe(0);

      // The minimum counts all the food, combos too, before the discount: 300 + 700 = 1000 ≥ 800.
      expect((await placeOrder(tx, dineIn(f, regular(f), { combos: [comboLine(id, f)], discount_code: "MIN10" }))).total_kes).toBe(970);
      expect((await placeOrder(tx, dineIn(f, entry, { discount_code: "ONE10" }))).total_kes).toBe(405);
      expect(await reason("ONE10")).toBe("discount_code:used_up");
      expect((await placeOrder(tx, dineIn(f, regular(f), { discount_code: "PHONE10", customer_phone: "0712345678" }))).total_kes).toBe(270);
      expect(await reason("PHONE10", { customer_phone: "+254 712 345 678" })).toBe("discount_code:phone_used");
      expect((await placeOrder(tx, dineIn(f, regular(f), { discount_code: "PHONE10", customer_phone: "0722000111" }))).total_kes).toBe(270);
    }));

  test("the area minimum counts the food before the discount", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await code(tx, { code: "HALF", value: 50, cap_kes: 1000 });
      const [z] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Test zone', 150, 600) returning *`;
      const o = await placeOrder(tx, dineIn(f, regular(f, 2), {
        mode: "delivery", table_token: null, delivery_zone_id: z!.id, delivery_address: "Hse 12, Rose Ave", discount_code: "HALF",
      }));
      expect(await orderRow(tx, o.public_token)).toMatchObject({ subtotal_kes: 600, discount_kes: 300, total_kes: 450 });
    }));

  test("cancelling an order gives its use back; a retry returns the same order and discount", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await code(tx, { max_uses: 1 });
      const payload = dineIn(f, regular(f, 2), { discount_code: "KARIBU10" });
      const first = await placeOrder(tx, payload);
      const again = await placeOrder(tx, payload);
      expect(again).toMatchObject({ public_token: first.public_token, total_kes: 540, replayed: true });
      expect((await refused(placeOrder(tx, dineIn(f, regular(f), { discount_code: "KARIBU10" })))).hint).toBe("discount_code:used_up");
      await tx`update public.orders set status = 'cancelled' where public_token = ${first.public_token}`;
      expect((await placeOrder(tx, dineIn(f, regular(f), { discount_code: "KARIBU10" }))).total_kes).toBe(270);
    }));

  test("the order total and discount constraints hold", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await placeOrder(tx, dineIn(f, regular(f)));
      const bad = (set: string) => tx.savepoint((sp) => sp.unsafe(`update public.orders set ${set} where public_token = '${o.public_token}'`)).then(() => "ok", (e) => e.errno);
      expect(await bad("discount_kes = 10")).toBe("23514");
      expect(await bad("discount_kes = 400, total_kes = -100")).toBe("23514");
      expect(await bad("discount_kes = 10, total_kes = 290")).toBe("ok");
    }));
});
