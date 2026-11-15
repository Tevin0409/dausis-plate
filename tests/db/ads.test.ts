// Slice 2.11 part A: neighbour ads and Mama's picks (spec-2.11-ads-promos.md, "Tests: Ads, Picks").
// Straight at the database, as a direct API call would. The two-connection approval race is in
// scripts/check-promo-races.ts.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures } from "./helpers";

type Tx = TransactionSQL;
type Q = Parameters<Parameters<typeof attempt>[3]>[0];
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function person(tx: Tx, role: "owner" | "staff", name: string, jobs: string[] = []) {
  const [u] = await tx`insert into auth.users (email) values (${`${name.toLowerCase()}@test.local`}) returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, ${role}, ${name})`;
  for (const job of jobs) await tx`insert into public.staff_grants (user_id, job) values (${u.id}, ${job}::public.staff_grant)`;
  return u.id as string;
}

/** Runs `fn` as `sub` (anon when null); null on success, else the SQLSTATE, message and detail. */
async function as(tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<unknown>) {
  try {
    await attempt(tx, sub ? "authenticated" : "anon", sub, async (q) => {
      await fn(q);
      return [];
    });
    return null;
  } catch (err) {
    const e = err as { errno?: string; message: string; detail?: string };
    return { code: e.errno, message: e.message, detail: e.detail ?? null };
  }
}

function run(tx: Tx, sub: string | null, fn: (q: Q) => PromiseLike<Row[]>) {
  return attempt(tx, sub ? "authenticated" : "anon", sub, fn);
}

const day = (offset: number) => `(public.nairobi_today() + ${offset})`;

async function newAd(tx: Tx, owner: string, a: Partial<Record<string, unknown>> & { space: "menu" | "order"; from: number; to: number }) {
  const [row] = await run(tx, owner, (q) => q`
    insert into public.ads (advertiser, line, place, link_label, link_url, space, starts_on, ends_on, fee_kes, fee_period)
    values (${a.advertiser ?? "Sunrise Bakery"}, ${a.line ?? "Fresh bread every morning"}, ${a.place ?? "Next door"},
            ${a.link_label ?? "See today's bread"}, ${a.link_url ?? "https://sunrise.example/bread"}, ${a.space}::public.ad_space,
            public.nairobi_today() + ${a.from}::int, public.nairobi_today() + ${a.to}::int, 2000, 'month')
    returning *`);
  return row!;
}

const act = (tx: Tx, owner: string | null, id: string, action: string) =>
  as(tx, owner, (q) => q`select public.ad_action(${id}::uuid, ${action})`);

async function status(tx: Tx, owner: string, id: string) {
  const [r] = await run(tx, owner, (q) => q`select public.ad_status(a) s from public.ads a where a.id = ${id}`);
  return r!.s as string;
}

describe("ads: approving and the one-ad-per-space rule", () => {
  test("an overlap is refused in the same space, named, and allowed in the other space", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await newAd(tx, f.ownerId, { advertiser: "Mama Pima's Butchery", space: "menu", from: 0, to: 10 });
      expect(await act(tx, f.ownerId, a.id, "approve")).toBeNull();
      expect(await status(tx, f.ownerId, a.id)).toBe("live");

      const b = await newAd(tx, f.ownerId, { space: "menu", from: 5, to: 20 });
      const r = await act(tx, f.ownerId, b.id, "approve");
      const [{ end }] = await tx`select to_char(public.nairobi_today() + 10, 'FMDD Mon') "end"`;
      expect(r).toMatchObject({
        code: "P0001",
        detail: "ad_overlap",
        message: `Mama Pima's Butchery is on the menu until ${end}. Pick dates after that, or the order page.`,
      });
      expect(await status(tx, f.ownerId, b.id)).toBe("draft");

      // After the first one's end: fine. In the other space: fine.
      const c = await newAd(tx, f.ownerId, { space: "menu", from: 11, to: 20 });
      expect(await act(tx, f.ownerId, c.id, "approve")).toBeNull();
      expect(await status(tx, f.ownerId, c.id)).toBe("scheduled");
      const d = await newAd(tx, f.ownerId, { space: "order", from: 0, to: 10 });
      expect(await act(tx, f.ownerId, d.id, "approve")).toBeNull();
      const e = await newAd(tx, f.ownerId, { space: "order", from: 3, to: 4 });
      expect((await act(tx, f.ownerId, e.id, "approve"))?.message).toContain("is on the order page until");
      expect((await act(tx, f.ownerId, e.id, "approve"))?.message).toContain("Pick dates after that, or the menu.");
    });
  });

  test("a paused ad can't resume once its space is taken; an ended ad frees the space", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 10 });
      await act(tx, f.ownerId, a.id, "approve");
      expect(await act(tx, f.ownerId, a.id, "pause")).toBeNull();
      expect(await status(tx, f.ownerId, a.id)).toBe("paused");
      // Paused doesn't hold the space.
      const b = await newAd(tx, f.ownerId, { advertiser: "Kibanda Fresh", space: "menu", from: 0, to: 3 });
      expect(await act(tx, f.ownerId, b.id, "approve")).toBeNull();
      const r = await act(tx, f.ownerId, a.id, "resume");
      expect(r).toMatchObject({ code: "P0001", detail: "ad_overlap" });
      expect(r!.message).toStartWith("Kibanda Fresh is on the menu until");
      expect(await status(tx, f.ownerId, a.id)).toBe("paused");
      // End the other one now: the space is free again.
      expect(await act(tx, f.ownerId, b.id, "end")).toBeNull();
      expect(await status(tx, f.ownerId, b.id)).toBe("ended");
      expect(await act(tx, f.ownerId, a.id, "resume")).toBeNull();
      expect(await status(tx, f.ownerId, a.id)).toBe("live");
    });
  });

  test("actions only from the right state, and only the owner", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Wanjiru", ["dishes_prices", "everyday_menu", "tables_delivery", "close_early"]);
      const a = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 10 });
      expect(await act(tx, f.ownerId, a.id, "pause")).toMatchObject({ detail: "ad_state" });
      expect(await act(tx, f.ownerId, a.id, "end")).toMatchObject({ detail: "ad_state" });
      expect(await act(tx, staff, a.id, "approve")).toMatchObject({ code: "42501" });
      expect(await act(tx, null, a.id, "approve")).toMatchObject({ code: "42501" });
      await act(tx, f.ownerId, a.id, "approve");
      expect(await act(tx, f.ownerId, a.id, "approve")).toMatchObject({ detail: "ad_state" });
      expect(await act(tx, f.ownerId, a.id, "resume")).toMatchObject({ detail: "ad_state" });
      // Dates already over can't be approved.
      const old = await newAd(tx, f.ownerId, { space: "order", from: -10, to: -1 });
      expect(await act(tx, f.ownerId, old.id, "approve")).toMatchObject({ detail: "ad_dates_over" });
      // The approval columns can't be written directly, even by the owner.
      const draft = await newAd(tx, f.ownerId, { space: "order", from: 0, to: 2 });
      expect(await as(tx, f.ownerId, (q) => q`update public.ads set approved_at = now() where id = ${draft.id}`)).toMatchObject({ code: "42501" });
      const [ins] = await run(tx, f.ownerId, (q) => q`
        insert into public.ads (advertiser, line, link_label, link_url, space, starts_on, ends_on, approved_at)
        values ('X', 'Y', 'Z', 'https://x.example', 'order', public.nairobi_today(), public.nairobi_today(), now()) returning approved_at`);
      expect(ins!.approved_at).toBeNull();
    });
  });
});

describe("ads: editing and deleting", () => {
  test("a customer-visible edit sends an approved ad back to draft; end date and fee don't", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 10 });
      await act(tx, f.ownerId, a.id, "approve");
      await run(tx, f.ownerId, (q) => q`update public.ads set ends_on = ends_on + 5, fee_kes = 2500 where id = ${a.id} returning id`);
      expect(await status(tx, f.ownerId, a.id)).toBe("live");
      for (const change of [
        { line: "Now with mandazi" },
        { advertiser: "Sunrise Bakers" },
        { place: "Upstairs" },
        { link_label: "Call us" },
        { link_url: "tel:+254712345678" },
        { logo_url: "https://cdn.example/l.png" },
        { space: "order" },
        { starts_on: "tomorrow" },
      ]) {
        const [k, v] = Object.entries(change)[0]!;
        if (k === "starts_on") await run(tx, f.ownerId, (q) => q`update public.ads set starts_on = public.nairobi_today() + 1 where id = ${a.id} returning id`);
        else if (k === "space") await run(tx, f.ownerId, (q) => q`update public.ads set space = 'order' where id = ${a.id} returning id`);
        else await run(tx, f.ownerId, (q) => q`update public.ads set ${q({ [k]: v })} where id = ${a.id} returning id`);
        expect([k, await status(tx, f.ownerId, a.id)]).toEqual([k, "draft"]);
        await run(tx, f.ownerId, (q) => q`update public.ads set space = 'menu', starts_on = public.nairobi_today() where id = ${a.id} returning id`);
        expect(await act(tx, f.ownerId, a.id, "approve")).toBeNull();
      }
      const log = await tx`select action, after from public.change_log where subject_id = ${a.id} order by id`;
      expect(log.map((l: Row) => l.action)).toContain("ad.approve");
      expect(log.filter((l: Row) => l.action === "ad.edit" && l.after.to_draft).length).toBeGreaterThanOrEqual(8);
      expect(log.find((l: Row) => l.action === "ad.edit")!.after.to_draft).toBe(false); // the end date and fee edit
    });
  });

  test("a later end date can't run into another approved ad in the space (R211-01)", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const a = await newAd(tx, f.ownerId, { advertiser: "Sunrise Bakery", space: "menu", from: 400, to: 401 });
      const b = await newAd(tx, f.ownerId, { advertiser: "Mama Pima's Butchery", space: "menu", from: 402, to: 403 });
      expect(await act(tx, f.ownerId, a.id, "approve")).toBeNull();
      expect(await act(tx, f.ownerId, b.id, "approve")).toBeNull();
      const extend = (id: string, to: number) =>
        as(tx, f.ownerId, (q) => q`update public.ads set ends_on = public.nairobi_today() + ${to}::int where id = ${id} returning id`);
      const [{ end }] = await tx`select to_char(public.nairobi_today() + 403, 'FMDD Mon') "end"`;
      expect(await extend(a.id, 403)).toMatchObject({
        code: "P0001",
        detail: "ad_overlap",
        message: `Mama Pima's Butchery is on the menu until ${end}. Pick dates after that, or the order page.`,
      });
      const [row] = await tx`select ends_on - public.nairobi_today() d, approved_at is not null approved from public.ads where id = ${a.id}`;
      expect([row!.d, row!.approved]).toEqual([401, true]);
      // Up to the day before the other run, an earlier end date, or into the other space's days: fine.
      expect(await extend(a.id, 401)).toBeNull();
      expect(await extend(a.id, 400)).toBeNull();
      const c = await newAd(tx, f.ownerId, { space: "order", from: 402, to: 405 });
      expect(await act(tx, f.ownerId, c.id, "approve")).toBeNull();
      expect(await extend(a.id, 401)).toBeNull();
      // A draft isn't checked here (approving it is); once the other ad ends early, the run can grow.
      const d = await newAd(tx, f.ownerId, { space: "menu", from: 400, to: 401 });
      expect(await extend(d.id, 403)).toBeNull();
      expect(await act(tx, f.ownerId, d.id, "approve")).toMatchObject({ detail: "ad_overlap" });
      expect(await act(tx, f.ownerId, b.id, "end")).toBeNull();
      expect(await extend(a.id, 403)).toBeNull();
    });
  });

  test("a draft can be deleted; an approved ad can't, nor a draft that was once shown; an ended ad can't be edited", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const d = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 10 });
      const a = await newAd(tx, f.ownerId, { space: "order", from: 0, to: 10 });
      await act(tx, f.ownerId, a.id, "approve");
      const gone = await run(tx, f.ownerId, (q) => q`delete from public.ads where id = ${a.id} returning id`);
      expect(gone).toHaveLength(0); // RLS: approved rows aren't deletable
      await run(tx, null, (q) => q`select public.count_ad_view(array[${a.id}]::uuid[])`);
      // Back to draft, then delete: refused, the counts stay.
      await run(tx, f.ownerId, (q) => q`update public.ads set line = 'New line' where id = ${a.id} returning id`);
      expect(await as(tx, f.ownerId, (q) => q`delete from public.ads where id = ${a.id}`)).toMatchObject({
        message: "This ad has been shown, so it can’t be deleted. End it instead.",
      });
      expect(await run(tx, f.ownerId, (q) => q`delete from public.ads where id = ${d.id} returning id`)).toHaveLength(1);
      expect((await tx`select action from public.change_log where subject_id = ${d.id} order by id`).map((l: Row) => l.action)).toEqual(["ad.create", "ad.delete"]);
      // Ended: no edits customers would see.
      await act(tx, f.ownerId, a.id, "approve");
      await act(tx, f.ownerId, a.id, "end");
      expect(await as(tx, f.ownerId, (q) => q`update public.ads set line = 'Again' where id = ${a.id}`)).toMatchObject({
        message: "This ad has ended. Make a new ad instead.",
      });
    });
  });

  test("the checks on what an ad holds", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const bad = async (k: string, v: unknown) =>
        (await as(tx, f.ownerId, (q) => q`insert into public.ads ${q({
          advertiser: "A", line: "B", link_label: "C", link_url: "https://a.example", space: "menu",
          starts_on: "2030-01-02", ends_on: "2030-01-03", [k]: v,
        })}`))?.code;
      expect(await bad("advertiser", "x".repeat(33))).toBe("23514");
      expect(await bad("advertiser", "   ")).toBe("23514");
      expect(await bad("line", "x".repeat(71))).toBe("23514");
      expect(await bad("place", "x".repeat(41))).toBe("23514");
      expect(await bad("link_label", "x".repeat(25))).toBe("23514");
      expect(await bad("link_url", "http://a.example")).toBe("23514");
      expect(await bad("link_url", "javascript:alert(1)")).toBe("23514");
      expect(await bad("link_url", "tel:0712345678")).toBe("23514");
      expect(await bad("ends_on", "2030-01-01")).toBe("23514");
      expect(await bad("fee_kes", -1)).toBe("23514");
      expect(await bad("fee_period", "day")).toBe("23514");
      expect(await bad("advertiser", "x".repeat(32))).toBeUndefined();
      expect(await bad("link_url", "tel:+254712345678")).toBeUndefined();
    });
  });
});

describe("ads: what customers see and the counts", () => {
  test("live_ads shows only the live ad: no drafts, paused, scheduled or ended, never the fee or a web address", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const live = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 5 });
      await newAd(tx, f.ownerId, { advertiser: "Draft Co", space: "order", from: 0, to: 5 });
      const later = await newAd(tx, f.ownerId, { space: "menu", from: 6, to: 9 });
      await act(tx, f.ownerId, live.id, "approve");
      await act(tx, f.ownerId, later.id, "approve");
      const menu = await run(tx, null, (q) => q`select * from public.live_ads('menu')`);
      expect(menu).toHaveLength(1);
      expect(menu[0]).toMatchObject({ id: live.id, link_kind: "web", link_tel: null, advertiser: "Sunrise Bakery" });
      expect(Object.keys(menu[0]!)).not.toContain("fee_kes");
      expect(JSON.stringify(menu[0])).not.toContain("sunrise.example");
      expect(await run(tx, null, (q) => q`select * from public.live_ads('order')`)).toHaveLength(0);

      await act(tx, f.ownerId, live.id, "pause");
      expect(await run(tx, null, (q) => q`select * from public.live_ads('menu')`)).toHaveLength(0);
      await act(tx, f.ownerId, live.id, "resume");
      await act(tx, f.ownerId, live.id, "end");
      expect(await run(tx, null, (q) => q`select * from public.live_ads('menu')`)).toHaveLength(0);

      // A phone link gives its number, for the dialler.
      const tel = await newAd(tx, f.ownerId, { space: "order", from: 0, to: 1, link_url: "tel:+254712345678" });
      await act(tx, f.ownerId, tel.id, "approve");
      const [o] = await run(tx, null, (q) => q`select * from public.live_ads('order')`);
      expect(o).toMatchObject({ link_kind: "tel", link_tel: "+254712345678" });
    });
  });

  test("count_ad_view counts live ads only, at most two ids; count_ad_tap returns the link only while live", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const m = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 5 });
      const o = await newAd(tx, f.ownerId, { space: "order", from: 0, to: 5, link_url: "https://o.example/x" });
      const draft = await newAd(tx, f.ownerId, { space: "order", from: 7, to: 9 });
      await act(tx, f.ownerId, m.id, "approve");
      await act(tx, f.ownerId, o.id, "approve");
      const counts = async () =>
        Object.fromEntries((await tx`select ad_id, views, taps from public.ad_daily_counts`).map((r: Row) => [r.ad_id, [r.views, r.taps]]));
      await run(tx, null, (q) => q`select public.count_ad_view(array[${m.id}, ${o.id}]::uuid[])`);
      await run(tx, null, (q) => q`select public.count_ad_view(array[${m.id}]::uuid[])`);
      await run(tx, null, (q) => q`select public.count_ad_view(array[${draft.id}]::uuid[])`);
      await run(tx, null, (q) => q`select public.count_ad_view(array[${m.id}, ${o.id}, ${draft.id}]::uuid[])`);
      await run(tx, null, (q) => q`select public.count_ad_view(array[]::uuid[])`);
      expect(await counts()).toEqual({ [m.id]: [2, 0], [o.id]: [1, 0] });

      const [tap] = await run(tx, null, (q) => q`select public.count_ad_tap(${o.id}::uuid) url`);
      expect(tap!.url).toBe("https://o.example/x");
      const [none] = await run(tx, null, (q) => q`select public.count_ad_tap(${draft.id}::uuid) url`);
      expect(none!.url).toBeNull();
      const [missing] = await run(tx, null, (q) => q`select public.count_ad_tap(${crypto.randomUUID()}::uuid) url`);
      expect(missing!.url).toBeNull();
      await act(tx, f.ownerId, o.id, "pause");
      const [paused] = await run(tx, null, (q) => q`select public.count_ad_tap(${o.id}::uuid) url`);
      expect(paused!.url).toBeNull();
      expect(await counts()).toEqual({ [m.id]: [2, 0], [o.id]: [1, 1] });

      const [ov] = await run(tx, f.ownerId, (q) => q`select views::int, taps::int, month_views::int, status from public.ads_overview() where id = ${o.id}`);
      expect(ov).toMatchObject({ views: 1, taps: 1, month_views: 1, status: "paused" });
    });
  });

  test("anon and staff can't read ads or counts; staff can't see the overview", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Otieno");
      const a = await newAd(tx, f.ownerId, { space: "menu", from: 0, to: 5 });
      await act(tx, f.ownerId, a.id, "approve");
      await run(tx, null, (q) => q`select public.count_ad_view(array[${a.id}]::uuid[])`);
      expect(await as(tx, null, (q) => q`select * from public.ads`)).toMatchObject({ code: "42501" });
      expect(await as(tx, null, (q) => q`select * from public.ad_daily_counts`)).toMatchObject({ code: "42501" });
      expect(await run(tx, staff, (q) => q`select * from public.ads`)).toHaveLength(0);
      expect(await run(tx, staff, (q) => q`select * from public.ad_daily_counts`)).toHaveLength(0);
      expect(await as(tx, staff, (q) => q`select * from public.ads_overview()`)).toMatchObject({ code: "42501" });
      expect(await as(tx, staff, (q) => q`insert into public.ads (advertiser, line, link_label, link_url, space, starts_on, ends_on)
        values ('A','B','C','https://a.example','menu', '2030-01-01', '2030-01-02')`)).toMatchObject({ code: "42501" });
      expect(await as(tx, null, (q) => q`select public.ad_action(${a.id}::uuid, 'end')`)).toMatchObject({ code: "42501" });
    });
  });
});

describe("Mama's pick", () => {
  test("staff can't set is_pick, even with every job; the owner can, and it is logged and returned to customers", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await person(tx, "staff", "Akinyi", ["dishes_prices", "everyday_menu", "tables_delivery", "close_early"]);
      expect(await as(tx, staff, (q) => q`update public.dishes set is_pick = true where id = ${f.rotating.id}`)).toMatchObject({
        code: "42501",
        message: "Only the owner can do this.",
      });
      expect(await as(tx, staff, (q) => q`insert into public.dishes (name, price_kes, is_pick) values ('Sneaky', 100, true)`)).toMatchObject({ code: "42501" });
      // Their other edits still work.
      expect(await as(tx, staff, (q) => q`update public.dishes set price_kes = 510 where id = ${f.rotating.id}`)).toBeNull();
      expect(await as(tx, f.ownerId, (q) => q`update public.dishes set is_pick = true where id = ${f.rotating.id}`)).toBeNull();
      const [m] = await run(tx, null, (q) => q`select is_pick from public.customer_menu() where dish_id = ${f.rotating.id}`);
      expect(m!.is_pick).toBe(true);
      const [t] = await tx`select is_pick from public.todays_menu where dish_id = ${f.rotating.id}`;
      expect(t!.is_pick).toBe(true);
      await as(tx, f.ownerId, (q) => q`update public.dishes set is_pick = false where id = ${f.rotating.id}`);
      const log = await tx`select area::text, action from public.change_log where subject_id = ${f.rotating.id} and area = 'promos' order by id`;
      expect(log).toEqual([
        { area: "promos", action: "promo.pick_on" },
        { area: "promos", action: "promo.pick_off" },
      ]);
    });
  });
});
