// delete_dish (supabase/migrations/20261106000000_delete_dish.sql), called as the dashboard
// does: as an authenticated user, RLS applying. Each call runs in a savepoint so a
// rejection leaves the test transaction usable and undoes only that call.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { dineIn, inTx, placeOrder, seedFixtures } from "./helpers";

type Result = { result: "deleted" | "archived" | "missing"; photo_key?: string | null };

function deleteDish(tx: TransactionSQL, sub: string | null, dishId: string): Promise<Result> {
  const role = sub ? "authenticated" : "anon";
  return tx.savepoint(async (sp) => {
    await sp`select set_config('request.jwt.claims', ${JSON.stringify(sub ? { role, sub } : { role })}, true), set_config('role', ${role}, true)`;
    const [row] = await sp`select public.delete_dish(${dishId}::uuid) as r`;
    await sp`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`;
    return row.r as Result;
  });
}

async function state(tx: TransactionSQL, dishId: string) {
  const [dish] = await tx`select archived, is_regular from public.dishes where id = ${dishId}`;
  const entries = await tx`select starts_on < public.nairobi_today() as past, published from public.menu_entries where dish_id = ${dishId} order by starts_on`;
  return { dish: dish ?? null, entries: entries.map((e: { past: boolean; published: boolean }) => ({ past: e.past, published: e.published })) };
}

describe("delete_dish", () => {
  test("a dish never ordered is removed with its menu entries and returns its photo key", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const key = `dishes/${f.rotating.id}/full.webp`;
      await tx`update public.dishes set photo_key = ${key} where id = ${f.rotating.id}`;
      expect(await deleteDish(tx, f.ownerId, f.rotating.id)).toEqual({ result: "deleted", photo_key: key });
      expect(await state(tx, f.rotating.id)).toEqual({ dish: null, entries: [] });
    }));

  test("a dish with past orders is archived; upcoming entries are unpublished, past ones kept", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`
        insert into public.menu_entries (dish_id, kind, starts_on, ends_on, show_from, show_until)
        values (${f.rotating.id}, 'day', public.nairobi_today() - 7, public.nairobi_today() - 7, '11:00', '20:00')`;
      await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]));
      expect(await deleteDish(tx, f.ownerId, f.rotating.id)).toEqual({ result: "archived" });
      expect(await state(tx, f.rotating.id)).toEqual({
        dish: { archived: true, is_regular: false },
        entries: [{ past: true, published: true }, { past: false, published: false }, { past: false, published: false }],
      });
    }));

  test("if deleting the dish fails, its menu entries stay: nothing is half-removed", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const before = await state(tx, f.rotating.id);
      // Stands in for any failure of the final delete (dropped connection, lock timeout, ...).
      await tx`create function public.test_fail_dish_delete() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$`;
      await tx`create trigger test_fail_dish_delete before delete on public.dishes for each row execute function public.test_fail_dish_delete()`;
      await expect(deleteDish(tx, f.ownerId, f.rotating.id)).rejects.toThrow("simulated failure");
      expect(await state(tx, f.rotating.id)).toEqual(before);
      expect(before.entries.length).toBe(2);
    }));

  test("a dish that no longer exists reports missing", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      expect(await deleteDish(tx, f.ownerId, "00000000-0000-4000-8000-000000000000")).toEqual({ result: "missing" });
    }));

  test("only staff may call it: a signed-in non-staff user is refused and nothing changes", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [stranger] = await tx`insert into auth.users (email) values ('stranger@test.local') returning id`;
      const before = await state(tx, f.rotating.id);
      await expect(deleteDish(tx, stranger.id, f.rotating.id)).rejects.toThrow("Not allowed");
      expect(await state(tx, f.rotating.id)).toEqual(before);
    }));

  test("anon cannot execute it at all", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await expect(deleteDish(tx, null, f.rotating.id)).rejects.toThrow(/permission denied/);
    }));
});

describe("place_order and delivery areas", () => {
  test("delivery is refused when no area is on (unchanged server rule, RQA-02)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [zone] = await tx`insert into public.delivery_zones (name, fee_kes, active) values ('Test area', 150, false) returning id`;
      await tx`update public.delivery_zones set active = false`;
      const order = dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], {
        mode: "delivery",
        table_token: null,
        delivery_zone_id: zone.id,
        delivery_address: "Test street 1",
      });
      await expect(placeOrder(tx, order)).rejects.toThrow("Choose a delivery area");
    }));
});
