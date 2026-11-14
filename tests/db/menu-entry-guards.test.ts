// Review wave 2a fixes, against supabase/migrations/20261111500000_menu_entry_guards.sql.
// RW2A-01: an entry's dish can't change, for anyone. RW2A-02's concurrency proof needs two real
// connections, so it lives in scripts/check-menu-entry-race.ts; here only the single-connection
// behaviour around it is pinned.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures } from "./helpers";

type Tx = TransactionSQL;

async function staffMember(tx: Tx, name: string, jobs: string[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase()}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job})`;
  return u.id as string;
}

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { errno?: string; detail?: string; message: string };
    return { code: e.errno, detail: e.detail || undefined, message: e.message };
  }
}

/** The review's case: a cheap dish's week entry at KSh 10, and a KSh 900 dish on the menu by a day entry. */
async function discounted(tx: Tx) {
  const [cheap] = await tx`insert into public.dishes (name, price_kes) values ('Cheap probe', 100) returning id`;
  const [dear] = await tx`insert into public.dishes (name, price_kes) values ('Dear probe', 900) returning id`;
  const [week] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes)
    values (${cheap.id}, 'week', public.nairobi_today() + 1, public.nairobi_today() + 1, 10) returning id`;
  await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on)
    values (${dear.id}, 'day', public.nairobi_today() + 1, public.nairobi_today() + 1)`;
  return { cheap: cheap.id as string, dear: dear.id as string, week: week.id as string };
}

const moveDish = (tx: Tx, sub: string, entry: string, dish: string) =>
  attempt(tx, "authenticated", sub, (q) => q`update public.menu_entries set dish_id = ${dish} where id = ${entry} returning id`);

describe("RW2A-01: an entry's dish is fixed", () => {
  test("staff without Dishes and prices can't move a special price onto another dish", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const e = await discounted(tx);
      for (const jobs of [[], ["everyday_menu"]]) {
        const cook = await staffMember(tx, `Cook${jobs.length}`, jobs);
        expect(await refusal(moveDish(tx, cook, e.week, e.dear))).toEqual({
          code: "42501",
          detail: "entry_dish_fixed",
          message: "A menu entry’s dish can’t change. Remove it and add the dish again.",
        });
      }
      const [row] = await tx`select dish_id, price_kes from public.menu_entries where id = ${e.week}`;
      expect(row).toEqual({ dish_id: e.cheap, price_kes: 10 });
    }));

  test("the owner, and the database owner itself, are refused too; other columns still save", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const e = await discounted(tx);
      expect((await refusal(moveDish(tx, f.ownerId, e.week, e.dear)))?.detail).toBe("entry_dish_fixed");
      expect((await refusal(tx.savepoint((sp) => sp`update public.menu_entries set dish_id = ${e.dear} where id = ${e.week}`)))?.detail).toBe(
        "entry_dish_fixed",
      );
      // Setting the same dish again is not a change.
      await tx`update public.menu_entries set dish_id = ${e.cheap}, plates_per_day = 7 where id = ${e.week}`;
      expect((await tx`select plates_per_day from public.menu_entries where id = ${e.week}`)[0].plates_per_day).toBe(7);
    }));
});

describe("RW2A-02: the clash check, one connection", () => {
  test("a day entry and a week entry for one dish on one day: the second is refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [d] = await tx`insert into public.dishes (name, price_kes) values ('Clash probe', 500) returning id`;
      await attempt(tx, "authenticated", f.ownerId, (q) => q`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on)
        values (${d.id}, 'day', public.nairobi_today() + 1, public.nairobi_today() + 1) returning id`);
      const r = await refusal(
        attempt(tx, "authenticated", f.ownerId, async (q) => {
          await q`insert into public.menu_entries (dish_id, kind, starts_on, ends_on)
                  values (${d.id}, 'week', public.nairobi_today() + 1, public.nairobi_today() + 1)`;
          return q`set constraints all immediate`;
        }),
      );
      expect(r?.code).toBe("23505");
      expect(r?.message).toBe("Clash probe is already on the menu on " + (await tx`select (public.nairobi_today() + 1)::text as d`)[0].d);
    }));
});
