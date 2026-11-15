// Slice 2.8, customer flow (docs/plans/launch/plan-2.8-build.md step 1): the menu customers see
// (today, or the next open day while closed), the cart check against it, place_order's detail
// codes, the status page's extra fields and order lookup by phone and code.
import { describe, expect, test } from "bun:test";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = Parameters<Parameters<typeof inTx>[0]>[0];

const anonCall = <T,>(tx: Tx, fn: (sp: Tx) => PromiseLike<T[]>) => attempt(tx, "anon", null, fn as never) as unknown as Promise<T[]>;

async function today(tx: Tx) {
  const [r] = await tx`select public.nairobi_today()::text as d, extract(dow from public.nairobi_today())::int as dow`;
  return { day: r.d as string, dow: r.dow as number };
}

/** Closed all of today (a closed day), open all day tomorrow: the menu is tomorrow's. */
async function closeToday(tx: Tx) {
  const { dow } = await today(tx);
  await tx`update public.opening_hours set is_open = (weekday <> ${dow})`;
}

const line = (key: string, l: Record<string, unknown>) => ({ key, quantity: 1, ...l });

async function checkCart(tx: Tx, lines: object[]) {
  const rows = await anonCall<{ r: Record<string, unknown>[] }>(tx, (sp) => sp`select public.check_cart(${JSON.stringify(lines)}::text::jsonb) as r` as never);
  return rows[0]!.r as { key: string; state: string; quantity: number; menu_entry_id: string | null; unit_price_kes: number | null; plates_left: number | null }[];
}
const byKey = (rows: Awaited<ReturnType<typeof checkCart>>) => Object.fromEntries(rows.map((r) => [r.key, r]));

async function tomorrowEntry(tx: Tx, f: Fixtures, dish: string, plates: number | null = 30, price: number | null = null) {
  const [e] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day, show_from, show_until)
    values (${dish}, 'day', public.nairobi_today() + 1, public.nairobi_today() + 1, ${price}, ${plates}, '00:00', '23:59:59')
    returning *`;
  return e;
}

describe("customer_menu: the menu customers see", () => {
  test("open: today's menu, the same rows as todays_menu", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await today(tx);
      const rows = await anonCall<Record<string, unknown>>(tx, (sp) => sp`select * from public.customer_menu()` as never);
      const [view] = await tx`select count(*)::int as n from public.todays_menu`;
      expect(rows.length).toBe(view.n);
      expect(rows.every((r) => String(r.menu_day) === day || (r.menu_day as Date).toISOString?.().slice(0, 10) === day)).toBe(true);
      const open = rows.find((r) => r.entry_id === f.openEntry.id)!;
      expect([open.price_kes, open.plates_left, open.sold_out, open.open_now]).toEqual([450, 3, false, true]);
    }));

  test("closed: the next open day's menu, with fresh plate counts; today's day dishes are gone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.menu_entry_days (entry_id, day, plates_sold) values (${f.openEntry.id}, public.nairobi_today(), 3)`;
      await closeToday(tx);
      const next = await tomorrowEntry(tx, f, f.rotating.id, 30, 480);
      const rows = await anonCall<Record<string, unknown>>(tx, (sp) => sp`select * from public.customer_menu()` as never);
      const ids = rows.map((r) => r.entry_id);
      expect(ids).toContain(next.id);
      expect(ids).not.toContain(f.openEntry.id);
      const r = rows.find((x) => x.entry_id === next.id)!;
      expect([r.price_kes, r.plates_left, r.sold_out, r.open_now]).toEqual([480, 30, false, false]);
      const [{ d }] = await tx`select (public.nairobi_today() + 1)::text as d`;
      expect(String((r.menu_day as Date).toISOString?.().slice(0, 10) ?? r.menu_day)).toBe(d);
    }));

  test("hidden and unpublished entries never show", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.menu_entries set published = false where id = ${f.openEntry.id}`;
      const rows = await anonCall<Record<string, unknown>>(tx, (sp) => sp`select * from public.customer_menu()` as never);
      expect(rows.map((r) => r.entry_id)).not.toContain(f.openEntry.id);
    }));
});

describe("check_cart: each line against the menu customers see", () => {
  test("ok lines come back with the server's price", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.regular.id, quantity: 2 }),
        line("b", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id] }),
      ]));
      expect([r.a!.state, r.a!.quantity, r.a!.unit_price_kes]).toEqual(["ok", 2, 300]);
      expect([r.b!.state, r.b!.unit_price_kes, r.b!.plates_left]).toEqual(["ok", 500, 3]);
    }));

  test("fewer plates left than in the cart: lowered, and lines of the same dish share the plates", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.menu_entry_days (entry_id, day, plates_sold) values (${f.openEntry.id}, public.nairobi_today(), 1)`;
      const r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }),
        line("b", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id], quantity: 2 }),
      ]));
      expect([r.a!.state, r.a!.quantity]).toEqual(["ok", 1]);
      expect([r.b!.state, r.b!.quantity, r.b!.plates_left]).toEqual(["capped", 1, 2]);
    }));

  test("more than 20 on a line: lowered to 20 and marked capped, not ok (RQA28-08)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.regular.id, quantity: 25 }),
        line("b", { dish_id: f.regular.id, quantity: 20 }),
        line("c", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 25 }),
      ]));
      expect([r.a!.state, r.a!.quantity]).toEqual(["capped", 20]);
      expect([r.b!.state, r.b!.quantity]).toEqual(["ok", 20]);
      // A plate limit below 20 still caps to the plates left.
      expect([r.c!.state, r.c!.quantity, r.c!.plates_left]).toEqual(["capped", 3, 3]);
    }));

  test("sold out: no plates left, sold out by hand, or a regular off for today", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.menu_entry_days (entry_id, day, plates_sold) values (${f.openEntry.id}, public.nairobi_today(), 3)`;
      await tx`update public.dishes set unavailable_on = public.nairobi_today() where id = ${f.regular.id}`;
      let r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id }),
        line("b", { dish_id: f.regular.id }),
      ]));
      expect([r.a!.state, r.a!.quantity, r.b!.state]).toEqual(["sold_out", 0, "sold_out"]);
      await tx`update public.menu_entry_days set plates_sold = 0, sold_out_manual = true where entry_id = ${f.openEntry.id}`;
      r = byKey(await checkCart(tx, [line("a", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id })]));
      expect(r.a!.state).toBe("sold_out");
    }));

  test("outside its serving hours while open: not_now; gone from the menu or archived: not_on_menu", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [gone] = await tx`insert into public.dishes (name, price_kes, is_regular, archived, updated_at) values ('Gone', 200, true, true, '2020-01-01') returning *`;
      const r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.late.id, menu_entry_id: f.closedEntry.id }),
        line("b", { dish_id: gone.id }),
        line("c", { dish_id: f.rotating.id, menu_entry_id: crypto.randomUUID() }),
      ]));
      expect([r.a!.state, r.b!.state, r.c!.state]).toEqual(["not_now", "not_on_menu", "not_on_menu"]);
    }));

  test("closed: checked against the next open day; the same dish under that day's entry is fine, at that day's price", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.dishes set unavailable_on = public.nairobi_today() where id = ${f.regular.id}`;
      await closeToday(tx);
      const next = await tomorrowEntry(tx, f, f.rotating.id, 30, 480);
      const r = byKey(await checkCart(tx, [
        line("a", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }),
        line("b", { dish_id: f.late.id, menu_entry_id: f.closedEntry.id }),
        line("c", { dish_id: f.regular.id }),
      ]));
      expect([r.a!.state, r.a!.menu_entry_id, r.a!.unit_price_kes, r.a!.plates_left]).toEqual(["ok", next.id, 480, 30]);
      expect(r.b!.state).toBe("not_on_menu");
      // Off for today only: tomorrow it is back on.
      expect(r.c!.state).toBe("ok");
    }));

  test("a choice or extra out today: option_out (open); an archived choice: option_out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.dish_options set out_on = public.nairobi_today() where id = ${f.option.id}`;
      const r = byKey(await checkCart(tx, [line("a", { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id] })]));
      expect(r.a!.state).toBe("option_out");
    }));

  test("refuses a bad payload", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const bad = (p: string) => anonCall(tx, (sp) => sp`select public.check_cart(${p}::text::jsonb)` as never).then(() => "ok", (e) => e.errno ?? e.code);
      expect(await bad('{"a":1}')).toBe("P0001");
      expect(await bad(JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ key: String(i), dish_id: crypto.randomUUID(), quantity: 1 }))))).toBe("P0001");
      expect(await bad(JSON.stringify([{ key: "a", dish_id: "nope", quantity: 1 }]))).toBe("P0001");
    }));
});

describe("place_order: detail codes the checkout can act on", () => {
  const detail = (e: unknown) => (e as { detail?: string }).detail;

  test("over_plates when some are left, sold_out when none are, not_on_menu when it's gone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const item = (q: number) => [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: q }];
      expect(detail(await placeOrder(tx, dineIn(f, item(4))).catch((e) => e))).toBe("over_plates");
      await placeOrder(tx, dineIn(f, item(3)));
      expect(detail(await placeOrder(tx, dineIn(f, item(1))).catch((e) => e))).toBe("sold_out");
      expect(detail(await placeOrder(tx, dineIn(f, [{ dish_id: f.late.id, menu_entry_id: f.closedEntry.id, quantity: 1 }])).catch((e) => e))).toBe("not_on_menu");
      await tx`update public.dishes set unavailable_on = public.nairobi_today() where id = ${f.regular.id}`;
      expect(detail(await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }])).catch((e) => e))).toBe("sold_out");
    }));
});

async function zone(tx: Tx) {
  const [z] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Test zone', 150, 0) returning *`;
  return z;
}
async function status(tx: Tx, token: string) {
  const rows = await anonCall<{ s: Record<string, unknown> }>(tx, (sp) => sp`select public.get_order_status(${token}::uuid) as s` as never);
  return rows[0]!.s;
}

describe("get_order_status: where the order goes", () => {
  test("delivery shows the customer's address and notes; pickup and dine-in show the kitchen's address and directions", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx);
      await tx`update public.kitchen_settings set address = 'Argwings Kodhek Rd, Kilimani', maps_url = 'https://maps.example/dausis'`;
      const items = [{ dish_id: f.regular.id, quantity: 1, note: "No onions" }];
      const d = await placeOrder(tx, dineIn(f, items, { mode: "delivery", table_token: null, delivery_zone_id: z.id, delivery_address: "Hse 12, Rose Ave", delivery_notes: "Blue gate" }));
      const s = await status(tx, d.public_token);
      expect([s.delivery_address, s.delivery_notes, s.kitchen_address, s.maps_url]).toEqual(["Hse 12, Rose Ave", "Blue gate", null, null]);
      expect((s.items as { note: string }[])[0]!.note).toBe("No onions");
      const p = await placeOrder(tx, dineIn(f, items, { mode: "pickup", table_token: null }));
      const ps = await status(tx, p.public_token);
      expect([ps.delivery_address, ps.kitchen_address, ps.maps_url]).toEqual([null, "Argwings Kodhek Rd, Kilimani", "https://maps.example/dausis"]);
    }));

  test("the address and directions can only be set by the owner, and the link must be https", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const call = (role: "anon" | "authenticated", sub: string | null, a: string, m: string) =>
        attempt(tx, role, sub, (sp) => sp`select public.set_kitchen_address(${a}, ${m})`).then(() => "ok", (e) => e.errno ?? e.code);
      expect(await call("anon", null, "Somewhere", "")).toBe("42501");
      expect(await call("authenticated", f.ownerId, "Argwings Kodhek Rd", "http://maps.example")).toBe("P0001");
      expect(await call("authenticated", f.ownerId, "Argwings Kodhek Rd", "https://maps.example/x")).toBe("ok");
      expect(await call("authenticated", f.ownerId, "  ", "")).toBe("ok");
      const [k] = await tx`select address, maps_url from public.kitchen_settings`;
      expect([k.address, k.maps_url]).toEqual([null, null]);
    }));

  test("kitchen_place: anyone can read the address, directions and phone, and nothing else", () =>
    inTx(async (tx) => {
      await tx`update public.kitchen_settings set address = 'Argwings Kodhek Rd', maps_url = 'https://maps.example/d', phone = '+254712345678', till_number = '123456'`;
      const rows = await anonCall<{ p: Record<string, unknown> }>(tx, (sp) => sp`select public.kitchen_place() as p` as never);
      expect(rows[0]!.p).toEqual({ address: "Argwings Kodhek Rd", maps_url: "https://maps.example/d", phone: "+254712345678" });
    }));
});

describe("find_order: lookup by phone and order code", () => {
  async function order(tx: Tx, f: Fixtures, phone = "0712345678") {
    return placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { customer_phone: phone }));
  }
  const find = (tx: Tx, phone: string, code: string) =>
    anonCall<{ t: string | null }>(tx, (sp) => sp`select public.find_order(${phone}, ${code}) as t` as never).then((r) => r[0]!.t, (e) => `err:${e.detail ?? e.errno}`);

  test("the phone in any usual form and the code with or without DP- find it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f, "0712 345 678");
      const n = String(Number(o.code.replace(/\D/g, "")));
      for (const [phone, code] of [["0712345678", o.code], ["+254712345678", o.code.toLowerCase()], ["254 712 345 678", n], ["712345678", ` ${n} `]] as const)
        expect(await find(tx, phone, code)).toBe(o.public_token);
    }));

  test("a wrong phone or code finds nothing; after 5 wrong tries that phone waits 15 minutes", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      expect(await find(tx, "0799999999", o.code)).toBeNull();
      for (let i = 0; i < 5; i++) expect(await find(tx, "0712345678", "DP-9999")).toBeNull();
      expect(await find(tx, "0712345678", o.code)).toBe("err:lookup_paused");
      // Another phone is not paused.
      expect(await find(tx, "0799999999", "DP-9999")).toBeNull();
      // After 15 minutes it works again.
      await tx`update public.lookup_attempts set at = at - interval '16 minutes'`;
      expect(await find(tx, "+254712345678", o.code)).toBe(o.public_token);
    }));

  test("only orders from the last 7 days", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      await tx`select set_config('session_replication_role', 'replica', true)`;
      await tx`update public.orders set created_at = now() - interval '8 days' where public_token = ${o.public_token}`;
      await tx`select set_config('session_replication_role', 'origin', true)`;
      expect(await find(tx, "0712345678", o.code)).toBeNull();
      const [{ d }] = await tx`select public.order_lookup_days() as d`;
      expect(d).toBe(7);
    }));

  test("the tries table is closed to customers and staff", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const e1 = await attempt(tx, "anon", null, (sp) => sp`select * from public.lookup_attempts`).catch((e) => e.errno);
      const e2 = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select * from public.lookup_attempts`).catch((e) => e.errno);
      expect([e1, e2]).toEqual(["42501", "42501"]);
    }));
});
