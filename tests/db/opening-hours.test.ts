// Opening hours (slice 2.2, spec-2.2-opening-hours.md): the rules in kitchen_status_at at exact
// boundaries, place_order refusing while closed, the owner-only writes, regular dishes coming
// back the next day, pickup times, and the till line. Each test failed before these migrations.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Status = {
  state: "open" | "closed";
  reason: string | null;
  today: string;
  opens_at: string | null;
  last_order_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  next_open_date: string | null;
  next_opens_at: string | null;
  after_today_open_date: string | null;
  after_today_opens_at: string | null;
};

// A Thursday far from today, so close early (which stores today's date) can be set by hand.
const D = "2030-01-10";
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A Nairobi wall-clock moment. */
const at = (day: string, time: string) => `${day} ${time}+03`;
const iso = (s: string | null) => (s ? new Date(s).toISOString() : null);

async function statusAt(tx: TransactionSQL, moment: string) {
  const [row] = await tx`select public.kitchen_status_at(${moment}::timestamptz) as s`;
  return row.s as Status;
}

/** Every day open 11:00–21:00, last orders 30 min before, nothing closed. */
async function thursdayWeek(tx: TransactionSQL) {
  await tx`update public.opening_hours set is_open = true, opens = '11:00', closes = '21:00'`;
  await tx`update public.kitchen_settings set last_orders_minutes = 30, closed_early_on = null, closed_early_at = null`;
  await tx`delete from public.closed_dates`;
}
const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

describe("kitchen_status_at: the rules", () => {
  test("Thursday 11:00–21:00, last orders 20:30: the exact boundaries", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      const cases: [string, "open" | "closed", string | null][] = [
        ["10:59:59", "closed", "before_opening"],
        ["11:00:00", "open", null],
        ["20:30:59", "open", null],
        ["20:31:00", "closed", "past_last_orders"],
        ["20:59:59", "closed", "past_last_orders"],
        ["21:00:00", "closed", "after_closing"],
      ];
      for (const [time, state, reason] of cases) {
        const s = await statusAt(tx, at(D, time));
        expect({ time, state: s.state, reason: s.reason }).toEqual({ time, state, reason });
      }
      const s = await statusAt(tx, at(D, "12:00:00"));
      expect(iso(s.last_order_at)).toBe(iso(at(D, "20:30:00")));
      expect(iso(s.closes_at)).toBe(iso(at(D, "21:00:00")));
    }));

  test("next opening: today before opening, tomorrow once open or past last orders", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      const early = await statusAt(tx, at(D, "09:00:00"));
      expect([early.next_open_date, iso(early.next_opens_at)]).toEqual([D, iso(at(D, "11:00:00"))]);
      expect(early.after_today_open_date).toBe(plus(D, 1));
      for (const time of ["12:00:00", "20:31:00", "22:00:00"]) {
        const s = await statusAt(tx, at(D, time));
        expect([s.next_open_date, iso(s.next_opens_at)]).toEqual([plus(D, 1), iso(at(plus(D, 1), "11:00:00"))]);
      }
    }));

  test("last orders at 15 and at closing time", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.kitchen_settings set last_orders_minutes = 15`;
      expect((await statusAt(tx, at(D, "20:45:59"))).state).toBe("open");
      expect((await statusAt(tx, at(D, "20:46:00"))).reason).toBe("past_last_orders");
      await tx`update public.kitchen_settings set last_orders_minutes = 0`;
      expect((await statusAt(tx, at(D, "21:00:59"))).state).toBe("open");
      expect((await statusAt(tx, at(D, "21:01:00"))).reason).toBe("after_closing");
    }));

  test("a closed day is closed all day, and the next opening skips it", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.opening_hours set is_open = false where weekday = ${dow(D)}`;
      const s = await statusAt(tx, at(D, "12:00:00"));
      expect([s.state, s.reason, s.closes_at, s.next_open_date]).toEqual(["closed", "closed_day", null, plus(D, 1)]);
      const before = await statusAt(tx, at(plus(D, -1), "22:00:00"));
      expect(before.next_open_date).toBe(plus(D, 1));
    }));

  test("a closed date is closed all day, and the next opening skips it", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`insert into public.closed_dates (day, note) values (${D}, 'Christmas Day'), (${plus(D, 1)}, null)`;
      const s = await statusAt(tx, at(D, "12:00:00"));
      expect([s.state, s.reason, s.next_open_date]).toEqual(["closed", "closed_date", plus(D, 2)]);
      expect(JSON.stringify(s)).not.toContain("Christmas");
    }));

  test("closed early: closed until closing, then a normal day tomorrow", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.kitchen_settings set closed_early_on = ${D}, closed_early_at = ${at(D, "12:40:00")}::timestamptz`;
      const noon = await statusAt(tx, at(D, "13:00:00"));
      expect([noon.state, noon.reason, noon.next_open_date]).toEqual(["closed", "closed_early", plus(D, 1)]);
      expect(iso(noon.closed_early_at)).toBe(iso(at(D, "12:40:00")));
      // "Close today" before opening: today no longer counts as the next opening.
      const morning = await statusAt(tx, at(D, "09:00:00"));
      expect([morning.reason, morning.next_open_date]).toEqual(["closed_early", plus(D, 1)]);
      expect((await statusAt(tx, at(D, "21:00:00"))).reason).toBe("after_closing");
      const tomorrow = await statusAt(tx, at(plus(D, 1), "12:00:00"));
      expect([tomorrow.state, tomorrow.closed_early_at]).toEqual(["open", null]);
    }));

  test("close early with the next day switched off names the day after", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.opening_hours set is_open = false where weekday = ${dow(plus(D, 1))}`;
      await tx`update public.kitchen_settings set closed_early_on = ${D}, closed_early_at = ${at(D, "12:40:00")}::timestamptz`;
      const s = await statusAt(tx, at(D, "13:00:00"));
      expect([s.next_open_date, s.after_today_open_date]).toEqual([plus(D, 2), plus(D, 2)]);
    }));

  test("the midnight edge: closing at 24:00 takes orders to 23:59:59, then it's the next day", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.opening_hours set opens = '23:00', closes = '24:00' where weekday = ${dow(D)}`;
      await tx`update public.kitchen_settings set last_orders_minutes = 0`;
      const late = await statusAt(tx, at(D, "23:59:59"));
      expect([late.state, iso(late.closes_at)]).toEqual(["open", iso(at(plus(D, 1), "00:00:00"))]);
      const midnight = await statusAt(tx, at(plus(D, 1), "00:00:00"));
      expect([midnight.today, midnight.reason, midnight.next_open_date]).toEqual([plus(D, 1), "before_opening", plus(D, 1)]);
    }));

  test("every day switched off: closed, with no next opening", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.opening_hours set is_open = false`;
      const s = await statusAt(tx, at(D, "12:00:00"));
      expect([s.reason, s.next_open_date, s.next_opens_at, s.after_today_open_date]).toEqual(["closed_day", null, null, null]);
    }));

  test("the look-ahead stops at 60 days", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      await thursdayWeek(tx);
      await tx`update public.opening_hours set is_open = (weekday = ${dow(D)})`;
      // Only Thursdays open; close the next eight (days 7 to 56), leaving day 63 as the next.
      for (let n = 7; n <= 56; n += 7) await tx`insert into public.closed_dates (day) values (${plus(D, n)})`;
      expect((await statusAt(tx, at(D, "22:00:00"))).next_open_date).toBeNull();
      await tx`delete from public.closed_dates where day = ${plus(D, 56)}`;
      expect((await statusAt(tx, at(D, "22:00:00"))).next_open_date).toBe(plus(D, 56));
    }));

  test("the hours table refuses less than an hour, and a closing past midnight", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      for (const [opens, closes] of [["11:00", "11:59"], ["23:30", "00:30"], ["21:00", "11:00"]]) {
        const err = await tx.savepoint((sp) => sp`update public.opening_hours set opens = ${opens}, closes = ${closes} where weekday = 1`).catch((e) => e);
        expect(err?.errno ?? err?.code).toBe("23514");
      }
    }));
});

// ───────────────────────── place_order, at the real clock ─────────────────────────

async function nairobiNow(tx: TransactionSQL) {
  const [row] = await tx`select to_char(public.nairobi_time(), 'HH24:MI') as t, extract(dow from public.nairobi_today())::int as dow, public.nairobi_today()::text as today`;
  return row as { t: string; dow: number; today: string };
}
async function orderCount(tx: TransactionSQL) {
  const [row] = await tx`select count(*)::int as n from public.orders`;
  return row.n as number;
}
async function zone(tx: TransactionSQL) {
  const [z] = await tx`insert into public.delivery_zones (name, fee_kes) values ('Test zone', 150) returning id`;
  return z.id as string;
}
/** One payload per order type and dish kind. */
function everyKind(f: Fixtures, zoneId: string) {
  const lines = {
    regular: [{ dish_id: f.regular.id, quantity: 1 }],
    rotating: [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }],
  };
  return Object.entries(lines).flatMap(([kind, items]) => [
    { label: `dine-in ${kind}`, payload: dineIn(f, items) },
    { label: `pickup ${kind}`, payload: { ...dineIn(f, items), mode: "pickup", table_token: undefined } },
    {
      label: `delivery ${kind}`,
      payload: { ...dineIn(f, items), mode: "delivery", table_token: undefined, delivery_zone_id: zoneId, delivery_address: "Test street 1" },
    },
  ]);
}
async function expectRefusedEverywhere(tx: TransactionSQL, f: Fixtures) {
  const z = await zone(tx);
  const before = await orderCount(tx);
  for (const { label, payload } of everyKind(f, z)) {
    const err = await placeOrder(tx, payload).catch((e) => e);
    expect({ label, detail: err?.detail, message: err?.message }).toEqual({ label, detail: "kitchen_closed", message: "The kitchen is closed" });
  }
  expect(await orderCount(tx)).toBe(before);
  const [plates] = await tx`select coalesce(sum(plates_sold), 0)::int as n from public.menu_entry_days where entry_id = ${f.openEntry.id}`;
  expect(plates.n).toBe(0);
}

describe("place_order: refuses while the kitchen is closed", () => {
  test("open (the fixtures' all-day hours): every order type and dish kind is accepted", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const z = await zone(tx);
      for (const { payload } of everyKind(f, z)) await placeOrder(tx, payload);
    }));

  test("closed day", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.opening_hours set is_open = false where weekday = ${(await nairobiNow(tx)).dow}`;
      await expectRefusedEverywhere(tx, f);
    }));

  test("closed date", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`insert into public.closed_dates (day) values (public.nairobi_today())`;
      await expectRefusedEverywhere(tx, f);
    }));

  test("closed early", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.close_early()`);
      await expectRefusedEverywhere(tx, f);
    }));

  // These two need a clock between 01:01 and 23:00 Nairobi time to set hours around now.
  const t = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(11, 16);
  const midDay = t >= "01:01" && t < "22:59";

  test.skipIf(!midDay)("before opening", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.opening_hours set opens = '23:00', closes = '24:00' where weekday = ${(await nairobiNow(tx)).dow}`;
      await expectRefusedEverywhere(tx, f);
    }));

  test.skipIf(!midDay)("past last orders", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.opening_hours set opens = '00:00', closes = '01:00' where weekday = ${(await nairobiNow(tx)).dow}`;
      await tx`update public.kitchen_settings set last_orders_minutes = 0`;
      await expectRefusedEverywhere(tx, f);
    }));

  test("a retry of an order that went through gets it back after closing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const payload = dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]);
      const first = await placeOrder(tx, payload);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.close_early()`);
      expect(await placeOrder(tx, payload)).toMatchObject({ public_token: first.public_token, replayed: true });
    }));

  test("close early, then reopen: orders are accepted again", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [closed] = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.close_early() as s`);
      expect(closed!.s.reason).toBe("closed_early");
      const [open] = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.reopen_today() as s`);
      expect(open!.s.state).toBe("open");
      await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
    }));

  test("closing early twice keeps the first time", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set closed_early_on = public.nairobi_today(), closed_early_at = '2020-01-01'`;
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.close_early()`);
      const [row] = await tx`select closed_early_at = '2020-01-01' as kept from public.kitchen_settings`;
      expect(row.kept).toBe(true);
    }));

  test.skipIf(!midDay)("close early is refused once today's closing has passed", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.opening_hours set opens = '00:00', closes = '01:00' where weekday = ${(await nairobiNow(tx)).dow}`;
      const err = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.close_early()`).catch((e) => e);
      expect(err?.message).toBe("The kitchen is already closed for today");
    }));

  test("anyone can read the status; customers can't call the dated version", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const [row] = await attempt(tx, "anon", null, (sp) => sp`select public.kitchen_status() as s`);
      expect(row!.s.state).toBe("open");
      const err = await attempt(tx, "anon", null, (sp) => sp`select public.kitchen_status_at(now())`).catch((e) => e);
      expect(err?.errno ?? err?.code).toBe("42501");
    }));
});

// ───────────────────────── who can change what ─────────────────────────

async function staffMember(tx: TransactionSQL) {
  const [u] = await tx`insert into auth.users (email) values ('staff@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Test staff')`;
  return u.id as string;
}
const code = (e: { errno?: string; code?: string } | undefined) => e?.errno ?? e?.code;

describe("opening hours: only the owner changes them", () => {
  test("staff can read, but not write hours, closed dates or settings, or close and reopen", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const staff = await staffMember(tx);
      const as = (fn: Parameters<typeof attempt>[3]) => attempt(tx, "authenticated", staff, fn).catch((e) => e);

      expect((await as((sp) => sp`select count(*)::int as n from public.opening_hours`))[0].n).toBe(7);
      expect(await as((sp) => sp`update public.opening_hours set is_open = false returning weekday`)).toEqual([]);
      expect(code(await as((sp) => sp`insert into public.closed_dates (day) values ('2030-12-25')`))).toBe("42501");
      expect(await as((sp) => sp`update public.kitchen_settings set till_number = '999999' returning id`)).toEqual([]);
      for (const call of [
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select public.close_early()`,
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select public.reopen_today()`,
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select public.set_till_number('123456')`,
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) =>
          sp`select public.save_opening_hours((select jsonb_agg(to_jsonb(h)) from public.opening_hours h), 30)`,
      ]) {
        expect(code(await as(call))).toBe("42501");
      }
      const [row] = await tx`select till_number, closed_early_on from public.kitchen_settings`;
      expect(row).toEqual({ till_number: null, closed_early_on: null });
    }));

  test("customers can't read the tables or call the owner RPCs", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      for (const q of [
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select * from public.closed_dates`,
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select * from public.kitchen_settings`,
        (sp: Parameters<Parameters<typeof attempt>[3]>[0]) => sp`select public.close_early()`,
      ]) {
        expect(code(await attempt(tx, "anon", null, q).catch((e) => e))).toBe("42501");
      }
    }));

  test("the owner saves the week and last orders together", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_open: weekday !== 0, opens: "10:00", closes: "22:00" }));
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.save_opening_hours(${JSON.stringify(days)}::text::jsonb, 15)`);
      const rows = await tx`select weekday, is_open, opens::text, closes::text from public.opening_hours order by weekday`;
      expect(rows[0]).toEqual({ weekday: 0, is_open: false, opens: "10:00:00", closes: "22:00:00" });
      const [s] = await tx`select last_orders_minutes from public.kitchen_settings`;
      expect(s.last_orders_minutes).toBe(15);
    }));

  test("a bad week saves nothing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_open: true, opens: "10:00", closes: weekday === 3 ? "10:30" : "22:00" }));
      const err = await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.save_opening_hours(${JSON.stringify(days)}::text::jsonb, 15)`).catch((e) => e);
      expect(err?.message).toBe("Closing must be at least 1 hour after opening, and by midnight.");
      const [row] = await tx`select count(*)::int as n from public.opening_hours where opens = '10:00'`;
      expect(row.n).toBe(0);
    }));

  test("the owner sets and removes the till number; a wrong format is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const set = (v: string | null) =>
        attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.set_till_number(${v}) as t`).catch((e) => e);
      expect((await set("123456"))[0].t).toBe("123456");
      for (const bad of ["1234", "12345678901", "123 456", "12a456"]) {
        expect((await set(bad))?.message).toBe("A till number is 5 to 10 digits, with no spaces.");
      }
      expect((await set(""))[0].t).toBeNull();
      const [row] = await tx`select till_number from public.kitchen_settings`;
      expect(row.till_number).toBeNull();
    }));
});

// ───────────────────────── regular dishes, pickup, till line ─────────────────────────

describe("regular dishes: sold out for today only", () => {
  test("switched off today: refused today", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.set_regular_on_sale(${f.regular.id}::uuid, false)`);
      const err = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }])).catch((e) => e);
      expect(err?.message).toBe("Test regular is not available today");
    }));

  test("switched off yesterday: back on sale today with nothing done", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.dishes set unavailable_on = public.nairobi_today() - 1 where id = ${f.regular.id}`;
      const [row] = await tx`select public.regular_on_sale(unavailable_on) as on_sale from public.dishes where id = ${f.regular.id}`;
      expect(row.on_sale).toBe(true);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
    }));

  test("anon can't toggle a dish", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const err = await attempt(tx, "anon", null, (sp) => sp`select public.set_regular_on_sale(${f.regular.id}::uuid, false)`).catch((e) => e);
      expect(code(err)).toBe("42501");
    }));
});

describe("place_order: pickup time within today's hours", () => {
  const pickup = (f: Fixtures, pickupAt: string) => ({
    ...dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]),
    mode: "pickup",
    table_token: undefined,
    pickup_at: pickupAt,
  });

  test("another day is refused, naming the closing time", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx); // closes at midnight
      const [row] = await tx`select (public.nairobi_today() + 1 + time '12:00') at time zone 'Africa/Nairobi' as t`;
      const err = await placeOrder(tx, pickup(f, new Date(row.t).toISOString())).catch((e) => e);
      expect([err?.message, err?.detail]).toEqual(["We close at midnight. Pick an earlier time.", "pickup_time"]);
    }));

  const t = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(11, 16);
  test.skipIf(!(t >= "00:00" && t < "21:30"))("after closing is refused; up to closing is accepted", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.opening_hours set opens = '00:00', closes = '23:00' where weekday = extract(dow from public.nairobi_today())`;
      const moment = async (time: string) => {
        const [row] = await tx`select (public.nairobi_today() + ${time}::time) at time zone 'Africa/Nairobi' as t`;
        return new Date(row.t).toISOString();
      };
      const err = await placeOrder(tx, pickup(f, await moment("23:00:01"))).catch((e) => e);
      expect([err?.message, err?.detail]).toEqual(["We close at 23:00. Pick an earlier time.", "pickup_time"]);
      await placeOrder(tx, pickup(f, await moment("23:00:00")));
    }));

  test("a passed time carries the same detail", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const err = await placeOrder(tx, pickup(f, new Date(Date.now() - 3_600_000).toISOString())).catch((e) => e);
      expect(err?.detail).toBe("pickup_time");
    }));
});

describe("get_order_status: the till line", () => {
  test("shown on an unpaid order, not on a paid or cancelled one, and gone when removed", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.set_till_number('123456')`);
      const place = async () => {
        const placed = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
        const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
        return { token: placed.public_token, id: row.id as string };
      };
      const till = async (token: string) => {
        const [row] = await attempt(tx, "anon", null, (sp) => sp`select public.get_order_status(${token}::uuid) as s`);
        return row!.s.till_number as string | null;
      };
      const unpaid = await place();
      const paid = await place();
      const cancelled = await place();
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.mark_order_paid(${paid.id}::uuid, 'cash')`);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.cancel_order(${cancelled.id}::uuid, 'new'::public.order_status, 'too_busy')`);
      expect([await till(unpaid.token), await till(paid.token), await till(cancelled.token)]).toEqual(["123456", null, null]);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.set_till_number(null)`);
      expect(await till(unpaid.token)).toBeNull();
    }));
});
