// Slice 2.4: the order board (spec-2.4-order-board.md, "Done means" 2). Done means #2 names
// supabase/tests; the repo's database tests live here, in tests/db.
// now() is fixed for a transaction, so a change made in a test is "0 seconds old"; the windows
// are tested by back-dating the stamp the RPC reads.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, platesSold, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Mode = "dine_in" | "pickup" | "delivery";

async function staffMember(tx: Tx) {
  const [u] = await tx`insert into auth.users (email) values ('otieno@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Otieno')`;
  return u.id as string; // no grants: the board needs none
}

async function order(tx: Tx, f: Fixtures, mode: Mode = "dine_in", items: object[] = [{ dish_id: f.regular.id, quantity: 1 }]) {
  let payload: object = dineIn(f, items as never, { customer_name: "Amina" });
  if (mode === "pickup") payload = { ...payload, mode, table_token: undefined };
  if (mode === "delivery") {
    const [z] = await tx`insert into public.delivery_zones (name, fee_kes) values (${`Zone ${crypto.randomUUID().slice(0, 6)}`}, 150) returning id`;
    payload = { ...payload, mode, table_token: undefined, delivery_zone_id: z.id, delivery_address: "Test street 1" };
  }
  const placed = await placeOrder(tx, payload);
  const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
  return { id: row.id as string, token: placed.public_token, code: placed.code };
}

const call = (tx: Tx, who: string | null, fn: (q: Tx) => PromiseLike<unknown>) =>
  attempt(tx, who ? "authenticated" : "anon", who, fn as never);

/** The error a call raised ({code, message}), or null if it worked. */
async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { errno?: string; code?: string; message: string };
    return { code: err.errno ?? err.code, message: err.message };
  }
}

/** A move; returns the order's version after it, which its Undo must send back (RQA24-01). */
const advance = async (tx: Tx, who: string, id: string, from: string, to: string) => {
  const [r] = (await call(tx, who, (q) => q`select public.advance_order(${id}::uuid, ${from}::public.order_status, ${to}::public.order_status) as v`)) as { v: number }[];
  return r!.v;
};
const cancel = (tx: Tx, who: string, id: string, from: string, reason: string | null, note: string | null = null) =>
  call(tx, who, (q) => q`select public.cancel_order(${id}::uuid, ${from}::public.order_status, ${reason}::public.cancel_reason, ${note})`);
const undo = (tx: Tx, who: string, id: string, status: string, version: number) =>
  call(tx, who, (q) => q`select public.undo_order_move(${id}::uuid, ${status}::public.order_status, ${version}::int)`);
/** Mark paid; returns the version its Undo needs, or null if it was already paid (nothing to undo). */
const markPaid = async (tx: Tx, who: string, id: string) => {
  const [r] = (await call(tx, who, (q) => q`select public.mark_order_paid(${id}::uuid, 'cash') as v`)) as { v: number | null }[];
  return r!.v;
};
const unmarkPaid = (tx: Tx, who: string | null, id: string, version: number) =>
  call(tx, who, (q) => q`select public.unmark_order_paid(${id}::uuid, ${version}::int)`);

async function row(tx: Tx, id: string) {
  const [r] = await tx`select status, prev_status, payment_status, paid_at, paid_from, cancel_reason, cancel_note from public.orders where id = ${id}`;
  return r as Record<string, unknown>;
}

/** Back-dates a stamp without firing the triggers. */
async function age(tx: Tx, id: string, column: "status_changed_at" | "paid_at", seconds: number) {
  await tx`select set_config('session_replication_role', 'replica', true)`;
  if (column === "status_changed_at") await tx`update public.orders set status_changed_at = now() - make_interval(secs => ${seconds}) where id = ${id}`;
  else await tx`update public.orders set paid_at = now() - make_interval(secs => ${seconds}) where id = ${id}`;
  await tx`select set_config('session_replication_role', 'origin', true)`;
}

async function customerSees(tx: Tx, token: string) {
  const [r] = await call(tx, null, (q) => q`select public.get_order_status(${token}::uuid) as s`) as { s: Record<string, unknown> }[];
  return r!.s;
}

const log = async (tx: Tx) =>
  (await tx`select action, actor_name, before, after from public.change_log where area = 'orders' order by id`) as {
    action: string; actor_name: string; before: Record<string, unknown>; after: Record<string, unknown>;
  }[];

describe("steps", () => {
  test("a delivery goes Ready → On the way → Done; the others go Ready → Done", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const d = await order(tx, f, "delivery");
      await advance(tx, o, d.id, "new", "preparing");
      await advance(tx, o, d.id, "preparing", "ready");
      expect(await refusal(advance(tx, o, d.id, "ready", "completed"))).toEqual({ code: "P0001", message: "A delivery goes on the way first" });
      await advance(tx, o, d.id, "ready", "on_the_way");
      await advance(tx, o, d.id, "on_the_way", "completed");
      expect((await row(tx, d.id)).status).toBe("completed");

      for (const mode of ["dine_in", "pickup"] as const) {
        const x = await order(tx, f, mode);
        await advance(tx, o, x.id, "new", "preparing");
        await advance(tx, o, x.id, "preparing", "ready");
        expect(await refusal(advance(tx, o, x.id, "ready", "on_the_way"))).toEqual({ code: "P0001", message: "Only a delivery goes on the way" });
        await advance(tx, o, x.id, "ready", "completed");
        expect((await row(tx, x.id)).status).toBe("completed");
      }
    }));

  test("each move remembers the status before it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      expect((await row(tx, x.id)).prev_status).toBeNull();
      await advance(tx, f.ownerId, x.id, "new", "preparing");
      expect(await row(tx, x.id)).toMatchObject({ status: "preparing", prev_status: "new" });
    }));
});

describe("undo a move", () => {
  test("inside 10 s it moves back one step, for staff with no grants, and logs an undo, not a move", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f, "delivery");
      await advance(tx, s, x.id, "new", "preparing");
      await advance(tx, s, x.id, "preparing", "ready");
      const v = await advance(tx, s, x.id, "ready", "on_the_way");
      await age(tx, x.id, "status_changed_at", 9);
      expect(await refusal(undo(tx, s, x.id, "on_the_way", v))).toBeNull();
      expect(await row(tx, x.id)).toMatchObject({ status: "ready", prev_status: "ready" });
      const l = await log(tx);
      expect(l.at(-1)).toEqual({ action: "order.move_undo", actor_name: "Otieno", before: { status: "on_the_way" }, after: { status: "ready" } });
      expect(l.map((r) => r.action)).toEqual(["order.move", "order.move", "order.move", "order.move_undo"]);
    }));

  test("from Done too, and back to New", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await undo(tx, f.ownerId, x.id, "preparing", await advance(tx, f.ownerId, x.id, "new", "preparing"));
      expect((await row(tx, x.id)).status).toBe("new");
      const y = await order(tx, f, "pickup");
      await advance(tx, f.ownerId, y.id, "new", "preparing");
      await advance(tx, f.ownerId, y.id, "preparing", "ready");
      await undo(tx, f.ownerId, y.id, "completed", await advance(tx, f.ownerId, y.id, "ready", "completed"));
      expect((await row(tx, y.id)).status).toBe("ready");
    }));

  test("refused after 10 s", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      const v = await advance(tx, f.ownerId, x.id, "new", "preparing");
      await age(tx, x.id, "status_changed_at", 11);
      expect(await refusal(undo(tx, f.ownerId, x.id, "preparing", v))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect((await row(tx, x.id)).status).toBe("preparing");
    }));

  test("refused after another move, from a stale status, twice, and on a new order", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      const [{ v0 }] = await tx`select version as v0 from public.orders where id = ${x.id}`;
      expect(await refusal(undo(tx, f.ownerId, x.id, "new", v0))).toMatchObject({ code: "P0001" });
      const v1 = await advance(tx, f.ownerId, x.id, "new", "preparing");
      const v2 = await advance(tx, f.ownerId, x.id, "preparing", "ready");
      // The tablet that moved it to Cooking taps Undo after another tablet moved it on.
      expect(await refusal(undo(tx, f.ownerId, x.id, "preparing", v1))).toEqual({ code: "P0001", message: "Too late to undo" });
      await undo(tx, f.ownerId, x.id, "ready", v2);
      expect(await refusal(undo(tx, f.ownerId, x.id, "ready", v2))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect((await row(tx, x.id)).status).toBe("preparing");
    }));

  test("never undoes a Decline or Cancel", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await cancel(tx, f.ownerId, x.id, "new", "too_busy");
      const [{ v }] = await tx`select version as v from public.orders where id = ${x.id}`;
      expect(await refusal(undo(tx, f.ownerId, x.id, "cancelled", v))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect((await row(tx, x.id)).status).toBe("cancelled");
    }));

  // RQA24-01: an Undo reverses only the exact move it was offered for.
  test("an old Undo is refused after someone undid and redid the same move (same status)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f);
      const owners = await advance(tx, f.ownerId, x.id, "new", "preparing");
      await undo(tx, s, x.id, "preparing", owners); // staff undoes the owner's Accept
      const staffs = await advance(tx, s, x.id, "new", "preparing"); // and Accepts it again
      expect(staffs).not.toBe(owners);
      expect(await refusal(undo(tx, f.ownerId, x.id, "preparing", owners))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect((await row(tx, x.id)).status).toBe("preparing");
      expect(await refusal(undo(tx, s, x.id, "preparing", staffs))).toBeNull(); // the latest one still can
    }));

  test("a move's Undo is refused once the order was marked paid or changed in any way", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f);
      const v = await advance(tx, f.ownerId, x.id, "new", "preparing");
      await markPaid(tx, s, x.id);
      expect(await refusal(undo(tx, f.ownerId, x.id, "preparing", v))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect(await row(tx, x.id)).toMatchObject({ status: "preparing", payment_status: "paid" });
    }));

  test("the backward step is only for undo: a plain move back is still refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await advance(tx, f.ownerId, x.id, "new", "preparing");
      expect(await refusal(advance(tx, f.ownerId, x.id, "preparing", "new"))).toMatchObject({ code: "P0001" });
      // and the undo setting doesn't outlive its one update
      const [{ v }] = await tx`select coalesce(current_setting('dausis.undo', true), '') as v`;
      expect(v).toBe("");
    }));
});

describe("Mark paid and its undo", () => {
  test("unmark inside 10 s puts back the exact earlier payment and logs it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f);
      await tx`select set_config('session_replication_role', 'replica', true)`;
      await tx`update public.orders set payment_status = 'failed' where id = ${x.id}`;
      await tx`select set_config('session_replication_role', 'origin', true)`;
      const v = (await markPaid(tx, s, x.id))!;
      expect(await row(tx, x.id)).toMatchObject({ payment_status: "paid", paid_from: "failed" });
      expect((await row(tx, x.id)).paid_at).not.toBeNull();
      await age(tx, x.id, "paid_at", 9);
      expect(await refusal(unmarkPaid(tx, s, x.id, v))).toBeNull();
      expect(await row(tx, x.id)).toMatchObject({ payment_status: "failed", paid_at: null, paid_from: null });
      expect((await log(tx)).map((r) => [r.action, r.after])).toEqual([
        ["order.paid", { payment: "paid", with: "cash" }],
        ["order.paid_undo", { payment: "failed" }],
      ]);
    }));

  test("refused after 10 s, twice, and on an order paid by the payment provider", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      const vx = (await markPaid(tx, f.ownerId, x.id))!;
      await age(tx, x.id, "paid_at", 11);
      expect(await refusal(unmarkPaid(tx, f.ownerId, x.id, vx))).toEqual({ code: "P0001", message: "Too late to undo" });
      const y = await order(tx, f);
      const vy = (await markPaid(tx, f.ownerId, y.id))!;
      await unmarkPaid(tx, f.ownerId, y.id, vy);
      expect(await refusal(unmarkPaid(tx, f.ownerId, y.id, vy))).toEqual({ code: "P0001", message: "Too late to undo" });
      const z = await order(tx, f);
      await tx`update public.orders set payment_status = 'paid' where id = ${z.id}`; // as the callback does
      const [{ vz }] = await tx`select version as vz from public.orders where id = ${z.id}`;
      expect(await refusal(unmarkPaid(tx, f.ownerId, z.id, vz))).toEqual({ code: "P0001", message: "Too late to undo" });
    }));

  // RQA24-01, the payment side.
  test("Mark paid's Undo is refused once someone else cancelled or moved the order", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f);
      const v = (await markPaid(tx, f.ownerId, x.id))!;
      await cancel(tx, s, x.id, "new", "too_busy");
      expect(await refusal(unmarkPaid(tx, f.ownerId, x.id, v))).toEqual({ code: "P0001", message: "Too late to undo" });
      expect(await row(tx, x.id)).toMatchObject({ status: "cancelled", payment_status: "paid" });
      const y = await order(tx, f);
      const w = (await markPaid(tx, f.ownerId, y.id))!;
      await advance(tx, s, y.id, "new", "preparing");
      expect(await refusal(unmarkPaid(tx, f.ownerId, y.id, w))).toEqual({ code: "P0001", message: "Too late to undo" });
    }));

  test("a second Mark paid changes nothing and offers no Undo", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const s = await staffMember(tx);
      const x = await order(tx, f);
      expect(await markPaid(tx, f.ownerId, x.id)).toBeNumber();
      expect(await markPaid(tx, s, x.id)).toBeNull();
    }));

  test("works in Done", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "completed"]] as const) await advance(tx, f.ownerId, x.id, a, b);
      await markPaid(tx, f.ownerId, x.id);
      expect((await row(tx, x.id)).payment_status).toBe("paid");
    }));
});

describe("Decline and Cancel", () => {
  test("a reason is required; Other needs 3 to 120 characters", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      expect(await refusal(cancel(tx, f.ownerId, x.id, "new", null))).toEqual({ code: "22023", message: "Choose a reason" });
      for (const note of [null, "  ", "ok", "x".repeat(121)]) {
        expect(await refusal(cancel(tx, f.ownerId, x.id, "new", "other", note))).toEqual({ code: "22023", message: "Say why in a few words." });
      }
      expect((await row(tx, x.id)).status).toBe("new");
      await cancel(tx, f.ownerId, x.id, "new", "other", "  Gas ran out  ");
      expect(await row(tx, x.id)).toMatchObject({ status: "cancelled", cancel_reason: "other", cancel_note: "Gas ran out" });
    }));

  test("a note with another reason is dropped", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await cancel(tx, f.ownerId, x.id, "new", "sold_out", "ignored");
      expect(await row(tx, x.id)).toMatchObject({ cancel_reason: "sold_out", cancel_note: null });
    }));

  test("Can't deliver is for deliveries only", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      for (const mode of ["pickup", "dine_in"] as const) {
        const x = await order(tx, f, mode);
        expect(await refusal(cancel(tx, f.ownerId, x.id, "new", "cant_deliver"))).toMatchObject({ code: "22023" });
      }
      const d = await order(tx, f, "delivery");
      await cancel(tx, f.ownerId, d.id, "new", "cant_deliver");
      expect((await row(tx, d.id)).cancel_reason).toBe("cant_deliver");
    }));

  test("Customer didn't come: pickup or delivery, in Ready or On the way only", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const dine = await order(tx, f);
      await advance(tx, o, dine.id, "new", "preparing");
      await advance(tx, o, dine.id, "preparing", "ready");
      expect(await refusal(cancel(tx, o, dine.id, "ready", "no_show"))).toMatchObject({ code: "22023" });
      const p = await order(tx, f, "pickup");
      await advance(tx, o, p.id, "new", "preparing");
      expect(await refusal(cancel(tx, o, p.id, "preparing", "no_show"))).toMatchObject({ code: "22023" });
      await advance(tx, o, p.id, "preparing", "ready");
      await cancel(tx, o, p.id, "ready", "no_show");
      expect((await row(tx, p.id)).cancel_reason).toBe("no_show");
      const d = await order(tx, f, "delivery");
      for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "on_the_way"]] as const) await advance(tx, o, d.id, a, b);
      await cancel(tx, o, d.id, "on_the_way", "no_show");
      expect((await row(tx, d.id)).status).toBe("cancelled");
    }));

  test("cancel from Cooking, Ready and On the way gives the plates back", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = f.ownerId;
      const steps = [["new", "preparing"], ["preparing", "ready"], ["ready", "on_the_way"]] as const;
      for (let n = 1; n <= 3; n++) {
        const x = await order(tx, f, "delivery", [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]);
        expect(await platesSold(tx, f.openEntry.id)).toBe(1);
        for (const [a, b] of steps.slice(0, n)) await advance(tx, o, x.id, a, b);
        const at = steps[n - 1]![1];
        await cancel(tx, o, x.id, at, "customer_asked");
        expect(await platesSold(tx, f.openEntry.id)).toBe(0);
      }
    }));

  test("a stale Cancel is refused as stale before its reason is checked", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await advance(tx, f.ownerId, x.id, "new", "preparing");
      expect(await refusal(cancel(tx, f.ownerId, x.id, "new", "no_show"))).toEqual({ code: "P0001", message: "Someone else already moved this order" });
      const y = await order(tx, f);
      for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "completed"]] as const) await advance(tx, f.ownerId, y.id, a, b);
      expect(await refusal(cancel(tx, f.ownerId, y.id, "ready", "too_busy"))).toEqual({ code: "P0001", message: "This order is already completed" });
    }));

  test("the History line carries the reason", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await cancel(tx, f.ownerId, x.id, "new", "other", "Gas ran out");
      const y = await order(tx, f);
      await advance(tx, f.ownerId, y.id, "new", "preparing");
      await cancel(tx, f.ownerId, y.id, "preparing", "sold_out");
      const l = (await log(tx)).filter((r) => r.action === "order.cancel");
      expect(l.map((r) => [r.before, r.after])).toEqual([
        [{ status: "new" }, { status: "cancelled", reason: "other", note: "Gas ran out" }],
        [{ status: "preparing" }, { status: "cancelled", reason: "sold_out" }],
      ]);
    }));
});

describe("the customer's page", () => {
  test("a move shows only once it is 5 s old; a Decline shows at once, with its reason", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      await advance(tx, f.ownerId, x.id, "new", "preparing");
      expect((await customerSees(tx, x.token)).status).toBe("new");
      await age(tx, x.id, "status_changed_at", 5);
      expect((await customerSees(tx, x.token)).status).toBe("preparing");

      // An undone move is never seen.
      await undo(tx, f.ownerId, x.id, "ready", await advance(tx, f.ownerId, x.id, "preparing", "ready"));
      expect((await customerSees(tx, x.token)).status).toBe("preparing");

      await cancel(tx, f.ownerId, x.id, "preparing", "other", "Gas ran out");
      expect(await customerSees(tx, x.token)).toMatchObject({ status: "cancelled", cancel_reason: "other", cancel_note: "Gas ran out", declined: false });

      // Declined from New: its own headline on the customer's page.
      const y = await order(tx, f);
      await cancel(tx, f.ownerId, y.id, "new", "sold_out");
      expect(await customerSees(tx, y.token)).toMatchObject({ status: "cancelled", cancel_reason: "sold_out", declined: true });
    }));
});

describe("who can", () => {
  test("anon can do none of it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      for (const fn of [
        (q: Tx) => q`select public.undo_order_move(${x.id}::uuid, 'new', 1)`,
        (q: Tx) => q`select public.unmark_order_paid(${x.id}::uuid, 1)`,
        (q: Tx) => q`select public.cancel_order(${x.id}::uuid, 'new', 'too_busy')`,
      ]) {
        expect(await refusal(call(tx, null, fn))).toMatchObject({ code: "42501" });
      }
    }));

  test("a signed-in non-staff user is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f);
      const [u] = await tx`insert into auth.users (email) values ('stranger@test.local') returning id`;
      expect(await refusal(undo(tx, u.id, x.id, "new", 1))).toEqual({ code: "42501", message: "Not allowed" });
      expect(await refusal(unmarkPaid(tx, u.id, x.id, 1))).toEqual({ code: "42501", message: "Not allowed" });
    }));

  test("the old two-argument cancel_order is gone, and so are the undos without a version", () =>
    inTx(async (tx) => {
      const rows = await tx`select proname, pronargs from pg_proc
        where proname in ('cancel_order', 'undo_order_move', 'unmark_order_paid') and pronamespace = 'public'::regnamespace order by proname`;
      expect(rows.map((r: { proname: string; pronargs: number }) => [r.proname, r.pronargs])).toEqual([
        ["cancel_order", 4], ["undo_order_move", 3], ["unmark_order_paid", 2],
      ]);
    }));
});

describe("unchanged by on_the_way", () => {
  test("dashboard_stats counts an order on the way", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const x = await order(tx, f, "delivery");
      for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "on_the_way"]] as const) await advance(tx, f.ownerId, x.id, a, b);
      const [r] = await call(tx, f.ownerId, (q) => q`select public.dashboard_stats(public.nairobi_today()) as s`) as { s: Record<string, number> }[];
      expect(r!.s.orders).toBe(1);
    }));
});
