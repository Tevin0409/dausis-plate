// Proves the credit note counter is gapless and duplicate-free under real concurrency.
// Not part of `bun test` (it commits rows, then removes them). Run on the test database only:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54522/dausis_test bun scripts/check-credit-note-counter.ts
// Two separate connections each issue credit notes in an open transaction at the same time; the second
// has to wait for the first's lock on the counter row. Expect consecutive numbers and no duplicate.
import { SQL } from "bun";
import { DEFAULT_TEST_DATABASE_URL } from "../tests/db/config";
import { dineIn, seedFixtures } from "../tests/db/helpers";

const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
if (!/dausis_test/.test(url)) throw new Error(`Refusing to run against ${url}: the test database only.`);

const admin = new SQL(url, { max: 1 });
const PER_CONN = 3;

const tables = ["orders", "credit_notes", "staff", "dishes", "menu_entries", "dining_tables", "change_log"] as const;
const count = async (t: string) => Number((await admin.unsafe(`select count(*)::int as n from public.${t}`))[0].n);
async function snapshot() {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = await count(t).catch(() => -1);
  const [c] = await admin`select last_number from public.credit_note_counter`;
  out.counter = Number(c.last_number);
  return out;
}

const before = await snapshot();
const created: { owner?: string; orders: string[] } = { orders: [] };

async function asOwner(q: SQL, owner: string) {
  await q`select set_config('request.jwt.claims', ${JSON.stringify({ role: "authenticated", sub: owner })}, true), set_config('role', 'authenticated', true)`;
}
const reset = (q: SQL) => q`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`;

let fixtures: Awaited<ReturnType<typeof seedFixtures>> | undefined;
let failure: unknown;
try {
  // Committed setup: an owner, and six orders that are paid and then cancelled.
  await admin.begin(async (tx) => {
    fixtures = await seedFixtures(tx);
    created.owner = fixtures.ownerId;
    for (let i = 0; i < PER_CONN * 2; i++) {
      await tx`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      const payload = dineIn(fixtures, [{ dish_id: fixtures.regular.id, quantity: 1 }], { customer_name: `Counter ${i}` });
      const [placed] = await tx`select * from public.place_order(${JSON.stringify(payload)}::text::jsonb)`;
      await reset(tx);
      const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
      created.orders.push(row.id);
      await asOwner(tx, fixtures.ownerId);
      await tx`select public.mark_order_paid(${row.id}::uuid, 'cash'::public.paid_with)`;
      await tx`select public.cancel_order(${row.id}::uuid, 'new'::public.order_status, 'customer_asked'::public.cancel_reason, null)`;
      await reset(tx);
    }
  });

  const owner = fixtures!.ownerId;
  const conns = [new SQL(url, { max: 1 }), new SQL(url, { max: 1 })];
  const started = Date.now();
  const run = (conn: SQL, ids: string[], tag: string) =>
    conn.begin(async (tx) => {
      await asOwner(tx, owner);
      const got: { number: number; at: number }[] = [];
      for (const id of ids) {
        const [r] = await tx`select public.issue_credit_note(${id}::uuid, 100, ${"Refund: " + tag}, 'cash'::public.paid_with) as r`;
        got.push({ number: (r.r as { number: number }).number, at: Date.now() - started });
        await tx`select pg_sleep(0.2)`; // keep the lock held so the other connection has to wait
      }
      return got;
    });
  const [a, b] = await Promise.all([
    run(conns[0]!, created.orders.slice(0, PER_CONN), "conn A"),
    run(conns[1]!, created.orders.slice(PER_CONN), "conn B"),
  ]);
  await Promise.all(conns.map((c) => c.close()));

  const all = [...a, ...b].map((x) => x.number).sort((x, y) => x - y);
  const expected = Array.from({ length: PER_CONN * 2 }, (_, i) => before.counter! + 1 + i);
  console.log("conn A:", a.map((x) => `${x.number}@${x.at}ms`).join(" "));
  console.log("conn B:", b.map((x) => `${x.number}@${x.at}ms`).join(" "));
  console.log("sorted:", all.join(","));
  const consecutive = JSON.stringify(all) === JSON.stringify(expected);
  const unique = new Set(all).size === all.length;
  const serialised = Date.now() - started >= PER_CONN * 2 * 200 * 0.9; // two transactions held the counter in turn
  console.log(`unique=${unique} consecutive=${consecutive} (expected ${expected[0]}..${expected.at(-1)}) serialised=${serialised}`);
  if (!unique || !consecutive || !serialised) throw new Error("Counter check FAILED");
  console.log("PASS");
} catch (e) {
  failure = e;
}

// Clean up: the rows this run created, then the counter back to where it was.
try {
  await admin.begin(async (tx) => {
    await tx`select set_config('session_replication_role', 'replica', true)`;
    const ids = created.orders;
    if (ids.length) {
      await tx`delete from public.change_log where subject_id in ${tx(ids)} or subject_id in (select id from public.credit_notes where order_id in ${tx(ids)})`;
      await tx`delete from public.credit_notes where order_id in ${tx(ids)}`;
      await tx`delete from public.order_items where order_id in ${tx(ids)}`;
      await tx`delete from public.orders where id in ${tx(ids)}`;
    }
    if (fixtures) {
      const entries = [fixtures.openEntry.id, fixtures.closedEntry.id];
      await tx`delete from public.menu_entry_days where entry_id in ${tx(entries)}`;
      await tx`delete from public.menu_entry_off_days where entry_id in ${tx(entries)}`;
      await tx`delete from public.menu_entry_undo where entry_id in ${tx(entries)}`;
      await tx`delete from public.menu_entries where id in ${tx(entries)}`;
      await tx`delete from public.dish_options where id = ${fixtures.option.id}`;
      await tx`delete from public.dishes where id in (${fixtures.regular.id}, ${fixtures.rotating.id}, ${fixtures.late.id})`;
      await tx`delete from public.dining_tables where id = ${fixtures.table.id}`;
      await tx`delete from public.staff where user_id = ${fixtures.ownerId}`;
      await tx`delete from auth.users where id = ${fixtures.ownerId}`;
    }
    await tx`update public.credit_note_counter set last_number = ${before.counter}`;
  });
  const after = await snapshot();
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`cleanup: ${same ? "rows back to baseline" : "DIFFERS from baseline"}`, same ? "" : JSON.stringify({ before, after }));
  if (!same && !failure) failure = new Error("cleanup left rows behind");
} catch (e) {
  console.error("cleanup failed:", e);
  failure ??= e;
}
await admin.close();
if (failure) {
  console.error(failure);
  process.exit(1);
}
