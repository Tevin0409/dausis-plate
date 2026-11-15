// RW2A-02: proves one dish stays on the menu once a day under real concurrency.
// Not part of `bun test` (it commits rows, then removes them). Run on the test database only:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/dausis_test bun scripts/check-menu-entry-race.ts
// Two separate connections, each as the signed-in owner straight against the table (the RLS path
// the planner doesn't guard), add the same dish for today at the same time: one a day entry, one a
// week entry. Round 1 makes the check immediate and holds the transaction open for 2 s, as the
// review's probe did; round 2 leaves it deferred and both commit at the same moment. Each round: exactly one commits, the
// other gets the clash refusal.
import { SQL } from "bun";
import { DEFAULT_TEST_DATABASE_URL } from "../tests/db/config";

const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
if (!/dausis_test/.test(url)) throw new Error(`Refusing to run against ${url}: the test database only.`);

const admin = new SQL(url, { max: 1 });
const owner = crypto.randomUUID();
const dish = crypto.randomUUID();

type Outcome = { kind: string; ok: boolean; code?: string; message?: string; ms: number };

async function round(label: string, immediate: boolean) {
  const conns = [new SQL(url, { max: 1 }), new SQL(url, { max: 1 })];
  const started = Date.now();
  const run = async (conn: SQL, kind: "day" | "week", delay: number): Promise<Outcome> => {
    await Bun.sleep(delay);
    try {
      await conn.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "authenticated", sub: owner })}, true), set_config('role', 'authenticated', true)`;
        await tx`insert into public.menu_entries (dish_id, kind, starts_on, ends_on)
                 values (${dish}, ${kind}::public.entry_kind, public.nairobi_today(), public.nairobi_today())`;
        if (immediate) await tx`set constraints all immediate`;
        await tx`select pg_sleep(${immediate ? 2 : 1})`;
      });
      return { kind, ok: true, ms: Date.now() - started };
    } catch (err) {
      const e = err as { errno?: string; message: string };
      return { kind, ok: false, code: e.errno, message: e.message, ms: Date.now() - started };
    }
  };
  const results = await Promise.all([run(conns[0]!, "day", 0), run(conns[1]!, "week", immediate ? 300 : 0)]);
  await Promise.all(conns.map((c) => c.close()));
  const [{ n }] = await admin`select count(*)::int as n from public.menu_entries where dish_id = ${dish}`;
  for (const r of results) console.log(`  ${label} ${r.kind}: ${r.ok ? "committed" : `refused ${r.code} "${r.message}"`} @${r.ms}ms`);
  const committed = results.filter((r) => r.ok).length;
  const clash = results.find((r) => !r.ok);
  const pass = committed === 1 && n === 1 && clash?.code === "23505" && /already on the menu on/.test(clash.message ?? "");
  console.log(`  ${label}: committed=${committed} rows=${n} ${pass ? "PASS" : "FAIL"}`);
  // Clear the round's entry (triggers off, so the change log isn't written) for the next round.
  await admin.begin(async (tx) => {
    await tx`select set_config('session_replication_role', 'replica', true)`;
    await tx`delete from public.menu_entries where dish_id = ${dish}`;
  });
  return pass;
}

let failure: unknown;
try {
  await admin.begin(async (tx) => {
    await tx`insert into auth.users (id, email) values (${owner}, ${`race-${owner.slice(0, 8)}@test.local`})`;
    await tx`insert into public.staff (user_id, role, display_name) values (${owner}, 'owner', 'Race owner')`;
    await tx`insert into public.dishes (id, name, price_kes) values (${dish}, 'Race probe', 500)`;
  });
  const a = await round("round 1 (immediate, 2 s held)", true);
  const b = await round("round 2 (deferred to commit)", false);
  if (!a || !b) throw new Error("Race check FAILED");
  console.log("PASS");
} catch (e) {
  failure = e;
}

try {
  await admin.begin(async (tx) => {
    await tx`select set_config('session_replication_role', 'replica', true)`;
    await tx`delete from public.change_log where subject_id = ${dish} or actor = ${owner}`;
    await tx`delete from public.menu_entries where dish_id = ${dish}`;
    await tx`delete from public.dishes where id = ${dish}`;
    await tx`delete from public.staff where user_id = ${owner}`;
    await tx`delete from auth.users where id = ${owner}`;
  });
  const [{ n }] = await admin`select (select count(*) from public.dishes where id = ${dish}) + (select count(*) from auth.users where id = ${owner}) as n`;
  console.log(`cleanup: ${Number(n) === 0 ? "rows removed" : "rows LEFT BEHIND"}`);
} catch (e) {
  console.error("cleanup failed:", e);
  failure ??= e;
}
await admin.close();
if (failure) {
  console.error(failure);
  process.exit(1);
}
