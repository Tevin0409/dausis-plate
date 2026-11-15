// Slice 2.3: who may do what (spec-2.3-roles.md, "The rules" and "Done means" 1, 2 and 4).
// Every call goes straight at the database as a signed-in user, the way a direct API call
// would, so the screens play no part. Each case: plain staff refused, the same person allowed
// once the matching job is switched on, and refused again once it is switched off.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Job = "everyday_menu" | "dishes_prices" | "tables_delivery" | "close_early";
type Q = Parameters<Parameters<typeof attempt>[3]>[0];

const MSG = {
  everyday: "Only the owner can change the everyday menu.",
  dishes: "Only the owner can change dishes and prices.",
  tables: "Only the owner can change tables and delivery zones.",
  close: "Only the owner can close the kitchen early.",
  owner: "Only the owner can do this.",
  lastOwner: "There has to be at least one owner. Make someone else owner first.",
};

async function person(tx: Tx, role: "owner" | "staff", name: string, jobs: Job[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase()}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, ${role}, ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job})`;
  return u.id as string;
}

const grant = (tx: Tx, user: string, job: Job) => tx`insert into public.staff_grants (user_id, job) values (${user}, ${job})`;
const revoke = (tx: Tx, user: string, job: Job) => tx`delete from public.staff_grants where user_id = ${user} and job = ${job}`;

/** Runs `fn` as `sub`; returns null if it succeeded, else the SQLSTATE and message. */
async function as(tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<unknown>) {
  try {
    await attempt(tx, sub ? "authenticated" : "anon", sub, async (q) => {
      await fn(q);
      return [];
    });
    return null;
  } catch (err) {
    const e = err as { errno?: string; message: string };
    return { code: e.errno, message: e.message };
  }
}
const refusedWith = (message: string) => ({ code: "42501", message });

let people = 0;
let CATS: string[] = [];

/** The three-step check from "Done means" 2. */
async function grantCycle(tx: Tx, f: Fixtures, job: Job, message: string, fn: (q: Q) => PromiseLike<unknown>) {
  const staff = await person(tx, "staff", `Staff${++people}`);
  expect(await as(tx, staff, fn)).toEqual(refusedWith(message));
  await grant(tx, staff, job);
  expect(await as(tx, staff, fn)).toBeNull();
  await revoke(tx, staff, job);
  expect(await as(tx, staff, fn)).toEqual(refusedWith(message));
  expect(await as(tx, f.ownerId, fn)).toBeNull();
}

describe("dishes and prices", () => {
  test("a price change", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let price = 300;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dishes set price_kes = ${(price += 10)} where id = ${f.regular.id}`);
    }));

  test("adding a dish", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let n = 0;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`insert into public.dishes (name, price_kes) values (${`New dish ${++n}`}, 200)`);
    }));

  test("words and photo need the grant too (3B): name, description, photo, category", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [{ cats }] = await tx`select enum_range(null::public.dish_category)::text[] cats`;
      CATS = cats;
      let n = 0;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dishes set name = ${`Renamed ${++n}`} where id = ${f.regular.id}`);
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dishes set description = ${`Words ${++n}`} where id = ${f.regular.id}`);
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dishes set photo_key = ${`dishes/x/${++n}.webp`} where id = ${f.regular.id}`);
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dishes set category = ${CATS[++n % CATS.length]}::public.dish_category where id = ${f.regular.id}`);
    }));

  test("dish options: add, change, remove", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let n = 0;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`insert into public.dish_options (dish_id, label) values (${f.rotating.id}, ${`Opt ${++n}`})`);
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.dish_options set price_delta_kes = ${++n} where id = ${f.option.id}`);
      const staff = await person(tx, "staff", "Optless");
      expect(await as(tx, staff, (q) => q`delete from public.dish_options where id = ${f.option.id}`)).toEqual(refusedWith(MSG.dishes));
    }));

  test("a priced menu entry needs the grant; an unpriced one doesn't, and nor does the plate limit", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let day = 10;
      const add = (price: number | null) => (q: Q) =>
        q`insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day)
          values (${f.regular.id}, 'day', public.nairobi_today() + ${++day}, public.nairobi_today() + ${day}, ${price}, 5)`;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, add(400));
      let price = 450;
      await grantCycle(tx, f, "dishes_prices", MSG.dishes, (q) => q`update public.menu_entries set price_kes = ${(price += 5)} where id = ${f.openEntry.id}`);
      const staff = await person(tx, "staff", "Planner");
      expect(await as(tx, staff, add(null))).toBeNull();
      expect(await as(tx, staff, (q) => q`update public.menu_entries set plates_per_day = 7 where id = ${f.openEntry.id}`)).toBeNull();
      expect(await as(tx, staff, (q) => q`update public.menu_entries set ended_early_at = now() where id = ${f.openEntry.id}`)).toBeNull();
    }));
});

describe("the everyday menu", () => {
  test("putting a dish on or taking it off", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let on = false;
      await grantCycle(tx, f, "everyday_menu", MSG.everyday, (q) => q`update public.dishes set is_regular = ${(on = !on)} where id = ${f.rotating.id}`);
    }));

  test("Dishes and prices alone doesn't cover it, including adding a dish straight onto it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Pricer", ["dishes_prices"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set is_regular = false where id = ${f.regular.id}`)).toEqual(refusedWith(MSG.everyday));
      expect(await as(tx, staff, (q) => q`insert into public.dishes (name, price_kes, is_regular) values ('Straight on', 100, true)`)).toEqual(refusedWith(MSG.everyday));
      expect(await as(tx, staff, (q) => q`insert into public.dishes (name, price_kes) values ('Library only', 100)`)).toBeNull();
    }));

  test("Everyday menu alone can't change the price in the same save", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Regulars", ["everyday_menu"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set is_regular = false, price_kes = 1 where id = ${f.regular.id}`)).toEqual(refusedWith(MSG.dishes));
      const [d] = await tx`select is_regular, price_kes from public.dishes where id = ${f.regular.id}`;
      expect(d).toEqual({ is_regular: true, price_kes: 300 });
    }));
});

describe("open to all staff", () => {
  test("on sale today, last served, sold out and copying a day", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Cook");
      expect(await as(tx, staff, (q) => q`select public.set_regular_on_sale(${f.regular.id}, false)`)).toBeNull();
      expect(await as(tx, staff, (q) => q`update public.dishes set last_served_on = public.nairobi_today() where id = ${f.rotating.id}`)).toBeNull();
      expect(await as(tx, staff, (q) => q`select public.set_entry_sold_out(${f.openEntry.id}, true)`)).toBeNull();
      expect(await as(tx, staff, (q) => q`select public.copy_menu_day(public.nairobi_today(), public.nairobi_today() + 1)`)).toBeNull();
    }));
});

describe("copy day keeps a day's price only for those who may set prices (2.5 Q1 C)", () => {
  const copied = async (tx: Tx, f: Fixtures, sub: string, offset: number) => {
    expect(await as(tx, sub, (q) => q`select public.copy_menu_day(public.nairobi_today(), public.nairobi_today() + ${offset})`)).toBeNull();
    const [e] = await tx`select price_kes from public.menu_entries where dish_id = ${f.rotating.id} and kind = 'day' and starts_on = public.nairobi_today() + ${offset}`;
    return e.price_kes as number | null;
  };

  test("owner and granted staff keep KES 450; other staff copy at the dish's own price", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const priced = await person(tx, "staff", "Priced", ["dishes_prices"]);
      const plain = await person(tx, "staff", "Plain");
      expect(await copied(tx, f, f.ownerId, 1)).toBe(450);
      expect(await copied(tx, f, priced, 2)).toBe(450);
      expect(await copied(tx, f, plain, 3)).toBeNull();
    }));
});

describe("owner only", () => {
  test("archiving and restoring, even with every job switched on", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Trusted", ["everyday_menu", "dishes_prices", "tables_delivery", "close_early"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set archived = true where id = ${f.rotating.id}`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, staff, (q) => q`insert into public.dishes (name, price_kes, archived) values ('Born archived', 1, true)`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, f.ownerId, (q) => q`update public.dishes set archived = true where id = ${f.rotating.id}`)).toBeNull();
      expect(await as(tx, staff, (q) => q`update public.dishes set archived = false where id = ${f.rotating.id}`)).toEqual(refusedWith(MSG.owner));
    }));

  test("deleting a dish, by a direct delete as well as by delete_dish", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [loose] = await tx`insert into public.dishes (name, price_kes) values ('Never planned', 100) returning id`;
      const staff = await person(tx, "staff", "Trusted", ["everyday_menu", "dishes_prices"]);
      expect(await as(tx, staff, (q) => q`delete from public.dishes where id = ${loose.id}`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, staff, (q) => q`select public.delete_dish(${loose.id})`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, f.ownerId, (q) => q`delete from public.dishes where id = ${loose.id}`)).toBeNull();
    }));

  test("sales figures: dashboard_stats", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Trusted", ["everyday_menu", "dishes_prices", "tables_delivery", "close_early"]);
      expect(await as(tx, staff, (q) => q`select public.dashboard_stats(public.nairobi_today())`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, f.ownerId, (q) => q`select public.dashboard_stats(public.nairobi_today())`)).toBeNull();
    }));

  test("hours and the till number stay the owner's, even with Close early", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Closer", ["close_early"]);
      const week = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_open: true, opens: "00:00", closes: "24:00" })));
      expect(await as(tx, staff, (q) => q`select public.save_opening_hours(${week}::jsonb, 0)`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, staff, (q) => q`select public.set_till_number('123456')`)).toEqual(refusedWith(MSG.owner));
      expect(await as(tx, f.ownerId, (q) => q`select public.set_till_number('123456')`)).toBeNull();
    }));
});

describe("tables and delivery", () => {
  test("tables: add, rename, turn off, new code, delete; everyone can still see them", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      let n = 0;
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`insert into public.dining_tables (label) values (${`Roles test table ${++n}`})`);
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`update public.dining_tables set label = ${`Roles test renamed ${++n}`} where id = ${f.table.id}`);
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`update public.dining_tables set active = ${n++ % 2 === 0} where id = ${f.table.id}`);
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`update public.dining_tables set qr_token = ${`code${++n}`} where id = ${f.table.id}`);
      const staff = await person(tx, "staff", "Waiter");
      expect(await as(tx, staff, (q) => q`delete from public.dining_tables where id = ${f.table.id}`)).toEqual(refusedWith(MSG.tables));
      const seen = await attempt(tx, "authenticated", staff, (q) => q`select id from public.dining_tables where id = ${f.table.id}`);
      expect(seen.length).toBe(1);
    }));

  test("delivery zones and fees", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [zone] = await tx`insert into public.delivery_zones (name, fee_kes) values ('Test zone', 150) returning id`;
      let n = 0;
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`insert into public.delivery_zones (name, fee_kes) values (${`Zone ${++n}`}, 100)`);
      await grantCycle(tx, f, "tables_delivery", MSG.tables, (q) => q`update public.delivery_zones set fee_kes = ${150 + ++n} where id = ${zone.id}`);
      const staff = await person(tx, "staff", "Rider");
      expect(await as(tx, staff, (q) => q`delete from public.delivery_zones where id = ${zone.id}`)).toEqual(refusedWith(MSG.tables));
    }));
});

describe("close early", () => {
  test("close and reopen need the grant", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await grantCycle(tx, f, "close_early", MSG.close, (q) => q`select public.close_early()`);
      await grantCycle(tx, f, "close_early", MSG.close, (q) => q`select public.reopen_today()`);
    }));
});

describe("the team", () => {
  test("staff can't change anyone's role, add people, or switch jobs on, their own included", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Climber");
      const [newcomer] = await tx`insert into auth.users (email) values ('newcomer@test.local') returning id`;
      // RLS hides the rows, so an update finds nothing and changes nothing; inserts are refused.
      expect(await as(tx, staff, (q) => q`update public.staff set role = 'owner' where user_id = ${staff}`)).toBeNull();
      expect(await as(tx, staff, (q) => q`delete from public.staff where user_id = ${f.ownerId}`)).toBeNull();
      const roles = await tx`select user_id, role from public.staff where user_id in (${staff}, ${f.ownerId}) order by role`;
      expect(roles.map((r: { role: string }) => r.role)).toEqual(["owner", "staff"]);
      expect((await as(tx, staff, (q) => q`insert into public.staff (user_id, role) values (${newcomer.id}, 'staff')`))?.code).toBe("42501");
      expect((await as(tx, staff, (q) => q`insert into public.staff_grants (user_id, job) values (${staff}, 'dishes_prices')`))?.code).toBe("42501");
      const [{ n }] = await tx`select count(*)::int n from public.staff_grants where user_id = ${staff}`;
      expect(n).toBe(0);
    }));

  test("a staff member can read their own jobs, not other people's", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const a = await person(tx, "staff", "Anna", ["close_early"]);
      await person(tx, "staff", "Brian", ["dishes_prices"]);
      const rows = await attempt(tx, "authenticated", a, (q) => q`select user_id, job from public.staff_grants`);
      expect(rows).toEqual([{ user_id: a, job: "close_early" }]);
    }));

  test("removing someone takes their jobs away at once", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Leaver", ["dishes_prices"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set price_kes = 301 where id = ${f.regular.id}`)).toBeNull();
      expect(await as(tx, f.ownerId, (q) => q`delete from public.staff where user_id = ${staff}`)).toBeNull();
      const [{ n }] = await tx`select count(*)::int n from public.staff_grants where user_id = ${staff}`;
      expect(n).toBe(0);
      // No longer on the staff list: RLS hides every dish, so the update changes nothing.
      expect(await as(tx, staff, (q) => q`update public.dishes set price_kes = 302 where id = ${f.regular.id}`)).toBeNull();
      const [d] = await tx`select price_kes from public.dishes where id = ${f.regular.id}`;
      expect(d.price_kes).toBe(301);
    }));

  test("owners hold every job without grants", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const rows = await attempt(tx, "authenticated", f.ownerId, (q) => q`
        select public.has_grant('everyday_menu') a, public.has_grant('dishes_prices') b,
               public.has_grant('tables_delivery') c, public.has_grant('close_early') d`);
      expect(rows[0]).toEqual({ a: true, b: true, c: true, d: true });
    }));
});

describe("there is always an owner", () => {
  test("the only owner can't demote or remove themselves", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      // The test database's seed may hold its own owner; this case is about the last one.
      await tx`delete from public.staff where role = 'owner' and user_id <> ${f.ownerId}`;
      expect(await as(tx, f.ownerId, (q) => q`update public.staff set role = 'staff' where user_id = ${f.ownerId}`)).toEqual({ code: "P0001", message: MSG.lastOwner });
      expect(await as(tx, f.ownerId, (q) => q`delete from public.staff where user_id = ${f.ownerId}`)).toEqual({ code: "P0001", message: MSG.lastOwner });
      const [s] = await tx`select role from public.staff where user_id = ${f.ownerId}`;
      expect(s.role).toBe("owner");
    }));

  test("with a second owner, one can step down", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`delete from public.staff where role = 'owner' and user_id <> ${f.ownerId}`;
      const second = await person(tx, "owner", "Second");
      expect(await as(tx, f.ownerId, (q) => q`update public.staff set role = 'staff' where user_id = ${f.ownerId}`)).toBeNull();
      expect(await as(tx, second, (q) => q`delete from public.staff where user_id = ${f.ownerId}`)).toBeNull();
      expect(await as(tx, second, (q) => q`update public.staff set role = 'staff' where user_id = ${second}`)).toEqual({ code: "P0001", message: MSG.lastOwner });
    }));
});

describe("the change record is the owner's to read and nobody's to write", () => {
  test("staff read nothing; nobody inserts, edits or deletes, the owner included", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Curious", ["everyday_menu", "dishes_prices", "tables_delivery", "close_early"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set price_kes = 333 where id = ${f.regular.id}`)).toBeNull();
      expect(await attempt(tx, "authenticated", staff, (q) => q`select * from public.change_log`)).toEqual([]);
      expect((await attempt(tx, "authenticated", f.ownerId, (q) => q`select * from public.change_log`)).length).toBeGreaterThan(0);
      for (const sub of [staff, f.ownerId]) {
        expect((await as(tx, sub, (q) => q`insert into public.change_log (actor_name, area, action) values ('x', 'menu', 'dish.price')`))?.code).toBe("42501");
        expect((await as(tx, sub, (q) => q`update public.change_log set actor_name = 'x'`))?.code).toBe("42501");
        expect((await as(tx, sub, (q) => q`delete from public.change_log`))?.code).toBe("42501");
        expect((await as(tx, sub, (q) => q`select public.log_change('menu', 'dish.price', null, 'x')`))?.code).toBe("42501");
      }
      expect((await as(tx, null, (q) => q`select * from public.change_log`))?.code).toBe("42501");
    }));
});

describe("anon", () => {
  test("can't reach any of it", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      expect((await as(tx, null, (q) => q`update public.dishes set price_kes = 1 where id = ${f.regular.id}`))).toBeNull(); // RLS: no rows
      const [d] = await tx`select price_kes from public.dishes where id = ${f.regular.id}`;
      expect(d.price_kes).toBe(300);
      expect((await as(tx, null, (q) => q`select public.close_early()`))?.code).toBe("42501");
      expect((await as(tx, null, (q) => q`select public.dashboard_stats(public.nairobi_today())`))?.code).toBe("42501");
      expect((await as(tx, null, (q) => q`select * from public.staff_grants`))?.code).toBe("42501");
    }));
});
