// Slice 2.11 in Reports (spec-2.12 "Promos & ads", Tevin's Food A): Food stays at menu value with a
// Discounts figure next to it, so Food − Discounts + Fees = Sales; the order sheet and the CSV carry the
// discount and code; report_promos_ads gives codes, combos and the ads for invoicing.
// Orders are moved to April 2020, away from seed.sql's weeks, so the figures are exact.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = "2020-04-01";

const asOwner = async (tx: Tx, f: Fixtures, fn: (q: Tx) => PromiseLike<unknown>) =>
  (await attempt(tx, "authenticated", f.ownerId, fn as never)) as [Row, ...Row[]];

async function setup(tx: Tx) {
  const f = await seedFixtures(tx);
  const [combo] = await asOwner(tx, f, (q) => q`select public.save_combo(${JSON.stringify({
    name: "Report combo", price_kes: 700, items: [{ dish_id: f.regular.id, quantity: 1 }, { dish_id: f.rotating.id, quantity: 1 }],
  })}::text::jsonb) id`);
  await tx`insert into public.discount_codes (code, kind, value, cap_kes, starts_on, ends_on, modes, once_per_phone)
           values ('RPTTEN', 'percent', 10, 300, public.nairobi_today(), public.nairobi_today() + 30, '{dine_in,pickup,delivery}', false),
                  ('RPTOFF', 'amount', 50, null, public.nairobi_today(), public.nairobi_today() + 30, '{dine_in,pickup,delivery}', false)`;
  const [zone] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Report area', 150, 0) returning *`;
  const combos = [{ combo_id: combo!.id, quantity: 2, parts: [
    { dish_id: f.regular.id }, { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, extra_ids: [f.option.id] }] }];
  // A: dine-in, 300 regular + 2 × (700 + 50 extra) = 1800, no code.
  const a = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { combos }));
  // B: delivery, 2 × 300 = 600, RPTTEN −60, fee 150: 690.
  const b = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 2 }], {
    mode: "delivery", table_token: null, delivery_zone_id: zone!.id, delivery_address: "Hse 4", discount_code: "RPTTEN" }));
  // C: dine-in with RPTTEN, then cancelled: counts nowhere.
  const c = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }], { discount_code: "RPTTEN" }));
  await asOwner(tx, f, (q) => q`select public.cancel_order((select id from public.orders where public_token = ${c.public_token}),
    'new'::public.order_status, 'customer_asked'::public.cancel_reason, null)`);
  await tx`update public.orders set created_at = ${`${DAY}T12:00:00+03:00`}::timestamptz, status_changed_at = ${`${DAY}T12:00:00+03:00`}::timestamptz
           where public_token in (${a.public_token}, ${b.public_token}, ${c.public_token})`;
  await tx`update public.discount_codes set active = false where code = 'RPTOFF'`;
  return { f, a, b, c };
}

describe("Food A: Food − Discounts + Fees = Sales", () => {
  test("report_sales by bucket and report_delivery by area", () =>
    inTx(async (tx) => {
      const { f } = await setup(tx);
      const [{ r }] = await asOwner(tx, f, (q) => q`select public.report_sales(${DAY}::date, ${DAY}::date) r`);
      expect(r.by_bucket).toEqual([{ bucket: DAY, sales: 2490, orders: 2, food: 2400, discounts: 60, fees: 150 }]);
      const [{ r: d }] = await asOwner(tx, f, (q) => q`select public.report_delivery(${DAY}::date, ${DAY}::date) r`);
      expect(d.zones).toEqual([{ zone: "Report area", orders: 1, fees: 150, food: 600, discounts: 60 }]);
    }));
});

describe("the order sheet and the CSV", () => {
  test("report_order: the discount and code; a combo with its dishes; the own lines without combo dishes", () =>
    inTx(async (tx) => {
      const { f, a, b } = await setup(tx);
      const [{ r: sa }] = await asOwner(tx, f, (q) => q`select public.report_order(${a.code}) r`);
      expect(sa.items).toEqual([{ name: "Test regular", option: null, quantity: 1, unit: 300 }]);
      expect(sa.combos).toEqual([{ name: "Report combo", quantity: 2, unit: 750, dishes: [
        { name: "Test regular", option: null, quantity: 1 }, { name: "Test rotating", option: null, quantity: 1 }] }]);
      expect([sa.discount, sa.discount_code, sa.subtotal, sa.total]).toEqual([0, null, 1800, 1800]);
      const [{ r: sb }] = await asOwner(tx, f, (q) => q`select public.report_order(${b.code}) r`);
      expect([sb.subtotal, sb.discount, sb.discount_code, sb.fee, sb.total]).toEqual([600, 60, "RPTTEN", 150, 690]);
    }));

  test("report_orders_csv: the discount and code columns, and the combo in the items", () =>
    inTx(async (tx) => {
      const { f, a, b } = await setup(tx);
      const rows = await asOwner(tx, f, (q) => q`select * from public.report_orders_csv(${DAY}::date, ${DAY}::date)`);
      const by = Object.fromEntries(rows.map((x) => [x.code, x]));
      expect(by[a.code]).toMatchObject({ items: "1× Test regular; 2× Report combo (Test regular, Test rotating)",
        subtotal_kes: 1800, fee_kes: 0, discount_kes: 0, discount_code: "", total_kes: 1800 });
      expect(by[b.code]).toMatchObject({ subtotal_kes: 600, fee_kes: 150, discount_kes: 60, discount_code: "RPTTEN", total_kes: 690 });
    }));
});

describe("report_promos_ads", () => {
  test("codes: uses over orders that aren't cancelled; an unused, switched-off code shows 0", () =>
    inTx(async (tx) => {
      const { f } = await setup(tx);
      const [{ r }] = await asOwner(tx, f, (q) => q`select public.report_promos_ads(${DAY}::date, ${DAY}::date) r`);
      const mine = r.codes.filter((c: Row) => c.code.startsWith("RPT"));
      expect(mine).toEqual([
        { code: "RPTTEN", active: true, uses: 1, discount: 60, sales: 690 },
        { code: "RPTOFF", active: false, uses: 0, discount: 0, sales: 0 },
      ]);
    }));

  test("combos: sold and revenue with choices and extras, counted once", () =>
    inTx(async (tx) => {
      const { f } = await setup(tx);
      const [{ r }] = await asOwner(tx, f, (q) => q`select public.report_promos_ads(${DAY}::date, ${DAY}::date) r`);
      expect(r.combos.filter((c: Row) => c.combo === "Report combo")).toEqual([{ combo: "Report combo", sold: 2, revenue: 1500 }]);
    }));

  test("ads: this period or each ad's whole run; ads with no views are left out", () =>
    inTx(async (tx) => {
      const { f } = await setup(tx);
      const ads = await tx`
        insert into public.ads (advertiser, line, link_label, link_url, space, starts_on, ends_on, approved_at)
        values ('Report bakery', 'Bread', 'See', 'https://bakery.example', 'menu', '2020-03-25', '2020-04-10', now()),
               ('Report tailor', 'Suits', 'See', 'https://tailor.example', 'order', '2020-03-20', '2020-03-31', now()),
               ('Report quiet', 'Hush', 'See', 'https://quiet.example', 'menu', '2020-04-01', '2020-04-02', now())
        returning id, advertiser`;
      const id = Object.fromEntries(ads.map((x: Row) => [x.advertiser, x.id]));
      await tx`insert into public.ad_daily_counts (ad_id, day, views, taps) values
        (${id["Report bakery"]}, '2020-03-28', 40, 2), (${id["Report bakery"]}, ${DAY}, 60, 3),
        (${id["Report tailor"]}, '2020-03-22', 80, 4), (${id["Report quiet"]}, ${DAY}, 0, 0)`;
      const run = async (whole: boolean) => {
        const [{ r }] = await asOwner(tx, f, (q) => q`select public.report_promos_ads(${DAY}::date, ${DAY}::date, ${whole}) r`);
        return r.ads.filter((x: Row) => x.advertiser.startsWith("Report")).map((x: Row) => [x.advertiser, x.views, x.taps]);
      };
      expect(await run(false)).toEqual([["Report bakery", 60, 3]]);
      expect(await run(true)).toEqual([["Report bakery", 100, 5], ["Report tailor", 80, 4]]);
    }));

  test("staff and anon are refused", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      const [u] = await tx`insert into auth.users (email) values ('staff-rpt@test.local') returning id`;
      await tx`insert into public.staff (user_id, role, display_name) values (${u!.id}, 'staff', 'Otieno')`;
      const call = (q: Tx) => q`select public.report_promos_ads(${DAY}::date, ${DAY}::date)`;
      const err = (p: Promise<unknown>) => p.then(() => null, (e: { errno?: string }) => e.errno ?? "error");
      expect(await err(attempt(tx, "authenticated", u!.id, call as never))).toBe("42501");
      expect(await err(attempt(tx, "anon", null, call as never))).not.toBeNull();
    }));
});
