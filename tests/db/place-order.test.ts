import { describe, expect, test } from "bun:test";
import { asOwner, dineIn, inTx, placeOrder, platesSold, seedFixtures } from "./helpers";

describe("place_order", () => {
  test("happy path: regular and rotating dishes, option, plates counted", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(
        tx,
        dineIn(f, [
          { dish_id: f.regular.id, quantity: 2 },
          { dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, option_id: f.option.id, quantity: 1 },
        ]),
      );
      // 2 × 300 + 1 × (450 entry price + 50 option)
      expect(order.total_kes).toBe(1100);
      expect(order.code).toMatch(/^DP-\d{4,}$/);

      const [o] = await tx`select * from public.orders where public_token = ${order.public_token}`;
      expect(o).toMatchObject({ status: "new", payment_status: "unpaid", subtotal_kes: 1100, delivery_fee_kes: 0, table_id: f.table.id });
      const items = await tx`
        select name, option_label, unit_price_kes, quantity from public.order_items where order_id = ${o.id} order by name`;
      expect(items).toEqual([
        { name: "Test regular", option_label: null, unit_price_kes: 300, quantity: 2 },
        { name: "Test rotating", option_label: "Extra kachumbari", unit_price_kes: 500, quantity: 1 },
      ]);
      expect(await platesSold(tx, f.openEntry.id)).toBe(1);
    }));

  test("reprices from the database and ignores client prices and totals", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(
        tx,
        dineIn(f, [{ dish_id: f.regular.id, quantity: 1, unit_price_kes: 1, price_kes: 1 }], { subtotal_kes: 1, total_kes: 1 }),
      );
      expect(order.total_kes).toBe(300);
      const [item] = await tx`
        select i.unit_price_kes from public.order_items i join public.orders o on o.id = i.order_id
        where o.public_token = ${order.public_token}`;
      expect(item.unit_price_kes).toBe(300);
    }));

  test("enforces the plate limit and leaves the count untouched on rejection", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const rotating = (quantity: number) => dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity }]);

      await expect(placeOrder(tx, rotating(4))).rejects.toThrow("Sorry, Test rotating has sold out");
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);

      await placeOrder(tx, rotating(3));
      expect(await platesSold(tx, f.openEntry.id)).toBe(3);

      await expect(placeOrder(tx, rotating(1))).rejects.toThrow("Sorry, Test rotating has sold out");
      expect(await platesSold(tx, f.openEntry.id)).toBe(3);
    }));

  test("rejects a rotating dish outside its serving hours", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      await expect(
        placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.closedEntry.id, quantity: 1 }])),
      ).rejects.toThrow("Test rotating is not on the menu right now");
      expect(await platesSold(tx, f.closedEntry.id)).toBe(0);
    }));
});

describe("cancelling an order", () => {
  test("gives its rotating-dish plates back for that day", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.rotating.id, menu_entry_id: f.openEntry.id, quantity: 2 }]));
      expect(await platesSold(tx, f.openEntry.id)).toBe(2);

      const updated = await asOwner(tx, f, () =>
        tx`update public.orders set status = 'cancelled' where public_token = ${order.public_token} returning id`,
      );
      expect(updated.length).toBe(1);
      expect(await platesSold(tx, f.openEntry.id)).toBe(0);
    }));
});
