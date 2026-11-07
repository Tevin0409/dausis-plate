// Payments at launch (slice 2.1, spec-2.1-payments.md): place_order takes only on_handover,
// or at_counter for dine-in, and stores both as unpaid; dashboard_stats splits the day's
// total into paid and not paid. Each test failed on the schema before these migrations, except
// the mpesa replay, which guards behaviour that already held (a retry gets its order back).
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

const regularLine = (f: Fixtures) => [{ dish_id: f.regular.id, quantity: 1 }];

async function orderCount(tx: TransactionSQL) {
  const [row] = await tx`select count(*)::int as n from public.orders`;
  return row.n as number;
}

async function zone(tx: TransactionSQL) {
  const [z] = await tx`insert into public.delivery_zones (name, fee_kes) values ('Test zone', 150) returning *`;
  return z as { id: string; fee_kes: number };
}

const pickup = (f: Fixtures, payment_method: string) => ({
  ...dineIn(f, regularLine(f), { payment_method }),
  mode: "pickup",
  table_token: undefined,
});
const delivery = (f: Fixtures, zoneId: string, payment_method: string) => ({
  ...dineIn(f, regularLine(f), { payment_method }),
  mode: "delivery",
  table_token: undefined,
  delivery_zone_id: zoneId,
  delivery_address: "Test street 1",
});

async function stored(tx: TransactionSQL, token: string) {
  const [row] = await tx`select mode, payment_method, payment_status from public.orders where public_token = ${token}`;
  return row;
}

describe("place_order: payments at launch", () => {
  test("stores each kind of order with its way to pay, unpaid", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx);
      const cases = [
        [dineIn(f, regularLine(f), { payment_method: "at_counter" }), "dine_in", "at_counter"],
        [dineIn(f, regularLine(f), { payment_method: "on_handover" }), "dine_in", "on_handover"],
        [pickup(f, "on_handover"), "pickup", "on_handover"],
        [delivery(f, z.id, "on_handover"), "delivery", "on_handover"],
      ] as const;
      for (const [payload, mode, method] of cases) {
        const placed = await placeOrder(tx, payload);
        expect(await stored(tx, placed.public_token)).toEqual({ mode, payment_method: method, payment_status: "unpaid" });
      }
    }));

  for (const method of ["mpesa", "card", "bitcoin", ""]) {
    test(`refuses payment_method ${JSON.stringify(method)} and places nothing`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const before = await orderCount(tx);
        await expect(placeOrder(tx, dineIn(f, regularLine(f), { payment_method: method }))).rejects.toThrow("Choose how you’ll pay");
        expect(await orderCount(tx)).toBe(before);
      }));
  }

  test("refuses an order with no payment_method", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const payload: Record<string, unknown> = dineIn(f, regularLine(f));
      delete payload.payment_method;
      await expect(placeOrder(tx, payload)).rejects.toThrow("Choose how you’ll pay");
    }));

  test("refuses at_counter for pickup and delivery, and places nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx);
      const before = await orderCount(tx);
      for (const payload of [pickup(f, "at_counter"), delivery(f, z.id, "at_counter")]) {
        await expect(placeOrder(tx, payload)).rejects.toThrow("Pay at the counter is for orders at a table");
      }
      expect(await orderCount(tx)).toBe(before);
    }));

  test("the refusal is a customer message (P0001), not a type error", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const err = await placeOrder(tx, dineIn(f, regularLine(f), { payment_method: "mpesa" })).catch((e) => e);
      expect(err.errno ?? err.code).toBe("P0001");
    }));

  test("a retry of an older mpesa order still gets that order back", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const key = crypto.randomUUID();
      const [old] = await tx`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, payment_status, subtotal_kes, total_kes, idempotency_key)
        values ('dine_in', ${f.table.id}, 'Old', '0712345678', 'mpesa', 'pending', 300, 300, ${key}::uuid) returning public_token`;
      const replay = await placeOrder(tx, dineIn(f, regularLine(f), { payment_method: "mpesa", idempotency_key: key }));
      expect(replay).toMatchObject({ public_token: old.public_token, replayed: true });
    }));
});

describe("dashboard_stats: paid and not paid", () => {
  const stats = async (tx: TransactionSQL, f: Fixtures) => {
    const [row] = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.dashboard_stats(public.nairobi_today()) as s`);
    return row!.s as Record<string, unknown> & { revenue_kes: number; paid_kes: number; unpaid_kes: number };
  };
  const place = async (tx: TransactionSQL, payload: object) => {
    const placed = await placeOrder(tx, payload);
    const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
    return row.id as string;
  };

  test("paid and not paid add up to the total ordered, and cancelled orders stay out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const before = await stats(tx, f);
      expect(before.paid_kes + before.unpaid_kes).toBe(before.revenue_kes);
      expect(before).not.toHaveProperty("paid_online");

      const paid = await place(tx, dineIn(f, regularLine(f), { payment_method: "at_counter" })); // 300
      await place(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 2 }])); // 600, on handover
      const cancelled = await place(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 3 }])); // 900, cancelled
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.mark_order_paid(${paid}::uuid)`);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.cancel_order(${cancelled}::uuid, 'new'::public.order_status)`);

      const after = await stats(tx, f);
      expect(after.revenue_kes - before.revenue_kes).toBe(900);
      expect(after.paid_kes - before.paid_kes).toBe(300);
      expect(after.unpaid_kes - before.unpaid_kes).toBe(600);
      expect(after.paid_kes + after.unpaid_kes).toBe(after.revenue_kes);
    }));

  test("an older pending or failed order counts as not paid", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const before = await stats(tx, f);
      await tx`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, payment_status, subtotal_kes, total_kes)
        values ('dine_in', ${f.table.id}, 'Old', '0712345678', 'mpesa', 'pending', 400, 400),
               ('dine_in', ${f.table.id}, 'Old', '0712345678', 'card', 'failed', 500, 500)`;
      const after = await stats(tx, f);
      expect(after.unpaid_kes - before.unpaid_kes).toBe(900);
      expect(after.paid_kes).toBe(before.paid_kes);
    }));
});
