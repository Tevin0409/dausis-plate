// Order safety (slice 0.2): place_order input checks, idempotency, order codes
// and the order lifecycle. Each test failed on the schema before these migrations.
import { afterAll, describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, platesSold, seedFixtures, sql, type Fixtures } from "./helpers";

const regularLine = (f: Fixtures) => [{ dish_id: f.regular.id, quantity: 1 }];
const rotatingLine = (f: Fixtures, quantity: number) => [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity }];

async function orderCount(tx: TransactionSQL) {
  const [row] = await tx`select count(*)::int as n from public.orders`;
  return row.n as number;
}

async function statusOf(tx: TransactionSQL, id: string) {
  const [row] = await tx`select status from public.orders where id = ${id}`;
  return row.status as string;
}

/** Places an order and returns its id. */
async function newOrder(tx: TransactionSQL, f: Fixtures, items: object[] = regularLine(f)) {
  const placed = await placeOrder(tx, dineIn(f, items as never));
  const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
  return row.id as string;
}

const advance = (tx: TransactionSQL, f: Fixtures, id: string, from: string, to: string) =>
  attempt(tx, "authenticated", f.ownerId, (sp) =>
    sp`select public.advance_order(${id}::uuid, ${from}::public.order_status, ${to}::public.order_status)`);
/** A Decline; `from` is the status the tap saw, which defaults to the order's current one. */
const cancel = async (tx: TransactionSQL, f: Fixtures, id: string, from?: string) => {
  const seen = from ?? (await statusOf(tx, id));
  return attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.cancel_order(${id}::uuid, ${seen}::public.order_status)`);
};
const markPaid = (tx: TransactionSQL, f: Fixtures, id: string) =>
  attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.mark_order_paid(${id}::uuid)`);

const FORWARD = [
  ["new", "preparing"],
  ["preparing", "ready"],
  ["ready", "completed"],
] as const;

/** Places an order and walks it forward to `status`, through the staff RPCs. */
async function orderAt(tx: TransactionSQL, f: Fixtures, status: "new" | "preparing" | "ready" | "completed" | "cancelled") {
  const id = await newOrder(tx, f);
  if (status === "cancelled") {
    await cancel(tx, f, id);
    return id;
  }
  for (const [from, to] of FORWARD) {
    if (from === status) break;
    await advance(tx, f, id, from, to);
  }
  return id;
}

describe("place_order: an empty order", () => {
  for (const [label, items] of [
    ["a missing items key", undefined],
    ["items: null", null],
    ["items: {}", {}],
    ["items: []", []],
  ] as const) {
    test(`rejects ${label} and creates no order`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const before = await orderCount(tx);
        const payload: Record<string, unknown> = dineIn(f, []);
        if (items === undefined) delete payload.items;
        else payload.items = items;
        await expect(placeOrder(tx, payload)).rejects.toThrow("Your order is empty");
        expect(await orderCount(tx)).toBe(before);
      }));
  }
});

describe("place_order: idempotency", () => {
  test("a retry with the same key returns the same order and charges plates once", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const before = await orderCount(tx);
      const payload = dineIn(f, rotatingLine(f, 2));
      const first = await placeOrder(tx, payload);
      const retry = await placeOrder(tx, payload);
      expect(first.replayed).toBe(false);
      expect(retry).toEqual({ ...first, replayed: true });
      expect(await orderCount(tx)).toBe(before + 1);
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);
    }));

  test("a retry still returns the order when the plates have since sold out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const payload = dineIn(f, rotatingLine(f, 3));
      const first = await placeOrder(tx, payload);
      const retry = await placeOrder(tx, payload);
      expect(retry.public_token).toBe(first.public_token);
      expect(await platesSold(tx, f.openEntry.id)).toBe(3);
    }));

  test("different keys place separate orders", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await placeOrder(tx, dineIn(f, regularLine(f)));
      const b = await placeOrder(tx, dineIn(f, regularLine(f)));
      expect(a.public_token).not.toBe(b.public_token);
      expect(a.code).not.toBe(b.code);
    }));

  for (const [label, key] of [
    ["missing", undefined],
    ["empty", ""],
    ["malformed", "not-a-uuid"],
  ] as const) {
    test(`rejects a ${label} key`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const before = await orderCount(tx);
        await expect(placeOrder(tx, dineIn(f, regularLine(f), { idempotency_key: key }))).rejects.toThrow(
          "Refresh the page and try again",
        );
        expect(await orderCount(tx)).toBe(before);
      }));
  }

  test("the unique constraint backs the key", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const payload = dineIn(f, regularLine(f));
      await placeOrder(tx, payload);
      const insertSameKey = tx.savepoint((sp) => sp`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, subtotal_kes, total_kes, idempotency_key)
        values ('dine_in', ${f.table.id}, 'Copy', '0712345678', 'on_handover', 0, 0, ${payload.idempotency_key as string}::uuid)`);
      await expect(insertSameKey).rejects.toThrow("duplicate key");
    }));

  describe("two calls at once on separate connections", () => {
    let dishId: string | undefined;
    afterAll(async () => {
      if (!dishId) return;
      await sql`delete from public.order_items where dish_id = ${dishId}`;
      await sql`delete from public.orders where customer_name = 'Concurrent test'`;
      await sql`delete from public.menu_entry_days where entry_id in (select id from public.menu_entries where dish_id = ${dishId})`;
      await sql`delete from public.menu_entries where dish_id = ${dishId}`;
      await sql`delete from public.dishes where id = ${dishId}`;
    });

    test("place one order and charge plates once", async () => {
      const [dish] = await sql`insert into public.dishes (name, price_kes) values ('Concurrent dish', 500) returning id`;
      dishId = dish.id;
      const [entry] = await sql`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
        values (${dish.id}, 'day', public.nairobi_today(), public.nairobi_today(), 10, '00:00', '23:59:59') returning id`;
      const payload = JSON.stringify({
        mode: "pickup",
        customer_name: "Concurrent test",
        customer_phone: "0712345678",
        payment_method: "on_handover",
        idempotency_key: crypto.randomUUID(),
        items: [{ dish_id: dish.id, menu_entry_id: entry.id, quantity: 2 }],
      });
      const call = () => sql`select * from public.place_order(${payload}::text::jsonb)`;
      const results = await Promise.all([call(), call(), call()]);

      expect(new Set(results.map(([r]) => r.public_token)).size).toBe(1);
      expect(results.filter(([r]) => r.replayed).length).toBe(2);
      const [count] = await sql`select count(*)::int as n from public.orders where customer_name = 'Concurrent test'`;
      expect(count.n).toBe(1);
      const [day] = await sql`select plates_sold from public.menu_entry_days where entry_id = ${entry.id}`;
      expect(day.plates_sold).toBe(2);
    });
  });
});

describe("place_order: pickup time", () => {
  const pickup = (f: Fixtures, pickupAt: string | null) => {
    const { table_token: _unused, ...rest } = dineIn(f, regularLine(f), { mode: "pickup", pickup_at: pickupAt });
    return rest;
  };
  const minutesFromNow = (m: number) => new Date(Date.now() + m * 60000).toISOString();

  test("rejects a time that has passed", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const before = await orderCount(tx);
      await expect(placeOrder(tx, pickup(f, minutesFromNow(-5)))).rejects.toThrow(
        "That pickup time has passed. Pick a later time.",
      );
      expect(await orderCount(tx)).toBe(before);
    }));

  test("accepts a later time, and no time for as soon as it's ready", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const later = minutesFromNow(30);
      const a = await placeOrder(tx, pickup(f, later));
      const b = await placeOrder(tx, pickup(f, null));
      const [ra] = await tx`select pickup_at from public.orders where public_token = ${a.public_token}`;
      const [rb] = await tx`select pickup_at from public.orders where public_token = ${b.public_token}`;
      expect(new Date(ra.pickup_at).toISOString()).toBe(later);
      expect(rb.pickup_at).toBeNull();
    }));
});

describe("order codes", () => {
  test("keep their format below 10,000 and don't truncate or collide from there", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const codes: string[] = [];
      for (const n of [100, 1000, 9999, 10000, 10001, 100000]) {
        const [row] = await tx`
          insert into public.orders (number, mode, table_id, customer_name, customer_phone, payment_method, subtotal_kes, total_kes)
          overriding system value
          values (${n}, 'dine_in', ${f.table.id}, 'Code test', '0712345678', 'on_handover', 0, 0)
          returning code`;
        codes.push(row.code);
      }
      expect(codes).toEqual(["DP-0100", "DP-1000", "DP-9999", "DP-10000", "DP-10001", "DP-100000"]);
    }));
});

describe("order lifecycle", () => {
  test("every allowed forward move works", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      for (const [from, to] of FORWARD) {
        await advance(tx, f, id, from, to);
        expect(await statusOf(tx, id)).toBe(to);
      }
    }));

  for (const from of ["new", "preparing", "ready"] as const) {
    test(`cancel works from ${from}`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const id = await orderAt(tx, f, from);
        await cancel(tx, f, id);
        expect(await statusOf(tx, id)).toBe("cancelled");
      }));
  }

  for (const [from, to] of [
    ["new", "ready"],
    ["new", "completed"],
    ["preparing", "new"],
    ["preparing", "completed"],
    ["ready", "preparing"],
    ["completed", "ready"],
    ["completed", "cancelled"],
    ["cancelled", "new"],
    ["cancelled", "preparing"],
  ] as const) {
    test(`${from} to ${to} is refused, even for a direct write by a privileged role`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const id = await orderAt(tx, f, from);
        await expect(
          tx.savepoint((sp) => sp`update public.orders set status = ${to}::public.order_status where id = ${id}`),
        ).rejects.toThrow(`Order can't move from ${from} to ${to}`);
        if (to !== "cancelled") await expect(advance(tx, f, id, from, to)).rejects.toThrow(`Order can't move from ${from} to ${to}`);
        expect(await statusOf(tx, id)).toBe(from);
      }));
  }

  test("advance_order can't be used to cancel", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      await expect(advance(tx, f, id, "new", "cancelled")).rejects.toThrow("Order can't move from new to cancelled");
      expect(await statusOf(tx, id)).toBe("new");
    }));

  test("a stale tap is refused and changes nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      await advance(tx, f, id, "new", "preparing");
      await expect(advance(tx, f, id, "new", "preparing")).rejects.toThrow("Someone else already moved this order");
      expect(await statusOf(tx, id)).toBe("preparing");
    }));

  for (const now of ["preparing", "ready"] as const) {
    test(`a stale Decline is refused when the order has moved on to ${now}, and keeps its plates`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const id = await newOrder(tx, f, rotatingLine(f, 2));
        for (const [from, to] of FORWARD) {
          if (from === now) break;
          await advance(tx, f, id, from, to);
        }
        await expect(cancel(tx, f, id, "new")).rejects.toThrow("Someone else already moved this order");
        expect(await statusOf(tx, id)).toBe(now);
        expect(await platesSold(tx, f.openEntry.id)).toBe(2);
      }));
  }

  test("a stale Decline on an order that has since finished or been cancelled is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await expect(cancel(tx, f, await orderAt(tx, f, "completed"), "new")).rejects.toThrow("This order is already completed");
      await expect(cancel(tx, f, await orderAt(tx, f, "cancelled"), "new")).rejects.toThrow("This order is already cancelled");
    }));

  test("cancelling a final order is refused with a clear message", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await expect(cancel(tx, f, await orderAt(tx, f, "completed"))).rejects.toThrow("This order is already completed");
      await expect(cancel(tx, f, await orderAt(tx, f, "cancelled"))).rejects.toThrow("This order is already cancelled");
    }));

  test("plates are released once: the cancel, reopen, cancel double release is impossible", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const first = await newOrder(tx, f, rotatingLine(f, 1));
      await newOrder(tx, f, rotatingLine(f, 2));
      expect(await platesSold(tx, f.openEntry.id)).toBe(3);

      await cancel(tx, f, first);
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);

      await expect(cancel(tx, f, first)).rejects.toThrow("This order is already cancelled");
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);

      await expect(
        tx.savepoint((sp) => sp`update public.orders set status = 'new' where id = ${first}`),
      ).rejects.toThrow("Order can't move from cancelled to new");
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);
    }));
});

describe("mark paid", () => {
  for (const status of ["new", "preparing", "ready", "completed", "cancelled"] as const) {
    test(`works on ${status} and leaves the status alone`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const id = await orderAt(tx, f, status);
        await markPaid(tx, f, id);
        const [row] = await tx`select status, payment_status from public.orders where id = ${id}`;
        expect(row).toEqual({ status, payment_status: "paid" });
      }));
  }
});

describe("who can write orders", () => {
  test("the staff read policies apply to signed-in users only", async () => {
    const rows = await sql`
      select policyname, roles::text[] as roles, cmd from pg_policies
      where schemaname = 'public' and tablename in ('orders', 'order_items') order by policyname`;
    expect(rows.map((r: { policyname: string; roles: string[]; cmd: string }) => [r.policyname, [...r.roles], r.cmd])).toEqual([
      ["order_items_staff", ["authenticated"], "SELECT"],
      ["orders_staff", ["authenticated"], "SELECT"],
    ]);
  });

  test("staff can still read orders and their items", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      const rows = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select id from public.orders where id = ${id}`);
      expect(rows.length).toBe(1);
      const items = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select id from public.order_items where order_id = ${id}`);
      expect(items.length).toBe(1);
    }));

  test("staff can't insert orders, edit their fields or delete items directly", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      const asStaff = (fn: Parameters<typeof attempt>[3]) => attempt(tx, "authenticated", f.ownerId, fn);

      await expect(asStaff((sp) => sp`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, subtotal_kes, total_kes)
        values ('dine_in', ${f.table.id}, 'Direct', '0712345678', 'on_handover', 0, 0)`)).rejects.toThrow("permission denied");
      await expect(asStaff((sp) => sp`update public.orders set total_kes = 1 where id = ${id}`)).rejects.toThrow("permission denied");
      await expect(asStaff((sp) => sp`update public.orders set status = 'preparing' where id = ${id}`)).rejects.toThrow("permission denied");
      await expect(asStaff((sp) => sp`delete from public.orders where id = ${id}`)).rejects.toThrow("permission denied");
      await expect(asStaff((sp) => sp`delete from public.order_items where order_id = ${id}`)).rejects.toThrow("permission denied");
      await expect(asStaff((sp) => sp`update public.order_items set quantity = 9 where order_id = ${id}`)).rejects.toThrow("permission denied");
    }));

  for (const name of ["advance_order", "cancel_order", "mark_order_paid"] as const) {
    test(`${name} is closed to customers and to signed-in non-staff`, () =>
      inTx(async (tx) => {
        const f = await seedFixtures(tx);
        const id = await newOrder(tx, f);
        const call = (sp: Parameters<Parameters<typeof attempt>[3]>[0]) =>
          name === "advance_order"
            ? sp`select public.advance_order(${id}::uuid, 'new'::public.order_status, 'preparing'::public.order_status)`
            : name === "cancel_order"
              ? sp`select public.cancel_order(${id}::uuid, 'new'::public.order_status)`
              : sp`select public.mark_order_paid(${id}::uuid)`;
        await expect(attempt(tx, "anon", null, call)).rejects.toThrow("permission denied");
        await expect(attempt(tx, "authenticated", crypto.randomUUID(), call)).rejects.toThrow("Not allowed");
        const [row] = await tx`select status, payment_status from public.orders where id = ${id}`;
        expect(row).toEqual({ status: "new", payment_status: "unpaid" });
      }));
  }

  test("the payment callback's service role can still record a payment", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await newOrder(tx, f);
      await tx.savepoint(async (sp) => {
        await sp`select set_config('role', 'service_role', true)`;
        await sp`update public.orders set payment_status = 'paid', mpesa_receipt = 'ABC123' where id = ${id}`;
        await sp`select set_config('role', 'postgres', true)`;
      });
      const [row] = await tx`select payment_status, mpesa_receipt from public.orders where id = ${id}`;
      expect(row).toEqual({ payment_status: "paid", mpesa_receipt: "ABC123" });
    }));
});
