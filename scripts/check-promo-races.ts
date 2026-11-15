// Slice 2.11: proves the promo races hold under real concurrency, with two connections each.
// Not part of `bun test` (it commits rows, then removes them). Run on the test database only:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/dausis_test bun scripts/check-promo-races.ts
// 1. A code's last use: two orders with a one-use code. The first holds its transaction open for
//    1 s after place_order; the second waits on the code row's lock, then sees the use. One order,
//    one refusal with hint discount_code:used_up.
// 2. A combo's last plate: two orders for a combo whose dish has 1 plate left. One order, one
//    refusal (sold_out), and plates_sold ends at 1.
// 3. Ads: two overlapping drafts in the same space approved at the same moment. One approved, one
//    refused with the overlap message.
// 4. Ads (R211-01): an approved ad's end date extended into a draft's days while that draft is
//    approved, each way round. One wins; the other is refused with the overlap message.
import { SQL } from "bun";
import { DEFAULT_TEST_DATABASE_URL } from "../tests/db/config";

const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
if (!/dausis_test/.test(url)) throw new Error(`Refusing to run against ${url}: the test database only.`);

const admin = new SQL(url, { max: 1 });
const owner = crypto.randomUUID();
const regular = crypto.randomUUID();
const special = crypto.randomUUID();
const entry = crypto.randomUUID();
const combo = crypto.randomUUID();
const table = crypto.randomUUID();
const codeId = crypto.randomUUID();
const adIds = [crypto.randomUUID(), crypto.randomUUID()];
const editIds = [crypto.randomUUID(), crypto.randomUUID()];
const NAME = "Race customer";
/** A uuid[] parameter (the driver sends JS arrays in a form uuid[] won't take). */
const arr = (ids: string[]) => `{${ids.join(",")}}`;

type Outcome = { ok: boolean; code?: string; detail?: string; hint?: string; message?: string; ms: number };
type Claims = { role: "anon" | "authenticated"; sub?: string };

/** Runs `body` on its own connection as `claims`, then holds the transaction open for `hold` seconds. */
async function race(bodies: { delay: number; hold: number; claims: Claims; body: (tx: SQL) => Promise<unknown> }[]) {
  const conns = bodies.map(() => new SQL(url, { max: 1 }));
  const started = Date.now();
  const results = await Promise.all(bodies.map(async (b, i): Promise<Outcome> => {
    await Bun.sleep(b.delay);
    try {
      await conns[i]!.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(b.claims)}, true), set_config('role', ${b.claims.role}, true)`;
        await b.body(tx as unknown as SQL);
        if (b.hold) await tx`select pg_sleep(${b.hold})`;
      });
      return { ok: true, ms: Date.now() - started };
    } catch (err) {
      const e = err as { errno?: string; detail?: string; hint?: string; message: string };
      return { ok: false, code: e.errno, detail: e.detail, hint: e.hint, message: e.message, ms: Date.now() - started };
    }
  }));
  await Promise.all(conns.map((c) => c.close()));
  return results;
}

const anon: Claims = { role: "anon" };
const order = (extra: Record<string, unknown>) => (tx: SQL) => tx`select * from public.place_order(${JSON.stringify({
  mode: "dine_in", table_token: `race-${table}`, customer_name: NAME, customer_phone: "0712345678",
  payment_method: "on_handover", idempotency_key: crypto.randomUUID(), items: [], ...extra,
})}::text::jsonb)`;

function report(label: string, results: Outcome[], pass: boolean) {
  for (const [i, r] of results.entries())
    console.log(`  ${label} #${i + 1}: ${r.ok ? "committed" : `refused ${r.code} ${r.detail ?? ""} ${r.hint ?? ""} "${r.message}"`} @${r.ms}ms`);
  console.log(`  ${label}: ${pass ? "PASS" : "FAIL"}`);
  return pass;
}

let failure: unknown;
let hours: Record<string, unknown>[] = [];
let kitchen: Record<string, unknown> | undefined;
let closed: Record<string, unknown>[] = [];
try {
  hours = await admin`select weekday, is_open, opens, closes from public.opening_hours`;
  [kitchen] = await admin`select last_orders_minutes, closed_early_on, closed_early_at from public.kitchen_settings`;
  closed = await admin`select * from public.closed_dates`;
  await admin.begin(async (tx) => {
    await tx`update public.opening_hours set is_open = true, opens = '00:00', closes = '24:00'`;
    await tx`update public.kitchen_settings set last_orders_minutes = 0, closed_early_on = null, closed_early_at = null`;
    await tx`delete from public.closed_dates`;
    await tx`insert into auth.users (id, email) values (${owner}, ${`race-${owner.slice(0, 8)}@test.local`})`;
    await tx`insert into public.staff (user_id, role, display_name) values (${owner}, 'owner', 'Race owner')`;
    await tx`insert into public.dining_tables (id, label, qr_token) values (${table}, 'Race table', ${`race-${table}`})`;
    await tx`insert into public.dishes (id, name, price_kes, is_regular) values (${regular}, 'Race chapati', 300, true)`;
    await tx`insert into public.dishes (id, name, price_kes) values (${special}, 'Race pilau', 500)`;
    await tx`insert into public.menu_entries (id, dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
             values (${entry}, ${special}, 'day', public.nairobi_today(), public.nairobi_today(), 1, '00:00', '23:59:59')`;
    await tx`insert into public.combos (id, name, price_kes) values (${combo}, 'Race combo', 700)`;
    await tx`insert into public.combo_items (combo_id, dish_id, quantity, sort_order) values (${combo}, ${regular}, 1, 0), (${combo}, ${special}, 1, 1)`;
    await tx`insert into public.discount_codes (id, code, kind, value, cap_kes, ends_on, max_uses, once_per_phone)
             values (${codeId}, 'RACEONE', 'percent', 10, 300, public.nairobi_today() + 1, 1, false)`;
  });

  const [state] = await admin`select public.kitchen_status()->>'state' s`;
  if (state!.s !== "open") throw new Error(`The test kitchen isn't open (${state!.s}); can't place orders.`);

  // 1. The code's last use.
  const items = [{ dish_id: regular, quantity: 1 }];
  const r1 = await race([
    { delay: 0, hold: 1, claims: anon, body: order({ items, discount_code: "RACEONE" }) },
    { delay: 200, hold: 0, claims: anon, body: order({ items, discount_code: "RACEONE" }) },
  ]);
  const [{ n: uses }] = await admin`select count(*)::int n from public.orders where discount_code_id = ${codeId}`;
  const a = report("last use", r1, r1.filter((r) => r.ok).length === 1 && uses === 1
    && r1.some((r) => !r.ok && r.hint === "discount_code:used_up"));

  // 2. The combo's last plate.
  const combos = [{ combo_id: combo, quantity: 1, parts: [{ dish_id: regular }, { dish_id: special, menu_entry_id: entry }] }];
  const r2 = await race([
    { delay: 0, hold: 1, claims: anon, body: order({ combos }) },
    { delay: 200, hold: 0, claims: anon, body: order({ combos }) },
  ]);
  const [{ n: sold }] = await admin`select coalesce(max(plates_sold), 0)::int n from public.menu_entry_days where entry_id = ${entry}`;
  const b = report("combo last plate", r2, r2.filter((r) => r.ok).length === 1 && sold === 1
    && r2.some((r) => !r.ok && r.detail === "sold_out"));

  // 3. Two overlapping ads approved at once.
  await admin.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "authenticated", sub: owner })}, true), set_config('role', 'authenticated', true)`;
    for (const [i, id] of adIds.entries())
      await tx`insert into public.ads (id, advertiser, line, link_label, link_url, space, starts_on, ends_on)
               values (${id}, ${`Race ad ${i + 1}`}, 'Fresh bread every morning', 'See more', 'https://race.example', 'menu',
                       public.nairobi_today() + 400, public.nairobi_today() + 410)`;
  });
  const asOwner: Claims = { role: "authenticated", sub: owner };
  const r3 = await race(adIds.map((id, i) => ({
    delay: i * 200, hold: i === 0 ? 1 : 0, claims: asOwner,
    body: (tx: SQL) => tx`select public.ad_action(${id}::uuid, 'approve')`,
  })));
  const [{ n: approved }] = await admin`select count(*)::int n from public.ads where id = any(${arr(adIds)}::uuid[]) and approved_at is not null`;
  const c = report("ad approvals", r3, r3.filter((r) => r.ok).length === 1 && approved === 1);

  // 4. An end-date edit against an approval, each holding first in turn.
  const edit = (to: number) => (tx: SQL) => tx`update public.ads set ends_on = public.nairobi_today() + ${to}::int where id = ${editIds[0]!}`;
  const approve = (tx: SQL) => tx`select public.ad_action(${editIds[1]!}::uuid, 'approve')`;
  let d = true;
  for (const [label, first, second] of [["edit first", edit(503), approve], ["approval first", approve, edit(503)]] as const) {
    await admin.begin(async (tx) => {
      // The first round's ads, as the database owner: an approved ad can't be deleted through the API.
      await tx`select set_config('session_replication_role', 'replica', true)`;
      await tx`delete from public.change_log where subject_id = any(${arr(editIds)}::uuid[])`;
      await tx`delete from public.ads where id = any(${arr(editIds)}::uuid[])`;
      await tx`select set_config('session_replication_role', 'origin', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "authenticated", sub: owner })}, true), set_config('role', 'authenticated', true)`;
      await tx`insert into public.ads (id, advertiser, line, link_label, link_url, space, starts_on, ends_on)
               values (${editIds[0]!}, 'Race edit A', 'Fresh bread every morning', 'See more', 'https://race.example', 'order',
                       public.nairobi_today() + 500, public.nairobi_today() + 501),
                      (${editIds[1]!}, 'Race edit B', 'Fresh bread every morning', 'See more', 'https://race.example', 'order',
                       public.nairobi_today() + 502, public.nairobi_today() + 503)`;
      await tx`select public.ad_action(${editIds[0]!}::uuid, 'approve')`;
    });
    const r4 = await race([
      { delay: 0, hold: 1, claims: asOwner, body: first },
      { delay: 200, hold: 0, claims: asOwner, body: second },
    ]);
    const [{ n: overlap }] = await admin`
      select count(*)::int n from public.ads a join public.ads b on a.id = ${editIds[0]!} and b.id = ${editIds[1]!}
       where a.approved_at is not null and b.approved_at is not null and a.ends_on >= b.starts_on`;
    d = report(`end-date edit, ${label}`, r4, r4.filter((r) => r.ok).length === 1 && overlap === 0
      && r4.some((r) => !r.ok && r.detail === "ad_overlap")) && d;
  }

  if (!a || !b || !c || !d) throw new Error("Promo race check FAILED");
  console.log("PASS");
} catch (e) {
  failure = e;
}

try {
  await admin.begin(async (tx) => {
    await tx`select set_config('session_replication_role', 'replica', true)`;
    const ids = (await tx`select id from public.orders where customer_name = ${NAME}`).map((r: { id: string }) => r.id);
    await tx`delete from public.order_item_extras where order_item_id in (select id from public.order_items where order_id = any(${arr(ids)}::uuid[]))`;
    await tx`delete from public.order_items where order_id = any(${arr(ids)}::uuid[])`;
    await tx`delete from public.order_combos where order_id = any(${arr(ids)}::uuid[])`;
    await tx`delete from public.orders where id = any(${arr(ids)}::uuid[])`;
    await tx`delete from public.change_log where actor = ${owner} or subject_id = any(${arr([...adIds, ...editIds, combo, codeId])}::uuid[])`;
    await tx`delete from public.ads where id = any(${arr([...adIds, ...editIds])}::uuid[])`;
    await tx`delete from public.discount_codes where id = ${codeId}`;
    await tx`delete from public.combo_items where combo_id = ${combo}`;
    await tx`delete from public.combos where id = ${combo}`;
    await tx`delete from public.menu_entry_days where entry_id = ${entry}`;
    await tx`delete from public.menu_entries where id = ${entry}`;
    await tx`delete from public.dishes where id in (${regular}, ${special})`;
    await tx`delete from public.dining_tables where id = ${table}`;
    await tx`delete from public.staff where user_id = ${owner}`;
    await tx`delete from auth.users where id = ${owner}`;
    for (const h of hours)
      await tx`update public.opening_hours set is_open = ${h.is_open}, opens = ${h.opens}, closes = ${h.closes} where weekday = ${h.weekday}`;
    if (kitchen) await tx`update public.kitchen_settings set ${tx(kitchen)}`;
    for (const d of closed) await tx`insert into public.closed_dates ${tx(d)} on conflict do nothing`;
  });
  const [{ n }] = await admin`
    select (select count(*) from public.orders where customer_name = ${NAME})
         + (select count(*) from public.dishes where id in (${regular}, ${special}))
         + (select count(*) from public.ads where id = any(${arr([...adIds, ...editIds])}::uuid[]))
         + (select count(*) from auth.users where id = ${owner}) as n`;
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
