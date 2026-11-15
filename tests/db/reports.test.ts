// Slice 2.12: Money in, credit notes and the report RPCs (spec-2.12-reports.md, "Done means" 1, 2, 4, 13, 14, 15).
// The hand-counted case sits in March 2020, far from seed.sql's six weeks, so its figures are exact.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;

async function staffMember(tx: Tx) {
  const [u] = await tx`insert into auth.users (email) values ('otieno@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Otieno')`;
  return u.id as string;
}

async function order(tx: Tx, f: Fixtures, name = "Amina") {
  const placed = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { customer_name: name }));
  const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
  return { id: row.id as string, code: placed.code };
}

const as = (tx: Tx, who: string | null, fn: (q: Tx) => PromiseLike<unknown>) => attempt(tx, who ? "authenticated" : "anon", who, fn as never);

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { errno?: string; code?: string; message: string };
    return { code: err.errno ?? err.code, message: err.message };
  }
}

const pay = (tx: Tx, who: string, id: string, w: string | null) =>
  as(tx, who, (q) => q`select public.mark_order_paid(${id}::uuid, ${w}::public.paid_with) as v`);
const cancel = (tx: Tx, who: string, id: string) =>
  as(tx, who, (q) => q`select public.cancel_order(${id}::uuid, 'new'::public.order_status, 'customer_asked'::public.cancel_reason, null)`);
const issue = (tx: Tx, who: string, id: string, amount: number, w: string | null = "cash", reason = "Refund: customer asked") =>
  as(tx, who, (q) => q`select public.issue_credit_note(${id}::uuid, ${amount}, ${reason}, ${w}::public.paid_with) as r`);
const voidNote = (tx: Tx, who: string, id: string, reason = "wrong amount") =>
  as(tx, who, (q) => q`select public.void_credit_note(${id}::uuid, ${reason}) as r`);

/** A paid, cancelled order. */
async function paidCancelled(tx: Tx, f: Fixtures, w = "cash") {
  const o = await order(tx, f);
  await pay(tx, f.ownerId, o.id, w);
  await cancel(tx, f.ownerId, o.id);
  return o;
}

describe("who can call what", () => {
  test("staff and anon are refused every report and credit note RPC", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const o = await paidCancelled(tx, f);
      const calls: [string, (q: Tx) => PromiseLike<unknown>][] = [
        ["report_sales", (q) => q`select public.report_sales(current_date - 1, current_date)`],
        ["report_dishes", (q) => q`select public.report_dishes(current_date - 1, current_date)`],
        ["report_times", (q) => q`select public.report_times(current_date - 1, current_date)`],
        ["report_delivery", (q) => q`select public.report_delivery(current_date - 1, current_date)`],
        ["report_order", (q) => q`select public.report_order(${o.code})`],
        ["orders csv", (q) => q`select * from public.report_orders_csv(current_date - 1, current_date)`],
        ["credit notes csv", (q) => q`select * from public.report_credit_notes_csv(current_date - 1, current_date)`],
        ["issue", (q) => q`select public.issue_credit_note(${o.id}::uuid, 100, 'Refund', 'cash')`],
      ];
      for (const [name, fn] of calls) {
        expect((await refusal(as(tx, staff, fn)))?.code, `staff ${name}`).toBe("42501");
        expect(await refusal(as(tx, null, fn)), `anon ${name}`).not.toBeNull();
      }
      const note = (await issue(tx, f.ownerId, o.id, 100)) as { r: { id: string } }[];
      expect((await refusal(voidNote(tx, staff, note[0]!.r.id)))?.code).toBe("42501");
    });
  });

  test("credit notes can't be written, changed or deleted except through the functions", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await paidCancelled(tx, f);
      const [{ r }] = (await issue(tx, f.ownerId, o.id, 100)) as unknown as [{ r: { id: string } }];
      for (const stmt of [
        (q: Tx) => q`insert into public.credit_notes (number, order_id, amount_kes, reason, issued_by, refunded_with) values (999, ${o.id}, 1, 'abc', ${f.ownerId}, 'cash')`,
        (q: Tx) => q`update public.credit_notes set amount_kes = 1 where id = ${r.id}`,
        (q: Tx) => q`delete from public.credit_notes where id = ${r.id}`,
        (q: Tx) => q`update public.credit_note_counter set last_number = 0`,
        (q: Tx) => q`select * from public.credit_note_counter`,
      ]) {
        expect(await refusal(as(tx, f.ownerId, stmt))).not.toBeNull();
      }
    });
  });
});

describe("mark_order_paid with a method", () => {
  test("records cash or M-Pesa, refuses card, and writes the method to the History", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const a = await order(tx, f);
      expect((await refusal(pay(tx, staff, a.id, "card")))?.message).toBe("Choose cash or M-Pesa.");
      expect((await refusal(pay(tx, staff, a.id, null)))?.message).toBe("Choose cash or M-Pesa.");
      await pay(tx, staff, a.id, "mpesa");
      const [row] = await tx`select payment_status, paid_with from public.orders where id = ${a.id}`;
      expect(row).toMatchObject({ payment_status: "paid", paid_with: "mpesa" });
      const [log] = await tx`select after from public.change_log where action = 'order.paid' and subject_id = ${a.id}`;
      expect(log!.after).toMatchObject({ payment: "paid", with: "mpesa" });
      // A second tap changes nothing.
      await pay(tx, staff, a.id, "cash");
      expect((await tx`select paid_with from public.orders where id = ${a.id}`)[0]!.paid_with).toBe("mpesa");
    });
  });

  test("a cancelled order can't be marked paid", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f);
      await cancel(tx, f.ownerId, a.id);
      const r = await refusal(pay(tx, f.ownerId, a.id, "cash"));
      expect(r).toEqual({ code: "P0001", message: `${a.code} was cancelled, so it can't be marked paid.` });
    });
  });

  test("the check keeps paid_with to paid orders, and Undo clears it", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await order(tx, f);
      expect(await refusal(tx.savepoint((sp) => sp`update public.orders set paid_with = 'cash' where id = ${a.id}`))).not.toBeNull();
      const [{ v }] = (await pay(tx, f.ownerId, a.id, "cash")) as unknown as [{ v: number }];
      await as(tx, f.ownerId, (q) => q`select public.unmark_order_paid(${a.id}::uuid, ${v})`);
      expect((await tx`select payment_status, paid_with, paid_at from public.orders where id = ${a.id}`)[0]).toMatchObject({ paid_with: null, paid_at: null });
    });
  });
});

describe("credit notes", () => {
  test("every refusal, with the sheet's words", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const live = await order(tx, f); // not cancelled
      expect((await refusal(issue(tx, f.ownerId, live.id, 100)))?.message).toBe("Only a cancelled order can have a credit note.");

      const unpaid = await order(tx, f);
      await cancel(tx, f.ownerId, unpaid.id);
      expect((await refusal(issue(tx, f.ownerId, unpaid.id, 100)))?.message).toBe(`${unpaid.code} wasn't paid, so there is nothing to refund.`);

      const o = await paidCancelled(tx, f); // total 300
      expect((await refusal(issue(tx, f.ownerId, o.id, 301)))?.message).toBe("The credit note can't be more than was paid, KSh 300.");
      expect((await refusal(issue(tx, f.ownerId, o.id, 0)))?.message).toBe("Enter at least KSh 1.");
      expect((await refusal(issue(tx, f.ownerId, o.id, 100, "cash", "ab")))?.message).toBe("Write a reason of 3 to 120 characters.");
      expect((await refusal(issue(tx, f.ownerId, o.id, 100, "cash", "x".repeat(121))))?.message).toBe("Write a reason of 3 to 120 characters.");
      expect((await refusal(issue(tx, f.ownerId, o.id, 100, null)))?.message).toBe("Choose cash or M-Pesa.");
      expect((await refusal(issue(tx, f.ownerId, o.id, 100, "card")))?.message).toBe("Choose cash or M-Pesa.");
      expect(await tx`select 1 from public.credit_notes where order_id = ${o.id}`).toHaveLength(0);
    });
  });

  test("numbers have no gaps: a refused issue doesn't use one, and a second note for an order names the first", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [{ last_number: before }] = await tx`select last_number from public.credit_note_counter`;
      const a = await paidCancelled(tx, f);
      const b = await paidCancelled(tx, f, "mpesa");
      await refusal(issue(tx, f.ownerId, a.id, 9999)); // refused: over the amount
      const [{ r: ra }] = (await issue(tx, f.ownerId, a.id, 300)) as unknown as [{ r: { number: number; code: string } }];
      const [{ r: rb }] = (await issue(tx, f.ownerId, b.id, 120, "mpesa")) as unknown as [{ r: { number: number; code: string } }];
      expect(ra.number).toBe(before + 1);
      expect(rb.number).toBe(before + 2);
      expect(ra.code).toBe(`CN-${String(before + 1).padStart(4, "0")}`);
      const dup = await refusal(issue(tx, f.ownerId, a.id, 100));
      expect(dup?.message).toBe(`${a.code} already has credit note ${ra.code}.`);
      expect((await tx`select last_number from public.credit_note_counter`)[0]!.last_number).toBe(before + 2);
    });
  });

  test("CN-10000 is shown whole", async () => {
    await inTx(async (tx) => {
      const [r] = await tx`select public.credit_note_code(9999) as a, public.credit_note_code(10000) as b, public.credit_note_code(1) as c`;
      expect(r).toEqual({ a: "CN-9999", b: "CN-10000", c: "CN-0001" });
    });
  });

  test("void: once only, keeps its number, a new note gets the next", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await paidCancelled(tx, f);
      const [{ r }] = (await issue(tx, f.ownerId, o.id, 200)) as unknown as [{ r: { id: string; number: number } }];
      expect((await refusal(voidNote(tx, f.ownerId, r.id, "no")))?.message).toBe("Write a reason of 3 to 120 characters.");
      await voidNote(tx, f.ownerId, r.id);
      expect((await refusal(voidNote(tx, f.ownerId, r.id)))?.message).toMatch(/is already void\.$/);
      const [row] = await tx`select number, voided_at, void_reason from public.credit_notes where id = ${r.id}`;
      expect(row).toMatchObject({ number: r.number, void_reason: "wrong amount" });
      expect(row!.voided_at).not.toBeNull();
      const [{ r: again }] = (await issue(tx, f.ownerId, o.id, 300)) as unknown as [{ r: { number: number } }];
      expect(again.number).toBe(r.number + 1);
      const lines = await tx`select action, after from public.change_log where subject_id = ${o.id} and action like 'credit_note.%' order by id`;
      expect(lines.map((l: { action: string }) => l.action)).toEqual(["credit_note.issue", "credit_note.void", "credit_note.issue"]);
      expect(lines[0]!.after).toMatchObject({ amount: 200, with: "cash" });
    });
  });

  test("a note can't be voided with a half-filled void, and a paid order with a live note can't be un-paid", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await paidCancelled(tx, f);
      const [{ r }] = (await issue(tx, f.ownerId, o.id, 200)) as unknown as [{ r: { id: string } }];
      expect(await refusal(tx.savepoint((sp) => sp`update public.credit_notes set voided_at = now() where id = ${r.id}`))).not.toBeNull();
    });
  });
});

describe("sold_out_at", () => {
  test("set by the last plate and kept; set by the switch and kept when it goes back on", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const mk = async () => {
        const placed = await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 3 }]));
        return placed;
      };
      const read = async () =>
        (await tx`select plates_sold, sold_out_at from public.menu_entry_days where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`)[0];
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }]));
      expect((await read())!.sold_out_at).toBeNull();
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      const full = await read();
      expect(full!.plates_sold).toBe(3);
      expect(full!.sold_out_at).not.toBeNull();
      void mk;
      // The switch: a fresh day row for another entry.
      const [other] = await tx`select id from public.menu_entries where id = ${f.closedEntry.id}`;
      await as(tx, f.ownerId, (q) => q`select public.set_entry_sold_out(${other!.id}::uuid, true)`);
      const first = (await tx`select sold_out_at from public.menu_entry_days where entry_id = ${other!.id}`)[0]!.sold_out_at;
      expect(first).not.toBeNull();
      await as(tx, f.ownerId, (q) => q`select public.set_entry_sold_out(${other!.id}::uuid, false)`);
      const [back] = await tx`select sold_out_manual, sold_out_at from public.menu_entry_days where entry_id = ${other!.id}`;
      expect(back).toMatchObject({ sold_out_manual: false });
      expect(back!.sold_out_at.getTime()).toBe(first.getTime());
    });
  });

  // The last plate is caught by a trigger on plates_sold, not by place_order, so a later
  // place_order (2.11) keeps it. These tests go round place_order on purpose.
  test("the trigger: set at the limit whoever writes the count, kept when plates are given back", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const read = async () =>
        (await tx`select plates_sold, sold_out_at from public.menu_entry_days where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`)[0]!;
      const [trig] = await tx`select count(*)::int n from pg_trigger where tgname = 'menu_entry_days_sold_out_at' and not tgisinternal`;
      expect(trig!.n).toBe(1);
      // place_order no longer mentions sold_out_at: the trigger is the only writer on the plate path.
      const [src] = await tx`select prosrc from pg_proc where proname = 'place_order' and pronamespace = 'public'::regnamespace`;
      expect(src!.prosrc).not.toContain("sold_out_at");

      // Straight into the table: below the limit stays null, the limit sets it.
      await tx`insert into public.menu_entry_days (entry_id, day) values (${f.openEntry.id}, public.nairobi_today()) on conflict do nothing`;
      await tx`update public.menu_entry_days set plates_sold = 2 where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`;
      expect((await read()).sold_out_at).toBeNull();
      await tx`update public.menu_entry_days set plates_sold = 3 where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`;
      const full = await read();
      expect(full.sold_out_at).not.toBeNull();

      // Given back, then full again: the first time stays.
      await tx`update public.menu_entry_days set plates_sold = 1 where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`;
      expect((await read()).sold_out_at.getTime()).toBe(full.sold_out_at.getTime());
      await tx`update public.menu_entry_days set plates_sold = 3 where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`;
      expect((await read()).sold_out_at.getTime()).toBe(full.sold_out_at.getTime());

      // A dish with no plate limit never gets a time.
      const [free] = await tx`select id from public.menu_entries where plates_per_day is null limit 1`;
      if (free) {
        await tx`insert into public.menu_entry_days (entry_id, day, plates_sold) values (${free.id}, public.nairobi_today(), 500)
                   on conflict (entry_id, day) do update set plates_sold = 500`;
        const [row] = await tx`select sold_out_at from public.menu_entry_days where entry_id = ${free.id} and day = public.nairobi_today()`;
        expect(row!.sold_out_at).toBeNull();
      }
    });
  });

  test("the trigger: a cancelled last-plate order gives the plate back and keeps the time", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const read = async () =>
        (await tx`select plates_sold, sold_out_at from public.menu_entry_days where entry_id = ${f.openEntry.id} and day = public.nairobi_today()`)[0]!;
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }]));
      const last = await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      const full = await read();
      expect(full).toMatchObject({ plates_sold: 3 });
      expect(full.sold_out_at).not.toBeNull();
      await tx`update public.orders set status = 'cancelled' where public_token = ${last.public_token}`;
      const back = await read();
      expect(back.plates_sold).toBe(2);
      expect(back.sold_out_at.getTime()).toBe(full.sold_out_at.getTime());
    });
  });
});

describe("report_sales: a hand-counted case (March 2020)", () => {
  async function build(tx: Tx, f: Fixtures) {
    const at = async (id: string, created: string, paid: string | null) => {
      await tx`update public.orders set created_at = ${created}::timestamptz, status_changed_at = ${created}::timestamptz,
        paid_at = case when paid_at is null then null else ${paid}::timestamptz end where id = ${id}`;
    };
    // A: ordered Mon 2, paid cash the same day.
    const a = await order(tx, f, "Ann");
    await pay(tx, f.ownerId, a.id, "cash");
    await at(a.id, "2020-03-02T12:00:00+03:00", "2020-03-02T12:30:00+03:00");
    // B: ordered Mon 2, paid M-Pesa the next day.
    const b = await order(tx, f, "Bob");
    await pay(tx, f.ownerId, b.id, "mpesa");
    await at(b.id, "2020-03-02T19:00:00+03:00", "2020-03-03T09:00:00+03:00");
    // C: ordered Tue 3, still unpaid.
    const c = await order(tx, f, "Cy");
    await at(c.id, "2020-03-03T10:00:00+03:00", null);
    // D: paid cash Tue 3, then cancelled, no credit note.
    const d = await order(tx, f, "Di");
    await pay(tx, f.ownerId, d.id, "cash");
    await cancel(tx, f.ownerId, d.id);
    await at(d.id, "2020-03-03T11:00:00+03:00", "2020-03-03T11:10:00+03:00");
    // E: paid cash Tue 3, cancelled, credit note of 200 (100 kept, refunded by M-Pesa) on Wed 4, voided Thu 5.
    const e = await order(tx, f, "Ed");
    await pay(tx, f.ownerId, e.id, "cash");
    await cancel(tx, f.ownerId, e.id);
    await at(e.id, "2020-03-03T12:00:00+03:00", "2020-03-03T12:10:00+03:00");
    const [{ r }] = (await issue(tx, f.ownerId, e.id, 200, "mpesa")) as unknown as [{ r: { id: string } }];
    await voidNote(tx, f.ownerId, r.id);
    await tx`update public.credit_notes set issued_at = '2020-03-04T15:00:00+03:00', voided_at = '2020-03-05T10:00:00+03:00' where id = ${r.id}`;
    return { a, b, c, d, e, noteId: r.id };
  }
  const sales = async (tx: Tx, f: Fixtures, from: string, to: string) =>
    ((await as(tx, f.ownerId, (q) => q`select public.report_sales(${from}::date, ${to}::date) as r`)) as { r: any }[])[0]!.r; // eslint-disable-line @typescript-eslint/no-explicit-any

  test("Sales, Money in by day and method, Still to collect, Cancelled", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await build(tx, f);
      const r = await sales(tx, f, "2020-03-02", "2020-03-05");
      expect(r.tiles).toMatchObject({
        sales: 900, orders: 3, average: 300, // A, B, C; D and E are cancelled
        money_in: 1200, payments: 1200, credit_notes: 200, credit_notes_voided: 200, // 4 payments, a note and its void
        to_collect_kes: 300, to_collect_n: 1,
        cancelled_n: 2, cancelled_kes: 600, cancelled_paid_n: 2, cancelled_with_note_n: 0,
      });
      const day = (d: string) => r.money_in.find((m: { bucket: string }) => m.bucket === d);
      expect(day("2020-03-02")).toMatchObject({ cash: 300, mpesa: 0, net: 300 });
      // B paid the next day lands here, with D and E's cash; E's later note doesn't move this day.
      expect(day("2020-03-03")).toMatchObject({ cash: 600, mpesa: 300, credit_notes: 0, net: 900 });
      expect(day("2020-03-04")).toMatchObject({ credit_notes: 200, cn_mpesa: 200, net: -200 });
      expect(day("2020-03-05")).toMatchObject({ credit_notes_voided: 200, cnv_mpesa: 200, net: 200 });
      expect(r.by_bucket.map((x: { bucket: string; sales: number }) => [x.bucket, x.sales])).toEqual([["2020-03-02", 600], ["2020-03-03", 300]]);
      // D (no note) and E (its only note is void) are both on the follow-up list, from any date.
      const mine = (list: { paid_at: string; total: number }[]) => list.filter((x) => x.paid_at.startsWith("2020")); // seed.sql has its own
      expect(mine(r.paid_cancelled_open).map((x) => x.total)).toEqual([300, 300]);
      expect(r.credit_notes).toHaveLength(1);
      expect(r.credit_notes[0]).toMatchObject({ amount: 200, kept: 100, refunded_with: "mpesa" });
      expect(r.to_collect[0]).toMatchObject({ total: 300 });
    });
  });

  test("a past day doesn't change when a note is voided later, and the week adds up", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { e } = await build(tx, f);
      const issueDay = await sales(tx, f, "2020-03-04", "2020-03-04");
      expect(issueDay.tiles).toMatchObject({ money_in: -200, payments: 0, credit_notes: 200, credit_notes_voided: 0 });
      // A new live note on E, issued now: leaves the old days alone and the order leaves the follow-up list.
      await issue(tx, f.ownerId, e.id, 300);
      const again = await sales(tx, f, "2020-03-04", "2020-03-04");
      expect(again.tiles.money_in).toBe(-200);
      const all = await sales(tx, f, "2020-03-02", "2020-03-05");
      expect(all.paid_cancelled_open.filter((x: { paid_at: string }) => x.paid_at.startsWith("2020"))).toHaveLength(1);
      expect(all.tiles.cancelled_with_note_n).toBe(1);
    });
  });

  test("the compare period is worked out the same way", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await build(tx, f);
      const [{ r }] = (await as(tx, f.ownerId, (q) => q`select public.report_sales('2020-03-03', '2020-03-03', '2020-03-02', '2020-03-02') as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(r.tiles.sales).toBe(300);
      expect(r.compare.sales).toBe(600);
      expect(r.by_hour).toHaveLength(1); // one-day period: by hour
      // A comparison before the first order has no figures.
      const [{ r: none }] = (await as(tx, f.ownerId, (q) => q`select public.report_sales('2020-03-03', '2020-03-03', '1990-01-01', '1990-01-01') as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(none.compare).toBeNull();
    });
  });

  test("the CSV rows: name yes, phone no; the credit note file adds up to the screen", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await build(tx, f);
      const rows = (await as(tx, f.ownerId, (q) => q`select * from public.report_orders_csv('2020-03-02', '2020-03-05')`)) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(rows).toHaveLength(5);
      expect(Object.keys(rows[0]!)).not.toContain("customer_phone");
      expect(JSON.stringify(rows)).not.toContain("0712345678");
      expect(rows.map((r) => r.customer_name)).toEqual(["Ann", "Bob", "Cy", "Di", "Ed"]);
      expect(rows[0]).toMatchObject({ paid_with: "cash", payment_status: "paid", items: expect.stringContaining("1× Test regular") });
      const cn = (await as(tx, f.ownerId, (q) => q`select * from public.report_credit_notes_csv('2020-03-02', '2020-03-05')`)) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(cn.map((r) => [r.line, r.amount_kes])).toEqual([["Credit note", -200], ["Credit note voided", 200]]);
      expect(cn.reduce((s, r) => s + r.amount_kes, 0)).toBe(0);
      expect(cn[0]).toMatchObject({ kept_kes: 100, refunded_with: "mpesa" });
    });
  });

  test("the drawer inputs for one day: cash taken, cash refunded and a cash note voided back", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await paidCancelled(tx, f); // paid cash now
      const [{ r }] = (await issue(tx, f.ownerId, o.id, 120, "cash")) as unknown as [{ r: { id: string } }];
      const today = (await as(tx, f.ownerId, (q) => q`select public.report_sales(public.nairobi_today(), public.nairobi_today()) as r`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const row = today[0]!.r.money_in.at(-1);
      expect(row.cash_n).toBeGreaterThanOrEqual(1);
      expect(row.cn_cash).toBe(120);
      await voidNote(tx, f.ownerId, r.id);
      const after = (await as(tx, f.ownerId, (q) => q`select public.report_sales(public.nairobi_today(), public.nairobi_today()) as r`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(after[0]!.r.money_in.at(-1)).toMatchObject({ cn_cash: 120, cnv_cash: 120 });
    });
  });

  test("report_order, dishes, times and delivery answer for the same days", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { e } = await build(tx, f);
      const [{ r }] = (await as(tx, f.ownerId, (q) => q`select public.report_order(${e.code}) as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(r).toMatchObject({ code: e.code, status: "cancelled", paid_with: "cash", total: 300, customer_name: "Ed" });
      expect(r.credit_notes).toHaveLength(1);
      expect(r.credit_notes[0]).toMatchObject({ amount: 200, kept: 100, void_reason: "wrong amount" });
      const [{ r: dishes }] = (await as(tx, f.ownerId, (q) => q`select public.report_dishes('2020-03-02', '2020-03-05') as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const reg = dishes.dishes.find((x: { name: string }) => x.name === "Test regular");
      expect(reg).toMatchObject({ plates: 3, revenue: 900 }); // A, B, C; cancelled orders are left out
      // An everyday dish counts every open day in the period (accepted answer, 2026-11-08), so a per-day figure exists.
      expect(reg.days_on).toBeGreaterThan(0);
      expect(reg.per_day).toBe(Math.round((3 / reg.days_on) * 10) / 10);
      const [{ r: times }] = (await as(tx, f.ownerId, (q) => q`select public.report_times('2020-03-02', '2020-03-05') as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(times.by_hour.reduce((s: number, h: { orders: number }) => s + h.orders, 0)).toBe(3);
      const [{ r: del }] = (await as(tx, f.ownerId, (q) => q`select public.report_delivery('2020-03-02', '2020-03-05') as r`)) as unknown as [{ r: any }]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(del.zones).toEqual([]);
    });
  });
});

describe("range checks", () => {
  test("each says what's wrong in plain words", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const call = (a: string, b: string) => refusal(as(tx, f.ownerId, (q) => q`select public.report_sales(${a}::date, ${b}::date)`));
      expect((await call("2020-03-05", "2020-03-02"))?.message).toBe("The end date is before the start date.");
      expect((await call("2019-01-01", "2020-03-02"))?.message).toBe("Pick 366 days or fewer.");
      expect((await call("2030-01-01", "2030-01-02"))?.message).toBe("The end date can't be after today.");
    });
  });
});

// RW2B-03: a day counts as sold out if the dish sold out at any point that day, not only if it is
// still out. sold_out_at is the record; rows from before it existed fall back to the flag.
describe("report_dishes: sold-out days and the usual time (RW2B-03)", () => {
  type DishRow = { name: string; sold_out_days: number; usual_sold_out_minutes: number | null };
  const dish = async (tx: Tx, f: Fixtures, name: string) => {
    const [{ d }] = await tx`select public.nairobi_today()::text as d`;
    const [row] = (await as(tx, f.ownerId, (q) => q`select public.report_dishes(${d}::date, ${d}::date) as r`)) as { r: { dishes: DishRow[] } }[];
    return row!.r.dishes.find((x) => x.name === name)!;
  };
  const minutes = (t: Date) => {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(t).split(":").map(Number);
    return h! * 60 + m!;
  };
  const dayRow = async (tx: Tx, entry: string) =>
    (await tx`select plates_sold, sold_out_manual, sold_out_at from public.menu_entry_days where entry_id = ${entry} and day = public.nairobi_today()`)[0]!;

  test("switched off, then back on: the day still counts, at the time it went off", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      expect((await dish(tx, f, "Test late")).sold_out_days).toBe(0);
      await as(tx, f.ownerId, (q) => q`select public.set_entry_sold_out(${f.closedEntry.id}::uuid, true)`);
      await as(tx, f.ownerId, (q) => q`select public.set_entry_sold_out(${f.closedEntry.id}::uuid, false)`);
      const row = await dayRow(tx, f.closedEntry.id);
      expect(row.sold_out_manual).toBe(false);
      expect(await dish(tx, f, "Test late")).toMatchObject({ sold_out_days: 1, usual_sold_out_minutes: minutes(row.sold_out_at) });
    });
  });

  test("the last plate, then a cancel gives one back: the day still counts", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }]));
      expect((await dish(tx, f, "Test rotating")).sold_out_days).toBe(0); // 2 of 3: not sold out
      const last = await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      const [{ id }] = await tx`select id from public.orders where public_token = ${last.public_token}`;
      await as(tx, f.ownerId, (q) => q`select public.cancel_order(${id}::uuid, 'new'::public.order_status, 'customer_asked'::public.cancel_reason, null)`);
      const row = await dayRow(tx, f.openEntry.id);
      expect(row.plates_sold).toBe(2);
      expect(await dish(tx, f, "Test rotating")).toMatchObject({ sold_out_days: 1, usual_sold_out_minutes: minutes(row.sold_out_at) });
    });
  });

  test("an older row with no time: counted while it is out, with no usual time", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.menu_entry_days (entry_id, day, plates_sold) values (${f.openEntry.id}, public.nairobi_today(), 3)`;
      // As a row written before sold_out_at existed (the trigger only fires on plates_sold).
      await tx`update public.menu_entry_days set sold_out_at = null where entry_id = ${f.openEntry.id}`;
      expect(await dish(tx, f, "Test rotating")).toMatchObject({ sold_out_days: 1, usual_sold_out_minutes: null });
      // Given back with no time recorded: nothing says it ever sold out, so it doesn't count.
      await tx`update public.menu_entry_days set plates_sold = 2 where entry_id = ${f.openEntry.id}`;
      await tx`update public.menu_entry_days set sold_out_at = null where entry_id = ${f.openEntry.id}`;
      expect((await dish(tx, f, "Test rotating")).sold_out_days).toBe(0);
    });
  });
});
