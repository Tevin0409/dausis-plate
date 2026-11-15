// Slice 2.11 part C: discount codes (spec-2.11-ads-promos.md, "Tests: Codes"). The owner side
// (save_discount_code, discount_code_action, the used-code lock, History, code_figures), the shared
// checks behind check_discount_code, and who can read what. Uses are simulated with orders written
// directly; place_order's code path is tested once it learns codes, on the composed wave-2 definition.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Q = Parameters<Parameters<typeof attempt>[3]>[0];
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const run = (tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<Row[]>) => attempt(tx, sub ? "authenticated" : "anon", sub, fn);

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

type Code = Partial<{
  id: string; code: string; kind: "percent" | "amount"; value: number; cap_kes: number | null;
  starts_on: string; ends_on: string; max_uses: number | null; once_per_phone: boolean;
  min_order_kes: number | null; modes: string[];
}>;
const days = (n: number) => new Date(Date.now() + 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10); // Nairobi is UTC+3
const karibu = (over: Code = {}): Code => ({ code: "karibu10", kind: "percent", value: 10, cap_kes: 300, ends_on: days(30), ...over });

async function save(tx: Tx, sub: string, c: Code) {
  const [r] = await run(tx, sub, (q) => q`select public.save_discount_code(${JSON.stringify(c)}::text::jsonb) id`);
  return r!.id as string;
}
const trySave = (tx: Tx, sub: string | null, c: Code) =>
  as(tx, sub, (q) => q`select public.save_discount_code(${JSON.stringify(c)}::text::jsonb)`);

async function check(tx: Tx, code: string, food: number, covered: number, mode: string | null = null, phone: string | null = null) {
  const [r] = await run(tx, null, (q) => q`select * from public.check_discount_code(${code}, ${food}, ${covered}, ${mode}::public.order_mode, ${phone})`);
  return r!;
}

/** An order that used the code (written directly until place_order takes codes). */
async function use(tx: Tx, f: Fixtures, codeId: string, o: { phone?: string; status?: string; subtotal?: number; discount?: number } = {}) {
  const subtotal = o.subtotal ?? 1000;
  const discount = o.discount ?? 100;
  const [r] = await tx`
    insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, status,
                               subtotal_kes, discount_kes, total_kes, discount_code_id)
    values ('dine_in', ${f.table.id}, 'Wanjiru', ${o.phone ?? "0712345678"}, 'on_handover', ${o.status ?? "new"}::public.order_status,
            ${subtotal}, ${discount}, ${subtotal - discount}, ${codeId})
    returning id`;
  return r!.id as string;
}

describe("save_discount_code", () => {
  test("only the owner can save; staff, anon and direct writes are refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [u] = await tx`insert into auth.users (email) values ('staff@test.local') returning id`;
      await tx`insert into public.staff (user_id, role, display_name) values (${u!.id}, 'staff', 'Test staff')`;
      expect(await trySave(tx, u!.id, karibu())).toMatchObject({ code: "42501" });
      expect(await trySave(tx, null, karibu())).toMatchObject({ code: "42501" });
      expect(await as(tx, f.ownerId, (q) => q`insert into public.discount_codes (code, kind, value, cap_kes, ends_on) values ('X123', 'amount', 100, null, ${days(3)})`))
        .toMatchObject({ code: "42501" });
      const id = await save(tx, f.ownerId, karibu());
      const [row] = await tx`select *, modes::text[] modes from public.discount_codes where id = ${id}`;
      expect(row).toMatchObject({ code: "KARIBU10", kind: "percent", value: 10, cap_kes: 300, once_per_phone: true, active: true, max_uses: null });
      expect(row!.modes).toEqual(["dine_in", "pickup", "delivery"]);
      expect(await as(tx, f.ownerId, (q) => q`update public.discount_codes set value = 50 where id = ${id}`)).toMatchObject({ code: "42501" });
      const [after] = await tx`select value from public.discount_codes where id = ${id}`;
      expect(after!.value).toBe(10);
    }));

  test("each field is checked, with the field named", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await save(tx, f.ownerId, karibu());
      const cases: [Code, string][] = [
        [karibu({ code: "ab" }), "code_code"],
        [karibu({ code: "karibu-10" }), "code_code"],
        [karibu({ code: "A".repeat(21) }), "code_code"],
        [karibu({ code: " Karibu10 " }), "code_taken"],
        [karibu({ code: "PCT91", value: 91 }), "code_value"],
        [karibu({ code: "PCT0", value: 0 }), "code_value"],
        [karibu({ code: "NOCAP", cap_kes: null }), "code_cap"],
        [{ code: "AMT5", kind: "amount", value: 5, ends_on: days(3) }, "code_value"],
        [{ code: "AMT6K", kind: "amount", value: 5001, ends_on: days(3) }, "code_value"],
        [karibu({ code: "NOEND", ends_on: "" }), "code_dates"],
        [karibu({ code: "BACKWARDS", starts_on: days(5), ends_on: days(2) }), "code_dates"],
        [karibu({ code: "PAST", starts_on: days(-5), ends_on: days(-1) }), "code_dates"],
        [karibu({ code: "USES0", max_uses: 0 }), "code_max_uses"],
        [karibu({ code: "MIN0", min_order_kes: 0 }), "code_min_order"],
        [karibu({ code: "NOMODES", modes: [] }), "code_modes"],
        [karibu({ code: "BADMODE", modes: ["takeaway"] }), "code_modes"],
      ];
      for (const [c, detail] of cases) expect([c.code, (await trySave(tx, f.ownerId, c))?.detail]).toEqual([c.code, detail]);
      expect(await trySave(tx, f.ownerId, karibu({ code: "TAKEN2" }))).toBeNull();
      expect((await trySave(tx, f.ownerId, karibu({ code: "karibu10" })))?.message).toBe("KARIBU10 is taken. Pick another code.");
      // A fixed amount drops any cap; it starts today by default.
      const id = await save(tx, f.ownerId, { code: "MIA", kind: "amount", value: 100, cap_kes: 300, ends_on: days(3) });
      const [row] = await tx`select cap_kes, starts_on = public.nairobi_today() today from public.discount_codes where id = ${id}`;
      expect(row).toEqual({ cap_kes: null, today: true });
    }));

  test("a used code keeps what it gives; limits, dates and on/off still change", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, karibu({ max_uses: 50 }));
      // Before any use, everything can change.
      expect(await trySave(tx, f.ownerId, karibu({ id, value: 15 }))).toBeNull();
      await use(tx, f, id);
      await use(tx, f, id, { phone: "0722000000" });
      for (const c of [karibu({ id, value: 20 }), karibu({ id, cap_kes: 400 }), karibu({ id, code: "KARIBU20" }), { ...karibu({ id }), kind: "amount" as const, value: 100 }]) {
        expect(await trySave(tx, f.ownerId, c)).toMatchObject({ detail: "code_used", message: "Used 2 times, so what it gives can’t change. Make a new code instead." });
      }
      expect(await trySave(tx, f.ownerId, karibu({ id, value: 15, max_uses: 80, ends_on: days(60), once_per_phone: false, min_order_kes: 800, modes: ["pickup"] }))).toBeNull();
      // The trigger backs it up for any other path.
      await expect(tx.savepoint((sp) => sp`update public.discount_codes set value = 50 where id = ${id}`)).rejects.toThrow("what it gives can’t change");
      expect(await as(tx, f.ownerId, (q) => q`select public.discount_code_action(${id}, 'off')`)).toBeNull();
      const [row] = await tx`select active, value, max_uses, min_order_kes from public.discount_codes where id = ${id}`;
      expect(row).toEqual({ active: false, value: 15, max_uses: 80, min_order_kes: 800 });
    }));

  test("History: created, edited only when something changed, on and off once each", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, karibu());
      await save(tx, f.ownerId, karibu({ id })); // no change
      await save(tx, f.ownerId, karibu({ id, ends_on: days(40) }));
      for (const a of ["off", "off", "on", "on"]) await run(tx, f.ownerId, (q) => q`select public.discount_code_action(${id}, ${a})`);
      const log = await tx`select action, subject_label, before->>'ends_on' b, after->>'ends_on' a, after->>'value' v
                           from public.change_log where area = 'promos' and subject_id = ${id} order by id`;
      expect(log.map((r: Row) => r.action)).toEqual(["code.create", "code.edit", "code.off", "code.on"]);
      expect(log[0]).toMatchObject({ subject_label: "KARIBU10", v: "10" });
      expect(log[1]).toMatchObject({ b: days(30), a: days(40) });
      expect(await as(tx, f.ownerId, (q) => q`select public.discount_code_action(gen_random_uuid(), 'on')`)).toMatchObject({ detail: "code_missing" });
    }));
});

describe("check_discount_code", () => {
  test("each refusal reason, in the order the cart meets them", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await save(tx, f.ownerId, karibu({ max_uses: 2, min_order_kes: 800, modes: ["dine_in", "pickup"] }));
      const off = await save(tx, f.ownerId, karibu({ code: "OFFNOW" }));
      await run(tx, f.ownerId, (q) => q`select public.discount_code_action(${off}, 'off')`);
      await save(tx, f.ownerId, karibu({ code: "LATER", starts_on: days(3), ends_on: days(10) }));
      const ended = await save(tx, f.ownerId, karibu({ code: "ENDED" }));
      await tx`update public.discount_codes set starts_on = ${days(-10)}, ends_on = ${days(-1)} where id = ${ended}`;

      expect(await check(tx, "nope99", 1000, 1000)).toMatchObject({ ok: false, reason: "unknown", label: null });
      expect(await check(tx, "x", 1000, 1000)).toMatchObject({ ok: false, reason: "unknown" });
      expect(await check(tx, "offnow", 1000, 1000)).toMatchObject({ ok: false, reason: "off" });
      expect(await check(tx, "later", 1000, 1000)).toMatchObject({ ok: false, reason: "not_started" });
      expect((await check(tx, "later", 1000, 1000)).starts_on.toISOString().slice(0, 10)).toBe(days(3));
      expect(await check(tx, "ended", 1000, 1000)).toMatchObject({ ok: false, reason: "ended" });
      expect(await check(tx, " karibu10 ", 680, 680)).toMatchObject({ ok: false, reason: "min_order", min_order_kes: 800, code: "KARIBU10" });
      expect(await check(tx, "KARIBU10", 900, 0)).toMatchObject({ ok: false, reason: "combos_only" });
      expect(await check(tx, "KARIBU10", 900, 900, "delivery")).toMatchObject({ ok: false, reason: "mode", modes: ["dine_in", "pickup"] });
      expect(await check(tx, "KARIBU10", 900, 900, "pickup")).toMatchObject({ ok: true, reason: null, discount_kes: 90, label: "10% off, up to KSh 300", min_order_kes: null, modes: null });
    }));

  test("uses: used up, cancelled orders give the use back, once per phone on the normalised phone", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, karibu({ max_uses: 2 }));
      await use(tx, f, id, { phone: "0712 345 678" });
      expect(await check(tx, "KARIBU10", 1000, 1000, null, "+254712345678")).toMatchObject({ ok: false, reason: "phone_used" });
      expect(await check(tx, "KARIBU10", 1000, 1000, null, "712345678")).toMatchObject({ ok: false, reason: "phone_used" });
      expect(await check(tx, "KARIBU10", 1000, 1000, null, "0799000000")).toMatchObject({ ok: true });
      const second = await use(tx, f, id, { phone: "0799000000" });
      expect(await check(tx, "KARIBU10", 1000, 1000)).toMatchObject({ ok: false, reason: "used_up" });
      await tx`update public.orders set status = 'cancelled' where id = ${second}`;
      expect(await check(tx, "KARIBU10", 1000, 1000, null, "0799000000")).toMatchObject({ ok: true });
      // Once per phone switched off: the same phone can use it again.
      await save(tx, f.ownerId, karibu({ id, max_uses: 2, once_per_phone: false }));
      expect(await check(tx, "KARIBU10", 1000, 1000, null, "0712345678")).toMatchObject({ ok: true });
    }));

  test("the saving: percentage floors and caps, a fixed amount never exceeds the covered food", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await save(tx, f.ownerId, karibu({ value: 15, cap_kes: 300 }));
      await save(tx, f.ownerId, { code: "MIA", kind: "amount", value: 100, ends_on: days(3) });
      expect(await check(tx, "KARIBU10", 1015, 1015)).toMatchObject({ discount_kes: 152 }); // 152.25 floors
      expect(await check(tx, "KARIBU10", 5000, 3000)).toMatchObject({ discount_kes: 300 }); // capped
      expect(await check(tx, "KARIBU10", 1500, 800)).toMatchObject({ discount_kes: 120 }); // only the covered food
      expect(await check(tx, "MIA", 1000, 1000)).toMatchObject({ discount_kes: 100, label: "KSh 100 off" });
      expect(await check(tx, "MIA", 1000, 60)).toMatchObject({ discount_kes: 60 });
      // A client claiming more covered than food is clamped to the food.
      expect(await check(tx, "MIA", 40, 9999)).toMatchObject({ discount_kes: 40 });
    }));
});

describe("who can read what, and the figures", () => {
  test("anon and staff can't read codes or figures; the owner sees uses, discount given and sales", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, karibu());
      await use(tx, f, id, { subtotal: 1000, discount: 100 });
      await use(tx, f, id, { subtotal: 800, discount: 80, phone: "0722000000" });
      await use(tx, f, id, { subtotal: 600, discount: 60, phone: "0733000000", status: "cancelled" });
      expect(await as(tx, null, (q) => q`select * from public.discount_codes`)).toMatchObject({ code: "42501" });
      expect(await as(tx, null, (q) => q`select * from public.code_figures`)).toMatchObject({ code: "42501" });
      const [u] = await tx`insert into auth.users (email) values ('staff@test.local') returning id`;
      await tx`insert into public.staff (user_id, role, display_name) values (${u!.id}, 'staff', 'Test staff')`;
      expect(await run(tx, u!.id, (q) => q`select * from public.discount_codes`)).toEqual([]);
      expect(await run(tx, u!.id, (q) => q`select * from public.code_figures`)).toEqual([]);
      expect(await run(tx, f.ownerId, (q) => q`select code, uses, discount_given, sales from public.code_figures`))
        .toEqual([{ code: "KARIBU10", uses: 2, discount_given: 180, sales: 1620 }]);
    }));

  test("the order total constraint holds: total = subtotal − discount + delivery", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const id = await save(tx, f.ownerId, karibu());
      await expect(tx.savepoint((sp) => sp`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, subtotal_kes, discount_kes, total_kes, discount_code_id)
        values ('dine_in', ${f.table.id}, 'A', '0712345678', 'on_handover', 1000, 100, 1000, ${id})`)).rejects.toThrow("orders_total");
      await expect(tx.savepoint((sp) => sp`
        insert into public.orders (mode, table_id, customer_name, customer_phone, payment_method, subtotal_kes, discount_kes, total_kes)
        values ('dine_in', ${f.table.id}, 'A', '0712345678', 'on_handover', 100, 200, 0)`)).rejects.toThrow("orders_discount_kes");
    }));
});
