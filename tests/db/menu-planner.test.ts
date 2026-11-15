// Slice 2.5, the menu planner (spec-2.5-menu-planner.md, plan-2.5-menu-planner.md), against
// supabase/migrations/20261110000000_menu_planner.sql. Every call is made as the dashboard makes
// it: an authenticated user, RLS and 2.3's price rule applying. The spec's "supabase/tests" is
// this folder: `bun run test` runs it.
//
// Dates are worked out from Nairobi's today, so the file passes on any day of the week: "next
// week" (Monday `mon` to Sunday) is always wholly in the future, and fixtures for it are written
// directly as the database owner, the way seed.sql does.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, platesSold, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Q = Parameters<Parameters<typeof attempt>[3]>[0];
type Job = "everyday_menu" | "dishes_prices" | "tables_delivery" | "close_early";

async function person(tx: Tx, name: string, jobs: Job[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase()}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job})`;
  return u.id as string;
}

/** Runs `fn` as `sub` and returns its first row; throws the database error as it came. */
async function as<T = Record<string, unknown>>(tx: Tx, sub: string, fn: (q: Q) => PromiseLike<unknown>): Promise<T> {
  const rows = (await attempt(tx, "authenticated", sub, async (q) => (await fn(q)) as Record<string, unknown>[])) as T[];
  return rows[0] as T;
}

type Refusal = { code: string; detail?: string; hint?: string; message: string } | null;
/** Null if `p` succeeded, else the SQLSTATE, detail, hint and message. */
async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { errno?: string; detail?: string; hint?: string; message: string };
    return { code: e.errno ?? "error", detail: e.detail || undefined, hint: e.hint || undefined, message: e.message };
  }
}

const arr = (days: string[]) => `{${days.join(",")}}`;

async function dates(tx: Tx) {
  // RW2B-04: the planner's fixtures own every future menu row. seed.sql (2.8) puts a sample dish on
  // tomorrow's menu, which on a Sunday is next Monday, the planner's day(0). Remove the sample's
  // future rows inside this test's transaction (rolled back after); today's rows stay.
  await tx`delete from public.menu_entries where starts_on > public.nairobi_today()`;
  const [d] = await tx`
    select public.nairobi_today()::text as today,
           (date_trunc('week', public.nairobi_today()) + interval '7 days')::date::text as mon`;
  const plus = (base: string, n: number) => {
    const t = new Date(`${base}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const mon = d.mon as string;
  return { today: d.today as string, mon, day: (n: number) => plus(mon, n), plus };
}

type Dish = { id: string; name: string };
async function dish(tx: Tx, name: string, price = 650, extra: { archived?: boolean; is_regular?: boolean } = {}) {
  const [row] = await tx`
    insert into public.dishes (name, price_kes, archived, is_regular, updated_at)
    values (${name}, ${price}, ${extra.archived ?? false}, ${extra.is_regular ?? false}, '2020-01-01') returning *`;
  return row as Dish;
}

/** A fixture entry, written directly (no API caller, so no checks and no History). */
async function entry(
  tx: Tx,
  dishId: string,
  kind: "day" | "week",
  from: string,
  to = from,
  extra: { price?: number | null; plates?: number | null; published?: boolean; show_from?: string; show_until?: string } = {},
) {
  const [row] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day, published, show_from, show_until)
    values (${dishId}, ${kind}, ${from}, ${to}, ${extra.price ?? null}, ${extra.plates === undefined ? 40 : extra.plates},
            ${extra.published ?? true}, ${extra.show_from ?? "11:00"}, ${extra.show_until ?? "20:00"})
    returning id`;
  return row.id as string;
}

const add = (
  tx: Tx,
  sub: string,
  a: { dish: string; kind: "day" | "week"; days: string[]; from?: string; until?: string; plates?: number | null; price?: number | null },
) =>
  as<{ id: string }>(tx, sub, (q) => q`
    select public.add_menu_entry(${a.dish}::uuid, ${a.kind}::public.entry_kind, ${arr(a.days)}::text::date[],
      ${a.from ?? "11:00"}::time, ${a.until ?? "20:00"}::time, ${a.plates === undefined ? 40 : a.plates}::integer,
      ${a.price ?? null}::integer) as id`).then((r) => r.id);

const update = (
  tx: Tx,
  sub: string,
  id: string,
  a: { from?: string; until?: string; plates?: number | null; price?: number | null; days?: string[] | null },
) =>
  as(tx, sub, (q) => q`
    select public.update_menu_entry(${id}::uuid, ${a.from ?? "11:00"}::time, ${a.until ?? "20:00"}::time,
      ${a.plates === undefined ? 40 : a.plates}::integer, ${a.price ?? null}::integer,
      ${a.days ? arr(a.days) : null}::text::date[])`);

type Undo = { did: "deleted" | "unpublished" | "off_day" | "ended"; entry: string } & Record<string, unknown>;
const remove = (tx: Tx, sub: string, id: string, day: string | null = null) =>
  as<{ r: Undo }>(tx, sub, (q) => q`select public.remove_menu_entry(${id}::uuid, ${day}::date) as r`).then((r) => r.r);
const restore = (tx: Tx, sub: string, undo: Undo) =>
  as(tx, sub, (q) => q`select public.restore_menu_entry(${JSON.stringify(undo)}::text::jsonb)`);

type Copy = {
  copied: number;
  archived: string[];
  outside_hours: { name: string; from: string; until: string }[];
  prices: { kept: boolean; dishes: { name: string; price: number }[] };
};
const copy = (tx: Tx, sub: string, from: string, to: string) =>
  as<{ r: Copy }>(tx, sub, (q) => q`select public.copy_menu_day(${from}::date, ${to}::date) as r`).then((r) => r.r);
const preview = (tx: Tx, sub: string, weekStart: string) =>
  as<{ r: Record<string, { prev: number; last_week: number }> }>(tx, sub, (q) =>
    q`select public.copy_menu_week_preview(${weekStart}::date) as r`).then((r) => r.r);

/** The live entries for a dish on a date, off days counted, as the planner shows them. */
async function liveOn(tx: Tx, dishId: string, day: string) {
  const rows = await tx`
    select e.id, e.kind, e.price_kes, e.plates_per_day from public.menu_entries e
    where e.dish_id = ${dishId} and e.published and e.ended_early_at is null
      and ${day}::date between e.starts_on and e.ends_on
      and not exists (select from public.menu_entry_off_days o where o.entry_id = e.id and o.day = ${day}::date)`;
  return rows as { id: string; kind: string; price_kes: number | null; plates_per_day: number | null }[];
}

const onTodaysMenu = async (tx: Tx, dishId: string) =>
  (await attempt(tx, "anon", null, (q) => q`select entry_id from public.todays_menu where dish_id = ${dishId}`)).length;

async function history(tx: Tx) {
  return (await tx`select action, subject_label, before, after from public.change_log order by id`) as {
    action: string;
    subject_label: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }[];
}

const closeWeekday = (tx: Tx, isoDay: string) =>
  tx`update public.opening_hours set is_open = false where weekday = extract(dow from ${isoDay}::date)`;

// ───────────────────────── copying a day ─────────────────────────
describe("copy_menu_day", () => {
  test("copies the source's live day dishes, skipping removed, archived, ended-early and already-on dishes", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const [pilau, fish, githeri, stew, chapo, beans, ended] = (await Promise.all(
        ["Pilau", "Fish", "Githeri", "Stew", "Chapo", "Beans", "Ended"].map((n) => dish(tx, n)),
      )) as [Dish, Dish, Dish, Dish, Dish, Dish, Dish];
      await entry(tx, pilau.id, "day", day(0));
      await entry(tx, fish.id, "day", day(0), day(0), { published: false }); // removed, had orders
      await entry(tx, githeri.id, "day", day(0));
      await tx`update public.dishes set archived = true where id = ${githeri.id}`;
      await entry(tx, stew.id, "day", day(0)); // already on Tuesday as a day dish
      await entry(tx, stew.id, "day", day(1));
      await entry(tx, chapo.id, "day", day(0)); // already on Tuesday as a week dish
      await entry(tx, chapo.id, "week", day(1), day(4));
      await entry(tx, beans.id, "week", day(0), day(4)); // a week dish on Monday: not copied
      const endedId = await entry(tx, ended.id, "day", day(0));
      await tx`update public.menu_entries set ended_early_at = now() where id = ${endedId}`;

      const r = await copy(tx, f.ownerId, day(0), day(1));
      expect(r).toEqual({ copied: 1, archived: ["Githeri"], outside_hours: [], prices: { kept: true, dishes: [] } });
      expect((await liveOn(tx, pilau.id, day(1))).length).toBe(1);
      for (const d of [fish, githeri, ended]) expect(await liveOn(tx, d.id, day(1))).toEqual([]);
      for (const d of [stew, chapo, beans]) expect((await liveOn(tx, d.id, day(1))).length).toBe(1);
    }));

  test("a second copy adds nothing, and the preview agrees before and after", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { mon, day } = await dates(tx);
      const [a, b] = (await Promise.all(["Pilau", "Matoke"].map((n) => dish(tx, n)))) as [Dish, Dish];
      await entry(tx, a.id, "day", day(0));
      await entry(tx, b.id, "day", day(0));
      expect((await preview(tx, f.ownerId, mon))[day(1)]!.prev).toBe(2);
      expect((await copy(tx, f.ownerId, day(0), day(1))).copied).toBe(2);
      expect((await preview(tx, f.ownerId, mon))[day(1)]!.prev).toBe(0);
      expect(await copy(tx, f.ownerId, day(0), day(1))).toEqual({ copied: 0, archived: [], outside_hours: [], prices: { kept: true, dishes: [] } });
    }));

  test("a one-day price is kept for the owner and staff with Dishes and prices, dropped for others (Q1 C)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      await entry(tx, pilau.id, "day", day(0), day(0), { price: 600 });
      const priced = await person(tx, "Akinyi", ["dishes_prices"]);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      for (const [sub, to, want] of [[f.ownerId, day(1), 600], [priced, day(2), 600], [cook, day(3), null]] as const) {
        expect((await copy(tx, sub, day(0), to)).copied).toBe(1);
        expect((await liveOn(tx, pilau.id, to))[0]!.price_kes).toBe(want);
      }
    }));

  // RQA25-02: the note says which prices came across, so the result names the one-day-priced dishes.
  test("names the dishes that had a one-day price, with the price each has now", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const chapati = await dish(tx, "Chapati", 100);
      const githeri = await dish(tx, "Githeri", 300);
      await entry(tx, pilau.id, "day", day(0), day(0), { price: 600 });
      await entry(tx, chapati.id, "day", day(0), day(0), { price: 80 });
      await entry(tx, githeri.id, "day", day(0), day(0));
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      const kept = await copy(tx, f.ownerId, day(0), day(1));
      expect(kept.prices.kept).toBe(true);
      expect([...kept.prices.dishes].sort((a, b) => a.name.localeCompare(b.name))).toEqual([{ name: "Chapati", price: 80 }, { name: "Pilau", price: 600 }]);
      const usual = await copy(tx, cook, day(0), day(2));
      expect(usual.copied).toBe(3);
      expect(usual.prices.kept).toBe(false);
      expect([...usual.prices.dishes].sort((a, b) => a.name.localeCompare(b.name))).toEqual([{ name: "Chapati", price: 100 }, { name: "Pilau", price: 650 }]);
    }));

  test("names dishes whose hours fall outside the target day's opening hours, and still copies them", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      await tx`update public.opening_hours set opens = '11:00', closes = '21:00'`;
      const fry = await dish(tx, "Fish fry");
      await entry(tx, fry.id, "day", day(0), day(0), { show_from: "19:00", show_until: "22:00" });
      expect(await copy(tx, f.ownerId, day(0), day(1))).toEqual({
        copied: 1,
        archived: [],
        outside_hours: [{ name: "Fish fry", from: "19:00", until: "22:00" }],
        prices: { kept: true, dishes: [] },
      });
    }));

  test("refuses a past target day and a weekly closed day; History gets one line", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus, day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      await entry(tx, pilau.id, "day", day(0));
      expect((await refusal(copy(tx, f.ownerId, day(0), plus(today, -1))))?.detail).toBe("past");
      await closeWeekday(tx, day(2));
      expect((await refusal(copy(tx, f.ownerId, day(0), day(2))))?.detail).toBe("closed_day");
      await copy(tx, f.ownerId, day(0), day(1));
      expect((await history(tx)).map((l) => [l.action, l.after?.count])).toEqual([["menu.copy_day", 1]]);
    }));
});

// ───────────────────────── off days ─────────────────────────
describe("a week dish's day off", () => {
  test("hides it from todays_menu on that day only, and place_order refuses it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today } = await dates(tx);
      // A week entry covering today, written to run Monday to Sunday of the current week.
      const [w] = await tx`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
        select ${f.regular.id}, 'week', date_trunc('week', public.nairobi_today())::date,
               (date_trunc('week', public.nairobi_today()) + interval '6 days')::date, 10, '00:00', '23:59:59'
        returning id`;
      await tx`update public.dishes set is_regular = false where id = ${f.regular.id}`;
      expect(await onTodaysMenu(tx, f.regular.id)).toBe(1);
      // Another day off (not today) leaves today's menu alone.
      const other = (await tx`select d::date::text as d from generate_series(date_trunc('week', public.nairobi_today()), date_trunc('week', public.nairobi_today()) + interval '6 days', interval '1 day') d where d::date <> public.nairobi_today() limit 1`)[0].d;
      await tx`insert into public.menu_entry_off_days (entry_id, day) values (${w.id}, ${other})`;
      expect(await onTodaysMenu(tx, f.regular.id)).toBe(1);
      await tx`insert into public.menu_entry_off_days (entry_id, day) values (${w.id}, ${today})`;
      expect(await onTodaysMenu(tx, f.regular.id)).toBe(0);
      await expect(
        placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, menu_entry_id: w.id, quantity: 1 }])),
      ).rejects.toThrow("Test regular is not on the menu right now");
      expect(await platesSold(tx, w.id)).toBe(0);
    }));

  test("only week entries have days off, and only inside their own dates", () =>
    inTx(async (tx) => {
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const d = await entry(tx, pilau.id, "day", day(0));
      const w = await entry(tx, pilau.id, "week", day(2), day(4));
      expect((await refusal(tx.savepoint((sp) => sp`insert into public.menu_entry_off_days (entry_id, day) values (${d}, ${day(0)})`)))?.code).toBe("23514");
      expect((await refusal(tx.savepoint((sp) => sp`insert into public.menu_entry_off_days (entry_id, day) values (${w}, ${day(5)})`)))?.code).toBe("23514");
      expect(await refusal(tx.savepoint((sp) => sp`insert into public.menu_entry_off_days (entry_id, day) values (${w}, ${day(3)})`))).toBeNull();
    }));
});

// ───────────────────────── one dish, once a day ─────────────────────────
describe("one dish once a day", () => {
  test("a day dish on a day a week dish covers is refused, naming the date and the other kind", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      await entry(tx, pilau.id, "week", day(0), day(4));
      expect(await refusal(add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(2)] }))).toMatchObject({
        code: "23505",
        detail: day(2),
        hint: "week",
      });
      // Not on Saturday, outside the week dish's days.
      expect(await refusal(add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(5)] }))).toBeNull();
    }));

  test("a week dish over a day dish is refused at the first clashing day; unticking that day lets it in", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      await entry(tx, pilau.id, "day", day(2));
      expect(await refusal(add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(1), day(2), day(3)] }))).toMatchObject({
        code: "23505",
        detail: day(2),
        hint: "day",
      });
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(1), day(3)] });
      expect((await tx`select day::text from public.menu_entry_off_days where entry_id = ${id}`).map((r: { day: string }) => r.day)).toEqual([day(2)]);
    }));

  test("re-ticking a day that is now taken is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(1), day(3)] });
      await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(2)] });
      expect(await refusal(update(tx, f.ownerId, id, { days: [day(0), day(1), day(2), day(3)] }))).toMatchObject({
        code: "23505",
        detail: day(2),
        hint: "day",
      });
    }));

  test("removed and ended-early entries don't count", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      await entry(tx, pilau.id, "week", day(0), day(4), { published: false });
      const ended = await entry(tx, pilau.id, "day", day(1));
      await tx`update public.menu_entries set ended_early_at = now() where id = ${ended}`;
      expect(await refusal(add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)] }))).toBeNull();
    }));
});

// ───────────────────────── adding and editing ─────────────────────────
describe("add_menu_entry", () => {
  test("adds a day dish with its hours, plates and price, and stamps the dish's last served day", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], from: "12:00", until: "15:00", plates: 25, price: 600 });
      const [e] = await tx`select kind, starts_on::text, ends_on::text, show_from::text, show_until::text, plates_per_day, price_kes from public.menu_entries where id = ${id}`;
      expect(e).toEqual({ kind: "day", starts_on: day(1), ends_on: day(1), show_from: "12:00:00", show_until: "15:00:00", plates_per_day: 25, price_kes: 600 });
      expect((await tx`select last_served_on::text as d from public.dishes where id = ${pilau.id}`)[0].d).toBe(day(1));
    }));

  test("the usual price, or none, is stored as null so a change of the usual price carries through", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], price: 650 });
      // Staff without Dishes and prices can add at the usual price: nothing priced is written.
      await add(tx, cook, { dish: pilau.id, kind: "day", days: [day(2)], price: null });
      expect((await liveOn(tx, pilau.id, day(1)))[0]!.price_kes).toBeNull();
      expect((await liveOn(tx, pilau.id, day(2)))[0]!.price_kes).toBeNull();
    }));

  test("a week's gaps become days off; its first and last ticked days bound it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(4), day(0), day(2)] });
      const [e] = await tx`select starts_on::text, ends_on::text from public.menu_entries where id = ${id}`;
      expect(e).toEqual({ starts_on: day(0), ends_on: day(4) });
      expect((await tx`select day::text from public.menu_entry_off_days where entry_id = ${id} order by day`).map((r: { day: string }) => r.day)).toEqual([day(1), day(3)]);
    }));

  test("refuses a past day, a weekly closed day, until not after from, plates over 1,000, two weeks, no day, an archived or everyday dish", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus, day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const old = await dish(tx, "Old", 500, { archived: true });
      await closeWeekday(tx, day(3));
      const o = f.ownerId;
      const cases: [Parameters<typeof add>[2], string][] = [
        [{ dish: pilau.id, kind: "day", days: [plus(today, -1)] }, "past"],
        [{ dish: pilau.id, kind: "day", days: [day(3)] }, "closed_day"],
        [{ dish: pilau.id, kind: "week", days: [day(2), day(3)] }, "closed_day"],
        [{ dish: pilau.id, kind: "day", days: [day(1)], from: "15:00", until: "15:00" }, "hours"],
        [{ dish: pilau.id, kind: "day", days: [day(1)], from: "16:00", until: "15:00" }, "hours"],
        [{ dish: pilau.id, kind: "day", days: [day(1)], plates: 1001 }, "plates"],
        [{ dish: pilau.id, kind: "day", days: [day(1)], plates: 0 }, "plates"],
        [{ dish: pilau.id, kind: "week", days: [day(6), day(7)] }, "two_weeks"],
        [{ dish: pilau.id, kind: "day", days: [day(1), day(2)] }, "one_day"],
        [{ dish: pilau.id, kind: "week", days: [] }, "no_days"],
        [{ dish: old.id, kind: "day", days: [day(1)] }, "dish"],
        [{ dish: f.regular.id, kind: "day", days: [day(1)] }, "dish"],
      ];
      for (const [a, detail] of cases) expect([detail, (await refusal(add(tx, o, a)))?.detail]).toEqual([detail, detail]);
      expect(await tx`select from public.menu_entries where dish_id = ${pilau.id}`).toHaveLength(0);
    }));

  test("a closed date is allowed (Q2 A); a price from staff without Dishes and prices is 2.3's refusal", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      await tx`insert into public.closed_dates (day, note) values (${day(1)}, 'Family wedding')`;
      expect(await refusal(add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)] }))).toBeNull();
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      expect(await refusal(add(tx, cook, { dish: pilau.id, kind: "day", days: [day(2)], price: 600 }))).toMatchObject({
        code: "42501",
        message: "Only the owner can change dishes and prices.",
      });
    }));

  test("a customer can't call it", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const r = await refusal(
        attempt(tx, "anon", null, (q) => q`select public.add_menu_entry(${pilau.id}::uuid, 'day', ${arr([day(1)])}::text::date[], '11:00', '20:00', 10, null)`),
      );
      expect(r?.code).toBe("42501");
    }));
});

describe("update_menu_entry", () => {
  test("changes hours, plates and price of an entry that already has orders", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      await update(tx, f.ownerId, f.openEntry.id, { from: "00:00", until: "23:00", plates: 30, price: 420 });
      const [e] = await tx`select show_until::text, plates_per_day, price_kes, published from public.menu_entries where id = ${f.openEntry.id}`;
      expect(e).toEqual({ show_until: "23:00:00", plates_per_day: 30, price_kes: 420, published: true });
      // The order placed before keeps its price.
      expect((await tx`select unit_price_kes from public.order_items where menu_entry_id = ${f.openEntry.id}`)[0].unit_price_kes).toBe(450);
    }));

  test("staff without Dishes and prices can save hours and plates on a priced entry, but not a new price", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      expect(await refusal(update(tx, cook, f.openEntry.id, { from: "00:00", until: "23:00", plates: 5, price: 450 }))).toBeNull();
      expect((await tx`select plates_per_day from public.menu_entries where id = ${f.openEntry.id}`)[0].plates_per_day).toBe(5);
      expect((await refusal(update(tx, cook, f.openEntry.id, { from: "00:00", until: "23:00", plates: 5, price: 400 })))?.code).toBe("42501");
    }));

  test("refuses an entry that ended before today, one taken off meanwhile, and the add refusals", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus, day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const past = await entry(tx, pilau.id, "day", plus(today, -2));
      const gone = await entry(tx, pilau.id, "day", day(1), day(1), { published: false });
      const ok = await entry(tx, pilau.id, "day", day(2));
      const o = f.ownerId;
      expect((await refusal(update(tx, o, past, {})))?.detail).toBe("past");
      expect((await refusal(update(tx, o, gone, {})))?.detail).toBe("gone");
      expect((await refusal(update(tx, o, crypto.randomUUID(), {})))?.detail).toBe("gone");
      expect((await refusal(update(tx, o, ok, { from: "15:00", until: "14:00" })))?.detail).toBe("hours");
      expect((await refusal(update(tx, o, ok, { plates: 1001 })))?.detail).toBe("plates");
    }));

  test("a week's days from today on: unticked become days off, re-ticked come back, the end may move within the week", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(1), day(2), day(3)] });
      await update(tx, f.ownerId, id, { days: [day(0), day(2), day(5)] });
      const shape = async () => ({
        e: (await tx`select starts_on::text, ends_on::text from public.menu_entries where id = ${id}`)[0],
        off: (await tx`select day::text from public.menu_entry_off_days where entry_id = ${id} order by day`).map((r: { day: string }) => r.day),
      });
      expect(await shape()).toEqual({ e: { starts_on: day(0), ends_on: day(5) }, off: [day(1), day(3), day(4)] });
      await update(tx, f.ownerId, id, { days: [day(0), day(1), day(2)] });
      expect(await shape()).toEqual({ e: { starts_on: day(0), ends_on: day(2) }, off: [] });
      expect((await refusal(update(tx, f.ownerId, id, { days: [day(0), day(7)] })))?.detail).toBe("two_weeks");
    }));

  test("lowering plates below what's sold today sells it out; raising them sells again; the board is unaffected", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const first = await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }]));
      const keep = { from: "00:00", until: "23:59:59", price: 450 };
      await update(tx, f.ownerId, f.openEntry.id, { ...keep, plates: 1 });
      const one = { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 };
      await expect(placeOrder(tx, dineIn(f, [one]))).rejects.toThrow("Sorry, Test rotating has sold out");
      const [m] = await attempt(tx, "anon", null, (q) => q`select sold_out from public.todays_menu where entry_id = ${f.openEntry.id}`);
      expect(m!.sold_out).toBe(true);
      await update(tx, f.ownerId, f.openEntry.id, { ...keep, plates: 5 });
      expect(await refusal(placeOrder(tx, dineIn(f, [one])))).toBeNull();
      expect(await platesSold(tx, f.openEntry.id)).toBe(3);
      const [o] = await tx`select id from public.orders where code = ${first.code}`;
      const moved = await as<{ v: number }>(tx, f.ownerId, (q) => q`select public.advance_order(${o.id}::uuid, 'new', 'preparing') as v`);
      expect(typeof moved.v).toBe("number");
    }));
});

// ───────────────────────── removing and undoing ─────────────────────────
describe("remove_menu_entry and restore_menu_entry", () => {
  test("a day dish without orders is deleted, and Undo puts it back with the same values", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], from: "12:00", until: "15:00", plates: 25, price: 600 });
      const undo = await remove(tx, f.ownerId, id);
      expect(undo.did).toBe("deleted");
      expect(await liveOn(tx, pilau.id, day(1))).toEqual([]);
      await restore(tx, f.ownerId, undo);
      const [e] = await liveOn(tx, pilau.id, day(1));
      expect([e!.price_kes, e!.plates_per_day]).toEqual([600, 25]);
    }));

  test("a day dish with orders is unpublished, and Undo republishes it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      const undo = await remove(tx, f.ownerId, f.openEntry.id);
      expect(undo.did).toBe("unpublished");
      expect(await onTodaysMenu(tx, f.rotating.id)).toBe(0);
      await restore(tx, f.ownerId, undo);
      expect(await onTodaysMenu(tx, f.rotating.id)).toBe(1);
      expect(await platesSold(tx, f.openEntry.id)).toBe(1);
    }));

  test("a week dish from one day is a day off; the rest of the week stays; Undo brings the day back", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(1), day(2), day(3), day(4)] });
      const undo = await remove(tx, f.ownerId, id, day(2));
      expect(undo.did).toBe("off_day");
      expect(await liveOn(tx, pilau.id, day(2))).toEqual([]);
      for (const d of [0, 1, 3, 4]) expect((await liveOn(tx, pilau.id, day(d))).length).toBe(1);
      await restore(tx, f.ownerId, undo);
      expect((await liveOn(tx, pilau.id, day(2))).length).toBe(1);
    }));

  test("a week dish that started before today ends yesterday when removed from the rest of the week; Undo restores the end", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      // Two days back to two ahead: a fixture that may straddle weeks, which is fine for this rule.
      const id = await entry(tx, pilau.id, "week", plus(today, -2), plus(today, 2));
      const undo = await remove(tx, f.ownerId, id);
      expect(undo.did).toBe("ended");
      expect((await tx`select ends_on::text as d from public.menu_entries where id = ${id}`)[0].d).toBe(plus(today, -1));
      expect(await liveOn(tx, pilau.id, today)).toEqual([]);
      await restore(tx, f.ownerId, undo);
      expect((await tx`select ends_on::text as d from public.menu_entries where id = ${id}`)[0].d).toBe(plus(today, 2));
    }));

  test("removing a week's last remaining day removes the rest of the week", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "week", days: [day(0), day(2)] });
      await remove(tx, f.ownerId, id, day(0));
      expect((await remove(tx, f.ownerId, id, day(2))).did).toBe("deleted");
      expect(await tx`select from public.menu_entries where id = ${id}`).toHaveLength(0);
    }));

  test("Undo after the dish went back on that day another way is the clash refusal", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)] });
      const undo = await remove(tx, f.ownerId, id);
      await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)] });
      expect(await refusal(restore(tx, f.ownerId, undo))).toMatchObject({ code: "23505", detail: day(1) });
    }));

  test("Undo of a cook's own removal keeps the one-day price (Q1 a), but a forged Undo can't set one", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], price: 600 });
      const undo = await remove(tx, cook, id);
      expect(undo.did).toBe("deleted");
      expect(await refusal(restore(tx, cook, undo))).toBeNull();
      expect((await liveOn(tx, pilau.id, day(1)))[0]!.price_kes).toBe(600);
      // The same cook makes up a removal that never happened, with a price of their own.
      const fake = { ...undo, token: crypto.randomUUID(), entry: crypto.randomUUID(), saved: { ...(undo.saved as object), starts_on: day(2), ends_on: day(2), price_kes: 100 } };
      expect((await refusal(restore(tx, cook, fake as Undo)))?.detail).toBe("gone");
    }));

  // RQA25-01: Undo puts back what the server removed, whatever the browser sends with the token.
  test("a changed Undo can't move a one-day price to another dish: the stored removal is what comes back", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const nyama = await dish(tx, "Nyama choma", 950);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], plates: 25, price: 600 });
      const undo = await remove(tx, cook, id);
      expect(typeof undo.token).toBe("string");
      const changed = { ...undo, saved: { ...(undo.saved as object), dish_id: nyama.id, price_kes: 100, plates_per_day: 999 } };
      expect(await refusal(restore(tx, cook, changed as Undo))).toBeNull();
      expect(await liveOn(tx, nyama.id, day(1))).toEqual([]);
      const [e] = await liveOn(tx, pilau.id, day(1));
      expect([e!.price_kes, e!.plates_per_day]).toEqual([600, 25]);
    }));

  test("a changed Undo can't stretch a week dish or take away a day off the owner set", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus, day } = await dates(tx);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      const pilau = await dish(tx, "Pilau");
      const id = await entry(tx, pilau.id, "week", plus(today, -2), plus(today, 2));
      const ended = await remove(tx, cook, id);
      expect(ended.did).toBe("ended");
      await restore(tx, cook, { ...ended, ends_on: plus(today, 60) });
      expect((await tx`select ends_on::text as d from public.menu_entries where id = ${id}`)[0].d).toBe(plus(today, 2));

      const chips = await dish(tx, "Chips");
      const wk = await add(tx, f.ownerId, { dish: chips.id, kind: "week", days: [day(0), day(1), day(2), day(3)] });
      await tx`insert into public.menu_entry_off_days (entry_id, day) values (${wk}, ${day(3)})`; // the owner's own day off
      const off = await remove(tx, cook, wk, day(1));
      expect(off.did).toBe("off_day");
      await restore(tx, cook, { ...off, day: day(3) });
      expect((await liveOn(tx, chips.id, day(1))).length).toBe(1);
      expect(await liveOn(tx, chips.id, day(3))).toEqual([]);
    }));

  test("an Undo works once, needs a real token, and works for whoever on the team taps it (2.5b Q1 A)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const cook = await person(tx, "Otieno", ["everyday_menu"]);
      const other = await person(tx, "Akinyi", ["everyday_menu"]);
      const id = await add(tx, f.ownerId, { dish: pilau.id, kind: "day", days: [day(1)], price: 600 });
      const undo = await remove(tx, cook, id);
      expect((await refusal(restore(tx, cook, { ...undo, token: crypto.randomUUID() })))?.detail).toBe("gone");
      expect((await refusal(restore(tx, cook, { did: "deleted", entry: id } as Undo)))?.detail).toBe("gone");
      expect(await refusal(restore(tx, other, undo))).toBeNull();
      expect((await liveOn(tx, pilau.id, day(1)))[0]!.price_kes).toBe(600);
      await remove(tx, f.ownerId, id);
      expect((await refusal(restore(tx, cook, undo)))?.detail).toBe("gone");
      // Off the team: refused before the token is looked at.
      expect((await refusal(restore(tx, crypto.randomUUID(), undo)))?.code).toBe("42501");
    }));

  test("past days are locked", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { today, plus } = await dates(tx);
      const pilau = await dish(tx, "Pilau");
      const id = await entry(tx, pilau.id, "day", plus(today, -1));
      expect((await refusal(remove(tx, f.ownerId, id)))?.detail).toBe("past");
    }));
});

// ───────────────────────── History ─────────────────────────
describe("History", () => {
  test("one line for each spec sentence: add, week add with its days, plates, price, a day off, a removal, an undo, a copy", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const { day } = await dates(tx);
      const pilau = await dish(tx, "Pilau", 650);
      const o = f.ownerId;
      const d = await add(tx, o, { dish: pilau.id, kind: "day", days: [day(4)], plates: 40 });
      await update(tx, o, d, { plates: 30 });
      await update(tx, o, d, { plates: 30, price: 600 });
      const undo = await remove(tx, o, d);
      await restore(tx, o, undo);
      const matoke = await dish(tx, "Matoke");
      const w = await add(tx, o, { dish: matoke.id, kind: "week", days: [day(0), day(1), day(2), day(4)] });
      await remove(tx, o, w, day(1));
      await copy(tx, o, day(4), day(5));
      const got = (await history(tx)).filter((l) => l.action !== "dish.add");
      expect(got.map((l) => [l.action, l.subject_label])).toEqual([
        ["entry.add", "Pilau"],
        ["entry.plates", "Pilau"],
        ["entry.price", "Pilau"],
        ["entry.remove", "Pilau"],
        ["entry.restore", "Pilau"],
        ["entry.add", "Matoke"],
        ["entry.off_day", "Matoke"],
        ["menu.copy_day", null],
      ]);
      expect(got[0]!.after).toMatchObject({ kind: "day", starts_on: day(4), plates: 40 });
      expect([got[1]!.before?.plates, got[1]!.after?.plates]).toEqual([40, 30]);
      expect([got[2]!.before?.price, got[2]!.after?.price]).toEqual([null, 600]);
      expect(got[4]!.after).toMatchObject({ starts_on: day(4) });
      expect(got[5]!.after).toMatchObject({ kind: "week", days: [day(0), day(1), day(2), day(4)] });
      expect(got[6]!.after).toMatchObject({ day: day(1) });
      expect(got[7]!.after).toMatchObject({ from: day(4), to: day(5), count: 1 });
    }));
});

export type { Fixtures };
