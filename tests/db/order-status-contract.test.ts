// Wave 2 integration (RW2B-01): the one get_order_status the customer's page reads, as composed
// from 2.8 (where the order goes, item notes and extras) and 2.9 (placed_today, requests) in
// 20261116100000_compose_order_status.sql. Every field both slices' pages read is asserted here,
// so a later migration that redefines the function from an older base fails this test.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, dineIn, inTx, placeOrder, seedFixtures } from "./helpers";

type Tx = TransactionSQL;
type Status = Record<string, unknown> & {
  items: { name: string; option_label: string | null; quantity: number; unit_price_kes: number; note: string | null; extras: { label: string; price_kes: number }[] }[];
  requests: { waiter: Record<string, unknown> | null; bill: Record<string, unknown> | null } | null;
};

async function status(tx: Tx, token: string) {
  const [r] = (await attempt(tx, "anon", null, (sp) => sp`select public.get_order_status(${token}::uuid) as s`)) as { s: Status | null }[];
  return r!.s;
}

const KEYS = [
  "code", "status", "mode", "payment_method", "payment_status", "customer_name", "table_label", "zone_name", "pickup_at",
  "subtotal_kes", "delivery_fee_kes", "total_kes", "created_at", "status_changed_at", "cancel_reason", "cancel_note", "declined",
  "till_number", "placed_today", "requests", "phone", "delivery_address", "delivery_notes", "kitchen_address", "maps_url", "items",
].sort();

describe("get_order_status: the combined contract (2.8 + 2.9)", () => {
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
        requests: null, placed_today: true,
      });
      expect(s.items[0]).toMatchObject({ note: "No onions", extras: [] });
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
