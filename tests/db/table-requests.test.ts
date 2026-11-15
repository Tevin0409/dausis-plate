// Slice 2.9: table requests (spec-2.9-table-requests.md, "Done means" 1, 3–6, 6a).
// now() is fixed for a transaction, so "earlier day" and "10 s later" are tested by back-dating.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Req = { asked_at: string; answered_at: string | null; by_this_order: boolean } | null;
type BillOrder = { id: string; code: string; customer_name: string; paid: boolean; asked: boolean; total_kes: number };
type Open = { id: string; kind: "waiter" | "bill"; table_label: string; order_id: string | null; orders: BillOrder[] | null; unpaid_kes: number | null };

const call = (tx: Tx, who: string | null, fn: (q: Tx) => PromiseLike<unknown>) =>
  attempt(tx, who ? "authenticated" : "anon", who, fn as never);

const ms = (t: string | Date) => new Date(t).getTime();
/** paid_with of each order, in the order given. */
async function methods(tx: Tx, ids: string[]) {
  const rows = (await tx`select id, paid_with from public.orders where id in ${tx(ids)}`) as { id: string; paid_with: string | null }[];
  return ids.map((id) => rows.find((r) => r.id === id)!.paid_with);
}
const pgArray = (ids: string[]) => `{${ids.join(",")}}`;

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { errno?: string; code?: string; message: string };
    return { code: err.errno ?? err.code, message: err.message };
  }
}

async function staffMember(tx: Tx, email = "otieno@test.local") {
  const [u] = await tx`insert into auth.users (email) values (${email}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Otieno')`;
  return u.id as string;
}

async function order(tx: Tx, f: Fixtures, name = "Amina", extra: Record<string, unknown> = {}) {
  const placed = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { customer_name: name, ...extra }));
  const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
  return { id: row.id as string, token: placed.public_token, code: placed.code };
}

const ask = async (tx: Tx, token: string, kind: "waiter" | "bill") => {
  const [r] = (await call(tx, null, (q) => q`select * from public.request_table_help(${token}::uuid, ${kind}::public.table_request_kind)`)) as {
    asked_at: string; created: boolean;
  }[];
  return r!;
};
const askFromMenu = async (tx: Tx, qr: string) => {
  const [r] = (await call(tx, null, (q) => q`select * from public.request_waiter_at_table(${qr})`)) as { asked_at: string; created: boolean }[];
  return r!;
};
const board = async (tx: Tx, who: string) => {
  const [r] = (await call(tx, who, (q) => q`select public.open_table_requests() as r`)) as { r: Open[] }[];
  return r!.r;
};
const done = async (tx: Tx, who: string, id: string) => {
  const [r] = (await call(tx, who, (q) => q`select public.clear_table_request(${id}::uuid) as ok`)) as { ok: boolean }[];
  return r!.ok;
};
const undoDone = (tx: Tx, who: string, id: string) => call(tx, who, (q) => q`select public.undo_clear_table_request(${id}::uuid)`);
async function customerSees(tx: Tx, token: string) {
  const [r] = (await call(tx, null, (q) => q`select public.get_order_status(${token}::uuid) as s`)) as {
    s: { requests: { waiter: Req; bill: Req } | null; placed_today: boolean };
  }[];
  return r!.s;
}

/** Moves an order's placing, and its requests, to yesterday (Nairobi), without firing triggers. */
async function toYesterday(tx: Tx, orderId: string) {
  await tx`select set_config('session_replication_role', 'replica', true)`;
  await tx`update public.orders set created_at = created_at - interval '1 day' where id = ${orderId}`;
  await tx`update public.table_requests set created_at = created_at - interval '1 day' where order_id = ${orderId}`;
  await tx`select set_config('session_replication_role', 'origin', true)`;
}
async function ageClear(tx: Tx, id: string, seconds: number) {
  await tx`update public.table_requests set cleared_at = now() - make_interval(secs => ${seconds}) where id = ${id}`;
}

describe("asking (Done means 1, 6)", () => {
  test("Call waiter and Request bill go Sent → Answered on the customer's page, and another phone sees the table's request", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      expect((await customerSees(tx, a.token)).requests).toEqual({ waiter: null, bill: null });

      const w = await ask(tx, a.token, "waiter");
      expect(w.created).toBe(true);
      await ask(tx, a.token, "bill");
      const mine = (await customerSees(tx, a.token)).requests!;
      expect([mine.waiter!.by_this_order, mine.waiter!.answered_at, mine.bill!.by_this_order]).toEqual([true, null, true]);
      // Another phone with an order at the same table: "Someone at your table asked at …".
      const theirs = (await customerSees(tx, b.token)).requests!;
      expect([theirs.waiter!.by_this_order, theirs.waiter!.asked_at]).toEqual([false, mine.waiter!.asked_at]);

      const o = f.ownerId;
      const waiter = (await board(tx, o)).find((r) => r.kind === "waiter")!;
      expect(await done(tx, o, waiter.id)).toBe(true);
      expect((await customerSees(tx, a.token)).requests!.waiter!.answered_at).not.toBeNull();
      // A tap after Answered asks again.
      expect((await ask(tx, a.token, "waiter")).created).toBe(true);
      expect((await customerSees(tx, a.token)).requests!.waiter!.answered_at).toBeNull();
    }));

  test("two quick taps (from two phones) make one row; the second is told it's already asked", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const first = await ask(tx, a.token, "waiter");
      const second = await ask(tx, b.token, "waiter");
      const again = await ask(tx, a.token, "waiter");
      expect([first.created, second.created, again.created]).toEqual([true, false, false]);
      expect(second.asked_at).toEqual(first.asked_at);
      const [{ n }] = await tx`select count(*)::int as n from public.table_requests where table_id = ${f.table.id} and kind = 'waiter'`;
      expect(n).toBe(1);
    }));

  test("the database itself refuses a second open request of a kind at a table", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.table_requests (table_id, kind) values (${f.table.id}, 'bill')`;
      const err = await refusal(tx.savepoint((sp) => sp`insert into public.table_requests (table_id, kind) values (${f.table.id}, 'bill')`));
      expect(err?.code).toBe("23505");
    }));

  test("the 11th request from an order today is refused; asking for one already open doesn't count", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f);
      const o = f.ownerId;
      for (let i = 0; i < 10; i++) {
        await ask(tx, a.token, "waiter");
        await ask(tx, a.token, "waiter"); // already open: no new row, no count
        const r = (await board(tx, o)).find((x) => x.kind === "waiter")!;
        await done(tx, o, r.id);
      }
      expect(await refusal(ask(tx, a.token, "waiter"))).toEqual({ code: "P0001", message: "request_limit" });
      expect(await refusal(ask(tx, a.token, "bill"))).toEqual({ code: "P0001", message: "request_limit" });
    }));

  test("earlier-day, cancelled and declined orders can't ask; pickup can't either", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const old = await order(tx, f);
      await toYesterday(tx, old.id);
      expect(await refusal(ask(tx, old.token, "bill"))).toEqual({ code: "P0001", message: "request_not_today" });
      expect((await customerSees(tx, old.token)).placed_today).toBe(false);

      const declined = await order(tx, f);
      await call(tx, o, (q) => q`select public.cancel_order(${declined.id}::uuid, 'new'::public.order_status, 'sold_out'::public.cancel_reason, null)`);
      expect(await refusal(ask(tx, declined.token, "waiter"))).toEqual({ code: "P0001", message: "request_cancelled" });

      const pickup = await placeOrder(tx, { ...dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]), mode: "pickup", table_token: undefined });
      expect(await refusal(ask(tx, pickup.public_token, "waiter"))).toEqual({ code: "P0001", message: "request_no_order" });
      expect((await customerSees(tx, pickup.public_token)).requests).toBeNull();
      expect(await refusal(ask(tx, crypto.randomUUID(), "waiter"))).toEqual({ code: "P0001", message: "request_no_order" });
    }));

  test("yesterday's open request is closed by itself at midnight, by today's first request", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const old = await order(tx, f, "Yesterday");
      await ask(tx, old.token, "waiter");
      await toYesterday(tx, old.id);
      const today = await order(tx, f, "Today");
      expect((await ask(tx, today.token, "waiter")).created).toBe(true);
      const rows = await tx`
        select order_id, auto_cleared, cleared_by, public.nairobi_day(cleared_at) = public.nairobi_today() as cleared_at_midnight,
               (cleared_at at time zone 'Africa/Nairobi')::time = '00:00' as at_midnight
          from public.table_requests where table_id = ${f.table.id} order by created_at`;
      expect(rows.map((r: Record<string, unknown>) => [r.order_id, r.auto_cleared, r.cleared_by, r.at_midnight])).toEqual([
        [old.id, true, null, true],
        [today.id, false, null, null],
      ]);
      // The customer's page doesn't show yesterday's as "Answered".
      expect((await customerSees(tx, today.token)).requests!.waiter!.by_this_order).toBe(true);
    }));

  test("customers can't read or write the table directly", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f);
      await ask(tx, a.token, "waiter");
      expect((await refusal(call(tx, null, (q) => q`select * from public.table_requests`)))?.code).toBe("42501");
      expect((await refusal(call(tx, null, (q) => q`insert into public.table_requests (table_id, kind) values (${f.table.id}, 'bill')`)))?.code).toBe("42501");
      expect((await refusal(call(tx, null, (q) => q`select public.open_table_requests()`)))?.code).toBe("42501");
      expect((await refusal(call(tx, null, (q) => q`select public.clear_table_request(${crypto.randomUUID()}::uuid)`)))?.code).toBe("42501");
      // A signed-in non-staff user sees no rows and can't use the staff functions.
      const [u] = await tx`insert into auth.users (email) values ('nobody@test.local') returning id`;
      expect(await call(tx, u.id, (q) => q`select * from public.table_requests`)).toEqual([]);
      expect((await refusal(call(tx, u.id, (q) => q`select public.open_table_requests()`)))?.code).toBe("42501");
    }));
});

describe("from the menu (Done means 6a)", () => {
  test("a table with no order can call a waiter; a second phone gets the same request; Answered shows", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const first = await askFromMenu(tx, f.table.qr_token);
      const second = await askFromMenu(tx, f.table.qr_token);
      expect([first.created, second.created]).toEqual([true, false]);
      const [s] = (await call(tx, null, (q) => q`select public.table_waiter_status(${f.table.qr_token}) as s`)) as { s: { asked_at: string; answered_at: string | null } }[];
      expect([ms(s!.s.asked_at), s!.s.answered_at]).toEqual([ms(first.asked_at), null]);
      const r = (await board(tx, f.ownerId))[0]!;
      expect([r.kind, r.order_id, r.table_label, r.orders]).toEqual(["waiter", null, "Test table", null]);
      await done(tx, f.ownerId, r.id);
      const [after] = (await call(tx, null, (q) => q`select public.table_waiter_status(${f.table.qr_token}) as s`)) as { s: { answered_at: string | null } }[];
      expect(after!.s.answered_at).not.toBeNull();
      // An order placed later at the table sees the menu call as someone else's.
      const a = await order(tx, f);
      expect((await customerSees(tx, a.token)).requests!.waiter!.by_this_order).toBe(false);
    }));

  test("a replaced QR, an inactive table and a closed kitchen are refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const oldQr = f.table.qr_token as string;
      await tx`update public.dining_tables set qr_token = 'replaced-' || gen_random_uuid() where id = ${f.table.id}`;
      expect(await refusal(askFromMenu(tx, oldQr))).toEqual({ code: "P0001", message: "request_table_gone" });
      const [{ qr_token: qr }] = await tx`select qr_token from public.dining_tables where id = ${f.table.id}`;
      expect(await refusal(askFromMenu(tx, "not-a-table"))).toEqual({ code: "P0001", message: "request_table_gone" });
      await tx`update public.opening_hours set is_open = false`;
      expect(await refusal(askFromMenu(tx, qr))).toEqual({ code: "P0001", message: "request_kitchen_closed" });
      await tx`update public.opening_hours set is_open = true`;
      await tx`update public.dining_tables set active = false where id = ${f.table.id}`;
      expect(await refusal(askFromMenu(tx, qr))).toEqual({ code: "P0001", message: "request_table_gone" });
      const [s] = (await call(tx, null, (q) => q`select public.table_waiter_status(${oldQr}) as s`)) as { s: unknown }[];
      expect(s!.s).toBeNull();
    }));

  test("menu calls have their own limit of 10 a day per table", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      for (let i = 0; i < 10; i++) {
        await askFromMenu(tx, f.table.qr_token);
        await done(tx, f.ownerId, (await board(tx, f.ownerId))[0]!.id);
      }
      expect(await refusal(askFromMenu(tx, f.table.qr_token))).toEqual({ code: "P0001", message: "request_limit" });
      // An order at the table still has its own 10.
      const a = await order(tx, f);
      expect((await ask(tx, a.token, "waiter")).created).toBe(true);
    }));
});

describe("the bill list (Done means 3, 4)", () => {
  test("lists the table's unpaid, not cancelled dine-in orders from today, with Asked and the total", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const old = await order(tx, f, "Yesterday");
      await toYesterday(tx, old.id);
      await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const gone = await order(tx, f, "Cancelled");
      await call(tx, o, (q) => q`select public.cancel_order(${gone.id}::uuid, 'new'::public.order_status, 'sold_out'::public.cancel_reason, null)`);
      const paidEarlier = await order(tx, f, "Paid before");
      await call(tx, o, (q) => q`select public.mark_order_paid(${paidEarlier.id}::uuid, 'cash')`);
      await tx`update public.orders set paid_at = now() - interval '1 minute' where id = ${paidEarlier.id}`;
      // Another table's order isn't listed.
      const [other] = await tx`insert into public.dining_tables (label) values ('Other table') returning qr_token`;
      await order(tx, f, "Elsewhere", { table_token: other.qr_token });
      // Ask a moment after the earlier payment, so it falls before the request.
      await ask(tx, b.token, "bill");

      const bill = (await board(tx, o)).find((r) => r.kind === "bill")!;
      expect(bill.table_label).toBe("Test table");
      expect(bill.orders!.map((x) => [x.customer_name, x.paid, x.asked])).toEqual([
        ["Amina", false, false],
        ["Baraka", false, true],
      ]);
      expect(bill.unpaid_kes).toBe(bill.orders!.reduce((s, x) => s + x.total_kes, 0));
    }));

  test("Mark paid on one row and Mark all paid work with one Undo, each with its History line; All paid when nothing's left", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const c = await order(tx, f, "Chebet");
      await ask(tx, a.token, "bill");
      await call(tx, staff, (q) => q`select public.mark_order_paid(${a.id}::uuid, 'cash')`);

      const [r] = (await call(tx, staff, (q) => q`select public.mark_orders_paid(${pgArray([a.id, b.id, c.id])}::uuid[], 'mpesa') as r`)) as { r: { id: string; version: number }[] }[];
      // Amina was already paid: nothing of this tap's to undo.
      expect(r!.r.map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
      let bill = (await board(tx, staff)).find((x) => x.kind === "bill")!;
      // Paid since the request: still listed, as paid, until Done.
      expect([bill.orders!.every((x) => x.paid), bill.unpaid_kes]).toEqual([true, 0]);
      const [{ n }] = await tx`select count(*)::int as n from public.change_log where area = 'orders' and action = 'order.paid'`;
      expect(n).toBe(3);
      // RW2B-02: the bill's method is recorded on each order it changed; Amina keeps her own cash.
      expect(await methods(tx, [a.id, b.id, c.id])).toEqual(["cash", "mpesa", "mpesa"]);

      await call(tx, staff, (q) => q`select public.unmark_orders_paid(${JSON.stringify(r!.r)}::text::jsonb)`);
      bill = (await board(tx, staff)).find((x) => x.kind === "bill")!;
      expect(bill.orders!.map((x) => [x.customer_name, x.paid])).toEqual([
        ["Amina", true],
        ["Baraka", false],
        ["Chebet", false],
      ]);
      expect(await methods(tx, [a.id, b.id, c.id])).toEqual(["cash", null, null]);
      const [{ u }] = await tx`select count(*)::int as u from public.change_log where area = 'orders' and action <> 'order.paid'`;
      expect(u).toBeGreaterThanOrEqual(2);
    }));

  test("the group Undo is all or nothing: one order changed since means none are undone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const [r] = (await call(tx, staff, (q) => q`select public.mark_orders_paid(${pgArray([a.id, b.id])}::uuid[], 'cash') as r`)) as { r: { id: string; version: number }[] }[];
      // Baraka's order moves on in the kitchen, so its version no longer matches.
      await call(tx, staff, (q) => q`select public.advance_order(${b.id}::uuid, 'new'::public.order_status, 'preparing'::public.order_status)`);
      const err = await refusal(call(tx, staff, (q) => q`select public.unmark_orders_paid(${JSON.stringify(r!.r)}::text::jsonb)`));
      expect(err?.code).toBe("P0001");
      const rows = await tx`select payment_status from public.orders where id in (${a.id}, ${b.id})`;
      expect(rows.every((x: { payment_status: string }) => x.payment_status === "paid")).toBe(true);
      expect((await refusal(call(tx, staff, (q) => q`select public.mark_orders_paid(${pgArray([])}::uuid[], 'cash')`)))?.code).toBe("P0001");
    }));
});

describe("Mark all paid with a method, against 2.12's Reports (RW2B-02)", () => {
  type Day = { bucket: string; cash: number; mpesa: number };
  async function today(tx: Tx, f: Fixtures) {
    const [{ d }] = await tx`select public.nairobi_today()::text as d`;
    const [row] = (await call(tx, f.ownerId, (q) => q`select public.report_sales(${d}::date, ${d}::date) as r`)) as { r: { money_in: Day[] } }[];
    const day = row!.r.money_in.find((m) => m.bucket === d);
    return { cash: day?.cash ?? 0, mpesa: day?.mpesa ?? 0 };
  }

  test("a bill paid by M-Pesa counts in Reports' M-Pesa total; its Undo takes it out again", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const [{ kes }] = await tx`select sum(total_kes)::int as kes from public.orders where id in (${a.id}, ${b.id})`;
      const before = await today(tx, f);
      const [r] = (await call(tx, staff, (q) => q`select public.mark_orders_paid(${pgArray([a.id, b.id])}::uuid[], 'mpesa') as r`)) as { r: { id: string; version: number }[] }[];
      expect(await methods(tx, [a.id, b.id])).toEqual(["mpesa", "mpesa"]);
      expect(await today(tx, f)).toEqual({ cash: before.cash, mpesa: before.mpesa + kes });
      const [log] = await tx`select after from public.change_log where action = 'order.paid' and subject_id = ${b.id}`;
      expect(log!.after).toMatchObject({ payment: "paid", with: "mpesa" });

      await call(tx, staff, (q) => q`select public.unmark_orders_paid(${JSON.stringify(r!.r)}::text::jsonb)`);
      expect(await methods(tx, [a.id, b.id])).toEqual([null, null]);
      expect(await today(tx, f)).toEqual(before);
    }));

  test("a split bill: one order paid cash on its own, the rest all M-Pesa", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const c = await order(tx, f, "Chebet");
      const [{ ka }] = await tx`select total_kes as ka from public.orders where id = ${a.id}`;
      const [{ kbc }] = await tx`select sum(total_kes)::int as kbc from public.orders where id in (${b.id}, ${c.id})`;
      const before = await today(tx, f);
      await call(tx, staff, (q) => q`select public.mark_order_paid(${a.id}::uuid, 'cash')`);
      await call(tx, staff, (q) => q`select public.mark_orders_paid(${pgArray([a.id, b.id, c.id])}::uuid[], 'mpesa')`);
      expect(await methods(tx, [a.id, b.id, c.id])).toEqual(["cash", "mpesa", "mpesa"]);
      expect(await today(tx, f)).toEqual({ cash: before.cash + ka, mpesa: before.mpesa + kbc });
    }));

  test("no method, or card, is refused before anything changes; one cancelled order marks none", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f, "Amina");
      const b = await order(tx, f, "Baraka");
      const ids = pgArray([a.id, b.id]);
      expect((await refusal(call(tx, staff, (q) => q`select public.mark_orders_paid(${ids}::uuid[], 'card')`)))?.message).toBe("Choose cash or M-Pesa.");
      expect((await refusal(call(tx, staff, (q) => q`select public.mark_orders_paid(${ids}::uuid[], null)`)))?.message).toBe("Choose cash or M-Pesa.");
      // The bill was listed, then Baraka's order was cancelled before the tap.
      await call(tx, f.ownerId, (q) => q`select public.cancel_order(${b.id}::uuid, 'new'::public.order_status, 'sold_out'::public.cancel_reason, null)`);
      const err = await refusal(call(tx, staff, (q) => q`select public.mark_orders_paid(${ids}::uuid[], 'cash')`));
      expect(err?.code).toBe("P0001");
      expect(err?.message).toContain("was cancelled");
      const rows = (await tx`select payment_status, paid_with from public.orders where id in (${a.id}, ${b.id})`) as { payment_status: string; paid_with: string | null }[];
      expect(rows.every((x) => x.payment_status !== "paid" && x.paid_with === null)).toBe(true);
    }));

  test("anon can't call it; the one-argument version is gone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f, "Amina");
      expect((await refusal(call(tx, null, (q) => q`select public.mark_orders_paid(${pgArray([a.id])}::uuid[], 'cash')`)))?.code).toBe("42501");
      const [{ n }] = await tx`select count(*)::int as n from pg_proc where proname = 'mark_orders_paid'`;
      expect(n).toBe(1);
    }));
});

describe("Done and its Undo (Done means 5)", () => {
  test("Done clears it for everyone; Undo brings it back within 10 s, only for whoever tapped Done", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f);
      await ask(tx, a.token, "waiter");
      const r = (await board(tx, staff))[0]!;
      expect(await done(tx, staff, r.id)).toBe(true);
      // The other tablet taps Done a moment later: no error, nothing to do.
      expect(await done(tx, f.ownerId, r.id)).toBe(false);
      expect(await board(tx, f.ownerId)).toEqual([]);
      // Not theirs to undo.
      expect(await refusal(undoDone(tx, f.ownerId, r.id))).toEqual({ code: "P0001", message: "Too late to undo" });
      await undoDone(tx, staff, r.id);
      expect((await board(tx, f.ownerId)).map((x) => x.id)).toEqual([r.id]);
      expect((await customerSees(tx, a.token)).requests!.waiter!.answered_at).toBeNull();

      await done(tx, staff, r.id);
      await ageClear(tx, r.id, 11);
      expect(await refusal(undoDone(tx, staff, r.id))).toEqual({ code: "P0001", message: "Too late to undo" });
    }));

  test("Undo is refused once the table has asked again", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f);
      await ask(tx, a.token, "waiter");
      const r = (await board(tx, staff))[0]!;
      await done(tx, staff, r.id);
      await ask(tx, a.token, "waiter");
      expect(await refusal(undoDone(tx, staff, r.id))).toEqual({ code: "P0001", message: "asked_again" });
      expect((await board(tx, staff)).length).toBe(1);
    }));

  test("an auto-cleared request can't be undone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f);
      await ask(tx, a.token, "waiter");
      const [{ id }] = await tx`select id from public.table_requests limit 1`;
      await toYesterday(tx, a.id);
      expect(await board(tx, staff)).toEqual([]);
      expect(await refusal(undoDone(tx, staff, id))).toEqual({ code: "P0001", message: "Too late to undo" });
    }));
});

describe("table labels (RQA29-01)", () => {
  test("the database keeps a label to 40 characters, as the form does", () =>
    inTx(async (tx) => {
      await tx`insert into public.dining_tables (label) values (${"W".repeat(40)})`;
      const long = await refusal(tx.savepoint((sp) => sp`insert into public.dining_tables (label) values (${"W".repeat(41)})`));
      expect(long?.code).toBe("23514");
    }));
});
