// Every test runs in one transaction that is always rolled back, so the suite
// seeds its own data and leaves nothing behind. Calls that are expected to fail
// run in a savepoint so the transaction stays usable.
import { SQL, type TransactionSQL } from "bun";
import { DEFAULT_TEST_DATABASE_URL } from "./config";

// One pool shared by every test file; bun closes it when the test run exits.
export const sql = new SQL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);

type Tx = TransactionSQL;
type Q = SQL; // a transaction or a savepoint
type Rows = Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

class Rollback extends Error {}

export async function inTx(fn: (tx: Tx) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

/** Runs `fn` as an API caller: `anon`, or `authenticated` with the given user id. RLS applies. */
async function asCaller<T>(q: Q, role: "anon" | "authenticated", sub: string | null, fn: () => PromiseLike<T>): Promise<T> {
  const claims = JSON.stringify(sub ? { role, sub } : { role });
  await q`select set_config('request.jwt.claims', ${claims}, true), set_config('role', ${role}, true)`;
  const result = await fn();
  // On failure there is nothing to undo: the savepoint or transaction rollback reverts these settings.
  await q`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`;
  return result;
}

export type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

/** Our own menu, independent of seed.sql: one regular dish and one rotating dish with two entries. */
export async function seedFixtures(tx: Tx) {
  const [owner] = await tx`insert into auth.users (email) values ('owner@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${owner.id}, 'owner', 'Test owner')`;
  const [regular] = await tx`
    insert into public.dishes (name, price_kes, is_regular, updated_at)
    values ('Test regular', 300, true, '2020-01-01') returning *`;
  const [rotating] = await tx`
    insert into public.dishes (name, price_kes, updated_at)
    values ('Test rotating', 500, '2020-01-01') returning *`;
  const [option] = await tx`
    insert into public.dish_options (dish_id, label, price_delta_kes) values (${rotating.id}, 'Extra kachumbari', 50) returning *`;
  // Open all day, with its own price (450) and 3 plates.
  const [openEntry] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day, show_from, show_until)
    values (${rotating.id}, 'day', public.nairobi_today(), public.nairobi_today(), 450, 3, '00:00', '23:59:59')
    returning *`;
  // Today, but its serving window is a minute on the far side of the clock from now.
  // A `week` entry: one live entry per dish, kind and start day is allowed (menu_entries_one_per_day).
  const [closedEntry] = await tx`
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
    select ${rotating.id}, 'week', public.nairobi_today(), public.nairobi_today(), 10, w.f, w.f + interval '1 minute'
    from (select case when public.nairobi_time() >= '12:00' then '00:00'::time else '23:00'::time end as f) w
    returning *`;
  const [table] = await tx`insert into public.dining_tables (label) values ('Test table') returning *`;
  return { ownerId: owner.id as string, regular, rotating, option, openEntry, closedEntry, table };
}

type Item = { dish_id: string; quantity: number; menu_entry_id?: string; option_id?: string } & Record<string, unknown>;

export function dineIn(f: Fixtures, items: Item[], extra: Record<string, unknown> = {}) {
  return {
    mode: "dine_in",
    table_token: f.table.qr_token,
    customer_name: "Test customer",
    customer_phone: "0712345678",
    payment_method: "on_handover",
    idempotency_key: crypto.randomUUID(),
    items,
    ...extra,
  };
}

/** Calls place_order exactly as the shop does: as the anon role. Rejections roll back to a savepoint. */
export function placeOrder(tx: Tx, payload: object) {
  return tx.savepoint((sp) =>
    asCaller(sp, "anon", null, async () => {
      const [row] = await sp`select * from public.place_order(${JSON.stringify(payload)}::text::jsonb)`;
      return row as { public_token: string; code: string; total_kes: number; replayed: boolean };
    }),
  );
}

/** Runs `fn` as the signed-in owner (role authenticated, RLS applies). */
export function asOwner(tx: Tx, f: Fixtures, fn: () => PromiseLike<Rows>): Promise<Rows> {
  return asCaller(tx, "authenticated", f.ownerId, fn);
}

/** Runs `fn` as an API caller in a savepoint, so an expected rejection leaves the transaction usable. */
export function attempt(tx: Tx, role: "anon" | "authenticated", sub: string | null, fn: (sp: Q) => PromiseLike<Rows>): Promise<Rows> {
  return tx.savepoint((sp) => asCaller(sp, role, sub, () => fn(sp)));
}

export async function platesSold(tx: Tx, entryId: string) {
  const [row] = await tx`
    select plates_sold from public.menu_entry_days where entry_id = ${entryId} and day = public.nairobi_today()`;
  return row ? (row.plates_sold as number) : 0;
}

/** Back-dates timestamps without firing triggers, so a later trigger stamp is visible inside one transaction. */
export async function backdateOrder(tx: Tx, publicToken: string) {
  await tx`select set_config('session_replication_role', 'replica', true)`;
  await tx`update public.orders set updated_at = '2020-01-01', status_changed_at = '2020-01-01' where public_token = ${publicToken}`;
  await tx`select set_config('session_replication_role', 'origin', true)`;
}
