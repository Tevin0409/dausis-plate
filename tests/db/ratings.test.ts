// Slice 2.10: ratings (spec-2.10-ratings.md, "Build notes → Tests" and "Done means" 1–9).
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
type Status = {
  status: string;
  rating: { sent_at: string; stars: number; comment_sent: boolean; reply: { text: string; replied_at: string } | null } | null;
  rate_dishes: string[];
  rate_until: string | null;
  google_review_url: string | null;
};

const call = (tx: Tx, who: string | null, fn: (q: Tx) => PromiseLike<unknown>) =>
  attempt(tx, who ? "authenticated" : "anon", who, fn as never);

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { errno?: string; code?: string; message: string };
    return { code: err.errno ?? err.code, message: err.message };
  }
}

async function staffMember(tx: Tx) {
  const [u] = await tx`insert into auth.users (email) values ('otieno@test.local') returning id`;
  await tx`insert into public.staff (user_id, role, display_name) values (${u.id}, 'staff', 'Otieno')`;
  return u.id as string;
}

async function order(tx: Tx, f: Fixtures, items: object[] = [{ dish_id: f.regular.id, quantity: 1 }], name = "Wanjiru Kamau") {
  const placed = await placeOrder(tx, dineIn(f, items as never, { customer_name: name }));
  const [row] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
  return { id: row.id as string, token: placed.public_token, code: placed.code };
}

const advance = (tx: Tx, who: string, id: string, from: string, to: string) =>
  call(tx, who, (q) => q`select public.advance_order(${id}::uuid, ${from}::public.order_status, ${to}::public.order_status)`);

async function complete(tx: Tx, f: Fixtures, id: string) {
  for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "completed"]] as const) await advance(tx, f.ownerId, id, a, b);
}

const rate = async (tx: Tx, token: string, stars: number, comment: string | null = null) => {
  const [r] = (await call(tx, null, (q) => q`select public.rate_order(${token}::uuid, ${stars}::smallint, ${comment}::text) as r`)) as {
    r: { sent_at: string; stars: number; comment_sent: boolean };
  }[];
  return r!.r;
};
const status = async (tx: Tx, token: string) => {
  const [r] = (await call(tx, null, (q) => q`select public.get_order_status(${token}::uuid) as s`)) as { s: Status }[];
  return r!.s;
};
const dish = async (tx: Tx, id: string) => {
  const [d] = await tx`select rating_count, rating_total from public.dishes where id = ${id}`;
  return { count: d!.rating_count as number, total: d!.rating_total as number };
};
const hide = async (tx: Tx, who: string, id: string, hidden: boolean) => {
  const [r] = (await call(tx, who, (q) => q`select public.set_rating_hidden(${id}::uuid, ${hidden}) as h`)) as { h: boolean }[];
  return r!.h;
};
const reply = async (tx: Tx, who: string, id: string, text: string | null) => {
  const [r] = (await call(tx, who, (q) => q`select public.reply_to_rating(${id}::uuid, ${text}::text) as r`)) as { r: unknown }[];
  return r!.r;
};
const history = (tx: Tx, id: string) =>
  tx`select action, subject_label, before, after from public.change_log where subject_id = ${id} and area = 'ratings' order by id`;

/** Moves an order's completion back by `days` without firing triggers. */
async function completedDaysAgo(tx: Tx, id: string, days: number) {
  await tx`select set_config('session_replication_role', 'replica', true)`;
  await tx`update public.orders set status_changed_at = now() - make_interval(days => ${days}) where id = ${id}`;
  await tx`select set_config('session_replication_role', 'origin', true)`;
}

describe("rate_order (Done means 2, 3)", () => {
  test("refuses an order that isn't completed, a cancelled one and an unknown token", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      expect(await refusal(rate(tx, o.token, 4))).toEqual({ code: "P0001", message: "rating_not_finished" });
      await advance(tx, f.ownerId, o.id, "new", "preparing");
      await advance(tx, f.ownerId, o.id, "preparing", "ready");
      expect(await refusal(rate(tx, o.token, 4))).toEqual({ code: "P0001", message: "rating_not_finished" });

      const c = await order(tx, f);
      await call(tx, f.ownerId, (q) => q`select public.cancel_order(${c.id}::uuid, 'new'::public.order_status, 'too_busy'::public.cancel_reason, null)`);
      expect(await refusal(rate(tx, c.token, 4))).toEqual({ code: "P0001", message: "rating_not_finished" });
      expect(await refusal(rate(tx, crypto.randomUUID(), 4))).toEqual({ code: "P0001", message: "rating_no_order" });
    }));

  test("refuses after 7 days, a second send, stars 0 and 6, and a 501-character comment", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const old = await order(tx, f);
      await complete(tx, f, old.id);
      await completedDaysAgo(tx, old.id, 8);
      expect(await refusal(rate(tx, old.token, 4))).toEqual({ code: "P0001", message: "rating_closed" });

      const o = await order(tx, f);
      await complete(tx, f, o.id);
      expect(await refusal(rate(tx, o.token, 0))).toEqual({ code: "P0001", message: "rating_stars" });
      expect(await refusal(rate(tx, o.token, 6))).toEqual({ code: "P0001", message: "rating_stars" });
      expect(await refusal(rate(tx, o.token, 4, "a".repeat(501)))).toEqual({ code: "P0001", message: "rating_comment_long" });
      const sent = await rate(tx, o.token, 4, "a".repeat(500));
      expect(sent).toMatchObject({ stars: 4, comment_sent: true });
      expect(await refusal(rate(tx, o.token, 5))).toEqual({ code: "P0001", message: "rating_already" });
    }));

  test("within 7 days is still open; an empty comment is stored as none", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      await complete(tx, f, o.id);
      await completedDaysAgo(tx, o.id, 6);
      expect(await rate(tx, o.token, 3, "   ")).toMatchObject({ stars: 3, comment_sent: false });
      const [r] = await tx`select comment from public.order_ratings where order_id = ${o.id}`;
      expect(r!.comment).toBeNull();
    }));

  test("a 4-star send on pilau twice and chapati once adds 1 and 4 to each dish, once (Done means 4)", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f, [
        { dish_id: f.regular.id, quantity: 2 },
        { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 },
        { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, option_id: f.option.id, quantity: 1 },
      ]);
      await complete(tx, f, o.id);
      await rate(tx, o.token, 4);
      expect(await dish(tx, f.regular.id)).toEqual({ count: 1, total: 4 });
      expect(await dish(tx, f.rotating.id)).toEqual({ count: 1, total: 4 });
      expect(await dish(tx, f.late.id)).toEqual({ count: 0, total: 0 });
    }));
});

describe("what the customer's page gets (Done means 1, 6, 7)", () => {
  test("rate_until and the Google link only once completed; the rating never carries the comment", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set google_review_url = 'https://g.page/r/test/review'`;
      const o = await order(tx, f, [{ dish_id: f.regular.id, quantity: 2 }, { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]);
      let s = await status(tx, o.token);
      expect(s.rate_until).toBeNull();
      expect(s.google_review_url).toBeNull();
      expect(s.rating).toBeNull();
      expect(s.rate_dishes).toEqual(["Test regular", "Test rotating"]);

      await complete(tx, f, o.id);
      s = await status(tx, o.token);
      expect(s.google_review_url).toBe("https://g.page/r/test/review");
      expect(new Date(s.rate_until!).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);

      await rate(tx, o.token, 2, "The secret comment, only for Mama");
      s = await status(tx, o.token);
      expect(s.rating).toMatchObject({ stars: 2, comment_sent: true, reply: null });
      expect(JSON.stringify(s)).not.toContain("secret comment");
      expect(s.google_review_url).toBe("https://g.page/r/test/review");
    }));

  test("a cancelled order gets no Google link", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set google_review_url = 'https://g.page/r/test/review'`;
      const o = await order(tx, f);
      await tx`update public.orders set status = 'cancelled' where id = ${o.id}`;
      expect((await status(tx, o.token)).google_review_url).toBeNull();
    }));
});

describe("who can read ratings (Done means 5)", () => {
  test("anon and staff select nothing from order_ratings; the owner sees the comment", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const o = await order(tx, f);
      await complete(tx, f, o.id);
      await rate(tx, o.token, 5, "Lovely pilau");
      // anon has no grant at all; staff pass the grant but RLS shows them nothing.
      expect(await refusal(call(tx, null, (q) => q`select * from public.order_ratings`))).toMatchObject({ code: "42501" });
      expect(await call(tx, staff, (q) => q`select * from public.order_ratings`)).toHaveLength(0);
      const own = (await call(tx, f.ownerId, (q) => q`select comment from public.order_ratings`)) as { comment: string }[];
      expect(own.map((r) => r.comment)).toEqual(["Lovely pilau"]);
      expect(await refusal(call(tx, staff, (q) => q`select * from public.list_ratings('all', null)`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, null, (q) => q`select * from public.list_ratings('all', null)`))).toMatchObject({ code: "42501" });
    }));

  test("nobody can write order_ratings or the dish totals directly", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const o = await order(tx, f);
      expect(await refusal(call(tx, null, (q) => q`insert into public.order_ratings (order_id, stars) values (${o.id}, 5)`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, f.ownerId, (q) => q`insert into public.order_ratings (order_id, stars) values (${o.id}, 5)`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, staff, (q) => q`update public.dishes set rating_count = 99 where id = ${f.regular.id}`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, f.ownerId, (q) => q`update public.dishes set rating_total = 99 where id = ${f.regular.id}`))).toMatchObject({ code: "42501" });
      // The owner's other dish edits still work.
      await call(tx, f.ownerId, (q) => q`update public.dishes set description = 'Rice' where id = ${f.regular.id}`);
    }));
});

describe("hide, show and reply (Q3 B, Q4 B)", () => {
  test("hiding takes the stars off, hiding again changes nothing, showing puts them back, with History", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      await complete(tx, f, o.id);
      await rate(tx, o.token, 4);
      expect(await hide(tx, f.ownerId, o.id, true)).toBe(true);
      expect(await dish(tx, f.regular.id)).toEqual({ count: 0, total: 0 });
      expect(await hide(tx, f.ownerId, o.id, true)).toBe(true);
      expect(await dish(tx, f.regular.id)).toEqual({ count: 0, total: 0 });
      expect((await status(tx, o.token)).rating).toMatchObject({ stars: 4 });
      expect(await hide(tx, f.ownerId, o.id, false)).toBe(false);
      expect(await dish(tx, f.regular.id)).toEqual({ count: 1, total: 4 });
      const log = await history(tx, o.id);
      expect(log.map((r: { action: string }) => r.action)).toEqual(["ratings.hide", "ratings.show"]);
      expect(log[0]).toMatchObject({ subject_label: o.code, after: { stars: 4 } });
    }));

  test("staff get 42501 on hide, reply, seen and the Google link", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const staff = await staffMember(tx);
      const o = await order(tx, f);
      await complete(tx, f, o.id);
      await rate(tx, o.token, 4);
      expect(await refusal(hide(tx, staff, o.id, true))).toMatchObject({ code: "42501" });
      expect(await refusal(reply(tx, staff, o.id, "Thanks"))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, staff, (q) => q`select public.mark_ratings_seen()`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, staff, (q) => q`select public.set_google_review_url('https://g.page/x')`))).toMatchObject({ code: "42501" });
      expect(await refusal(call(tx, null, (q) => q`select public.set_rating_hidden(${o.id}::uuid, true)`))).toMatchObject({ code: "42501" });
    }));

  test("a reply shows on the customer's page, changes, and removing it clears it; one History line each, no text", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const o = await order(tx, f);
      await complete(tx, f, o.id);
      await rate(tx, o.token, 3, "Too salty");
      expect(await refusal(reply(tx, f.ownerId, o.id, "x".repeat(501)))).toEqual({ code: "P0001", message: "reply_long" });
      await reply(tx, f.ownerId, o.id, "  Asante! We'll go easy on the salt.  ");
      expect((await status(tx, o.token)).rating?.reply?.text).toBe("Asante! We'll go easy on the salt.");
      await reply(tx, f.ownerId, o.id, "Asante sana!");
      expect((await status(tx, o.token)).rating?.reply?.text).toBe("Asante sana!");
      await reply(tx, f.ownerId, o.id, "Asante sana!"); // same text: nothing changes
      expect(await reply(tx, f.ownerId, o.id, "")).toBeNull();
      expect((await status(tx, o.token)).rating?.reply).toBeNull();
      const log = await history(tx, o.id);
      expect(log.map((r: { action: string }) => r.action)).toEqual(["ratings.reply", "ratings.reply_change", "ratings.reply_remove"]);
      expect(JSON.stringify(log)).not.toContain("salt");
      // A reply after the window and on a hidden rating is allowed.
      await completedDaysAgo(tx, o.id, 30);
      await hide(tx, f.ownerId, o.id, true);
      await reply(tx, f.ownerId, o.id, "Late but heartfelt");
      expect(await refusal(reply(tx, f.ownerId, crypto.randomUUID(), "Hi"))).toEqual({ code: "P0001", message: "rating_missing" });
    }));
});

describe("the Ratings screen (Done means 9)", () => {
  test("filters, newest first, paging by sent_at, first names, dish lists and New pills", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const made: { id: string; stars: number }[] = [];
      for (const [i, stars, comment] of [[0, 5, null], [1, 2, "Cold"], [2, 1, null], [3, 4, "Nice"]] as const) {
        const o = await order(tx, f, [{ dish_id: f.regular.id, quantity: 1 }], `Guest${i} Surname`);
        await complete(tx, f, o.id);
        await rate(tx, o.token, stars, comment);
        await tx`update public.order_ratings set created_at = now() - make_interval(mins => ${10 - i}) where order_id = ${o.id}`;
        made.push({ id: o.id, stars });
      }
      await hide(tx, f.ownerId, made[1]!.id, true);
      const list = async (show: string, before: string | null = null) =>
        (await call(tx, f.ownerId, (q) => q`select * from public.list_ratings(${show}::text, ${before}::timestamptz)`)) as {
          order_id: string; first_name: string; stars: number; dishes: string[]; sent_at: string; is_new: boolean; hidden_at: string | null;
        }[];
      const all = await list("all");
      expect(all.map((r) => r.first_name)).toEqual(["Guest3", "Guest2", "Guest1", "Guest0"]);
      expect(all[0]!.dishes).toEqual(["Test regular"]);
      expect(all.every((r) => r.is_new)).toBe(true);
      expect((await list("comments")).map((r) => r.first_name)).toEqual(["Guest3", "Guest1"]);
      expect((await list("low")).map((r) => r.first_name)).toEqual(["Guest2", "Guest1"]);
      expect((await list("hidden")).map((r) => r.first_name)).toEqual(["Guest1"]);
      expect((await list("all", all[1]!.sent_at)).map((r) => r.first_name)).toEqual(["Guest1", "Guest0"]);
      expect(await refusal(list("bogus"))).toMatchObject({ code: "22023" });

      const [sum] = (await call(tx, f.ownerId, (q) => q`select * from public.ratings_summary()`)) as { avg_stars: string; visible: number; hidden: number }[];
      expect(sum).toEqual({ avg_stars: "3.3", visible: 3, hidden: 1 });

      await call(tx, f.ownerId, (q) => q`select public.mark_ratings_seen()`);
      expect((await list("all")).some((r) => r.is_new)).toBe(false);
    }));

  test("todays_menu shows the average from the 3rd visible rating", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const menu = async () => {
        const [r] = await tx`select rating_avg, rating_count from public.todays_menu where dish_id = ${f.rotating.id}`;
        return { avg: r!.rating_avg as string | null, count: r!.rating_count as number };
      };
      const ids: string[] = [];
      for (const stars of [5, 4, 4]) {
        const o = await order(tx, f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1 }]);
        await complete(tx, f, o.id);
        await rate(tx, o.token, stars);
        ids.push(o.id);
        if (ids.length < 3) expect((await menu()).avg).toBeNull();
      }
      expect(await menu()).toEqual({ avg: "4.3", count: 3 });
      await hide(tx, f.ownerId, ids[0]!, true);
      expect(await menu()).toEqual({ avg: null, count: 2 });
    }));
});

describe("Settings: the Google review link (Done means 8)", () => {
  test("the owner sets, trims and clears it, with a Settings History line; bad links are refused", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const set = async (url: string | null) => {
        const [r] = (await call(tx, f.ownerId, (q) => q`select public.set_google_review_url(${url}::text) as u`)) as { u: string | null }[];
        return r!.u;
      };
      expect(await refusal(set("http://g.page/x"))).toEqual({ code: "P0001", message: "Start the link with https://" });
      expect(await refusal(set("https://" + "a".repeat(493)))).toEqual({ code: "P0001", message: "That link is too long." });
      // RQA210-03: whitespace or a line break inside the link, or nothing after https://
      const spaces = { code: "P0001", message: "Paste the whole link from Google, with no spaces." };
      expect(await refusal(set("https://x\njavascript:alert(1)"))).toEqual(spaces);
      expect(await refusal(set("https://g.page/r/abc review"))).toEqual(spaces);
      expect(await refusal(set("https://g.page/r/abc\treview"))).toEqual(spaces);
      expect(await refusal(set("https://"))).toEqual(spaces);
      expect(await set("  https://g.page/r/abc/review ")).toBe("https://g.page/r/abc/review");
      expect(await set("https://" + "a".repeat(492))).toHaveLength(500);
      expect(await set("")).toBeNull();
      const log = await tx`select action, before, after from public.change_log where action = 'settings.google_review' order by id`;
      expect(log).toHaveLength(3);
      expect(log[0]).toMatchObject({ before: { url: null }, after: { url: "https://g.page/r/abc/review" } });
    }));
});
