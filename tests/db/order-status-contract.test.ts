// Wave 2 integration (RW2B-01, step 3): the one get_order_status the customer's page reads, as composed
// from 2.8 (where the order goes, item notes and extras), 2.9 (placed_today, requests) and 2.10
// (rating, rate_dishes, rate_until, google_review_url) in 20261116100000_compose_order_status.sql
// and 20261116100300_ratings_compose.sql. Every field both slices' pages read is asserted here,
// so a later migration that redefines the function from an older base fails this test.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures } from "./helpers";

type Tx = TransactionSQL;
type Status = Record<string, unknown> & {
  items: { name: string; option_label: string | null; quantity: number; unit_price_kes: number; note: string | null; extras: { label: string; price_kes: number }[] }[];
  requests: { waiter: Record<string, unknown> | null; bill: Record<string, unknown> | null } | null;
  rating: (Record<string, unknown> & { reply: Record<string, unknown> | null }) | null;
};

async function status(tx: Tx, token: string) {
  const [r] = (await attempt(tx, "anon", null, (sp) => sp`select public.get_order_status(${token}::uuid) as s`)) as { s: Status | null }[];
  return r!.s;
}

const KEYS = [
  "code", "status", "mode", "payment_method", "payment_status", "customer_name", "table_label", "zone_name", "pickup_at",
  "subtotal_kes", "delivery_fee_kes", "total_kes", "created_at", "status_changed_at", "cancel_reason", "cancel_note", "declined",
  "till_number", "placed_today", "requests", "phone", "delivery_address", "delivery_notes", "kitchen_address", "maps_url", "items",
  "rating", "rate_dishes", "rate_until", "google_review_url",
  // 2.11
  "discount_kes", "discount_code", "combos",
].sort();

const advance = (tx: Tx, owner: string, id: string, from: string, to: string) =>
  attempt(tx, "authenticated", owner, (sp) => sp`select public.advance_order(${id}::uuid, ${from}::public.order_status, ${to}::public.order_status)`);

describe("get_order_status: the combined contract (2.8 + 2.9 + 2.10)", () => {
  test("dine-in: kitchen phone, address and maps link, each item's note and extras, placed today, and the table's requests", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set phone = '+254712345678', address = 'Argwings Kodhek Rd, Kilimani', maps_url = 'https://maps.example/dausis'`;
      const placed = await placeOrder(tx, dineIn(f, [
        { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2, note: "Less salt", extra_ids: [f.option.id] },
        { dish_id: f.regular.id, quantity: 1 },
      ], { customer_name: "Amina" }));

      let s = (await status(tx, placed.public_token))!;
      expect(Object.keys(s).sort()).toEqual(KEYS);
      expect(s).toMatchObject({
        code: placed.code, mode: "dine_in", customer_name: "Amina", table_label: "Test table", placed_today: true,
        phone: "+254712345678", kitchen_address: "Argwings Kodhek Rd, Kilimani", maps_url: "https://maps.example/dausis",
        delivery_address: null, delivery_notes: null, total_kes: placed.total_kes,
      });
      const rot = s.items.find((i) => i.name === "Test rotating")!;
      expect(rot).toMatchObject({ quantity: 2, note: "Less salt", extras: [{ label: "Extra kachumbari", price_kes: 50 }] });
      expect(s.items.find((i) => i.name === "Test regular")).toMatchObject({ quantity: 1, note: null, extras: [] });
      expect(s.requests).toEqual({ waiter: null, bill: null });
      // 2.10: nothing to rate until the order is completed.
      expect(s).toMatchObject({ rating: null, rate_dishes: ["Test regular", "Test rotating"], rate_until: null, google_review_url: null });

      // 2.9: asking for the bill shows on this order's page, as times only.
      await attempt(tx, "anon", null, (sp) => sp`select * from public.request_table_help(${placed.public_token}::uuid, 'bill'::public.table_request_kind)`);
      s = (await status(tx, placed.public_token))!;
      expect(s.requests!.waiter).toBeNull();
      expect(Object.keys(s.requests!.bill!).sort()).toEqual(["answered_at", "asked_at", "by_this_order"]);
      expect(s.requests!.bill).toMatchObject({ answered_at: null, by_this_order: true });
    }));

  test("delivery: the customer's address and notes, no kitchen address, no requests", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set phone = '+254712345678', address = 'Argwings Kodhek Rd', maps_url = 'https://maps.example/d'`;
      const [z] = await tx`insert into public.delivery_zones (name, fee_kes, min_order_kes) values ('Test zone', 150, 0) returning *`;
      const d = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1, note: "No onions" }], {
        mode: "delivery", table_token: null, delivery_zone_id: z!.id, delivery_address: "Hse 12, Rose Ave", delivery_notes: "Blue gate",
      }));
      const s = (await status(tx, d.public_token))!;
      expect(Object.keys(s).sort()).toEqual(KEYS);
      expect(s).toMatchObject({
        mode: "delivery", zone_name: "Test zone", delivery_fee_kes: 150, phone: "+254712345678",
        delivery_address: "Hse 12, Rose Ave", delivery_notes: "Blue gate", kitchen_address: null, maps_url: null,
        requests: null, placed_today: true, rating: null, rate_until: null, google_review_url: null,
      });
      expect(s.items[0]).toMatchObject({ note: "No onions", extras: [] });
    }));

  test("completed and rated: 2.10's fields sit beside 2.8's and 2.9's, and never carry the comment", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.kitchen_settings set phone = '+254712345678', address = 'Argwings Kodhek Rd', maps_url = 'https://maps.example/d',
                 google_review_url = 'https://g.page/r/dausis/review'`;
      const placed = await placeOrder(tx, dineIn(f, [
        { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 1, note: "Less salt", extra_ids: [f.option.id] },
        { dish_id: f.regular.id, quantity: 2 },
      ], { customer_name: "Wanjiru" }));
      const [{ id }] = await tx`select id from public.orders where public_token = ${placed.public_token}`;
      for (const [a, b] of [["new", "preparing"], ["preparing", "ready"], ["ready", "completed"]] as const) await advance(tx, f.ownerId, id, a, b);
      await attempt(tx, "anon", null, (sp) => sp`select public.rate_order(${placed.public_token}::uuid, 4::smallint, 'A bit salty'::text)`);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.reply_to_rating(${id}::uuid, 'Asante! Less salt next time.'::text)`);
      await attempt(tx, "authenticated", f.ownerId, (sp) => sp`select public.set_rating_hidden(${id}::uuid, true)`);
      // The status shows the step before for 5 seconds after a change; move it back so "completed" reads at once.
      await tx`select set_config('session_replication_role', 'replica', true)`;
      await tx`update public.orders set status_changed_at = now() - interval '1 minute' where id = ${id}`;
      await tx`select set_config('session_replication_role', 'origin', true)`;

      const s = (await status(tx, placed.public_token))!;
      expect(Object.keys(s).sort()).toEqual(KEYS);
      expect(s).toMatchObject({
        status: "completed", phone: "+254712345678", kitchen_address: "Argwings Kodhek Rd", maps_url: "https://maps.example/d",
        rate_dishes: ["Test regular", "Test rotating"], google_review_url: "https://g.page/r/dausis/review",
      });
      expect(s.items.find((i) => i.name === "Test rotating")).toMatchObject({ note: "Less salt", extras: [{ label: "Extra kachumbari", price_kes: 50 }] });
      expect(s.requests).toEqual({ waiter: null, bill: null });
      expect(Date.parse(s.rate_until as string)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      // The customer's own rating: stars, that a comment was sent, and Mama's reply. Never the comment, never "hidden".
      expect(Object.keys(s.rating!).sort()).toEqual(["comment_sent", "reply", "sent_at", "stars"]);
      expect(s.rating).toMatchObject({ stars: 4, comment_sent: true, reply: { text: "Asante! Less salt next time." } });
      expect(JSON.stringify(s)).not.toContain("A bit salty");
    }));

  test("token-only access: an unknown token sees nothing; the function stays callable by anon", () =>
    inTx(async (tx) => {
      await seedFixtures(tx);
      expect(await status(tx, crypto.randomUUID())).toBeNull();
      const [g] = await tx`select has_function_privilege('anon', 'public.get_order_status(uuid)', 'execute') as ok,
                                  p.prosecdef as definer from pg_proc p where p.proname = 'get_order_status'`;
      expect(g).toMatchObject({ ok: true, definer: true });
    }));
});

// 2.10's todays_menu started from 2.5's base and dropped 2.7's "every choice out" rule; the shop
// reads 2.8's customer_menu, which had no ratings. 20261116100300_ratings_compose.sql fixes both.
describe("the menus after 2.10: ratings on both, sold out when every choice is out", () => {
  test("rating_avg from the 3rd rating on todays_menu and customer_menu; one choice left out marks the dish sold out", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await tx`update public.dishes set rating_count = 3, rating_total = 13 where id = ${f.rotating.id}`;
      const menu = async () => {
        const tm = (await attempt(tx, "anon", null, (sp) => sp`select * from public.todays_menu where entry_id = ${f.openEntry.id}`)) as Record<string, unknown>[];
        const cm = (await attempt(tx, "anon", null, (sp) => sp`select * from public.customer_menu() where entry_id = ${f.openEntry.id}`)) as Record<string, unknown>[];
        return { tm: tm[0]!, cm: cm[0]! };
      };
      let m = await menu();
      for (const row of [m.tm, m.cm]) expect(row).toMatchObject({ rating_avg: "4.3", rating_count: 3, sold_out: false });

      await tx`update public.dishes set rating_count = 2, rating_total = 9 where id = ${f.rotating.id}`;
      m = await menu();
      for (const row of [m.tm, m.cm]) expect(row).toMatchObject({ rating_avg: null, rating_count: 2 });

      await tx`insert into public.dish_options (dish_id, label, kind, out_on) values (${f.rotating.id}, 'Rice', 'choice', public.nairobi_today())`;
      m = await menu();
      // The fixtures keep the kitchen open all day, so customer_menu is today's menu too.
      expect([m.tm.sold_out, m.cm.sold_out]).toEqual([true, true]);
    }));
});
