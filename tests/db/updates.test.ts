// The update paths the dashboard uses (src/app/dashboard/actions.ts), run as the
// signed-in owner, and the timestamps the shared triggers stamp on them.
import { describe, expect, test } from "bun:test";
import { asOwner, backdateOrder, dineIn, inTx, placeOrder, seedFixtures } from "./helpers";

describe("dish updates by the owner", () => {
  test("editing a dish saves and stamps updated_at", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [row] = await asOwner(tx, f, () => tx`
        update public.dishes set name = 'Renamed', description = 'New words', price_kes = 320
        where id = ${f.regular.id} returning name, price_kes, updated_at > '2020-01-02' as touched`);
      expect(row).toEqual({ name: "Renamed", price_kes: 320, touched: true });
    }));

  test("the regular on/off toggle saves", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [row] = await asOwner(tx, f, () => tx`
        update public.dishes set regular_available = false
        where id = ${f.regular.id} returning regular_available, updated_at > '2020-01-02' as touched`);
      expect(row).toEqual({ regular_available: false, touched: true });
    }));

  test("last_served_on bookkeeping saves", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const [row] = await asOwner(tx, f, () => tx`
        update public.dishes set last_served_on = public.nairobi_today()
        where id = ${f.rotating.id} returning last_served_on = public.nairobi_today() as saved`);
      expect(row).toEqual({ saved: true });
    }));
});

describe("order timestamps", () => {
  test("status_changed_at moves only when the status changes; updated_at on every update", () =>
    inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const order = await placeOrder(tx, dineIn(f, [{ dish_id: f.regular.id, quantity: 1 }]));
      await backdateOrder(tx, order.public_token);
      const stamps = async () => {
        const [o] = await tx`
          select updated_at > '2020-01-02' as updated, status_changed_at > '2020-01-02' as status_changed
          from public.orders where public_token = ${order.public_token}`;
        return o;
      };

      const [{ id }] = await tx`select id from public.orders where public_token = ${order.public_token}`;
      await asOwner(tx, f, () => tx`select public.mark_order_paid(${id}::uuid)`);
      expect(await stamps()).toEqual({ updated: true, status_changed: false });

      await asOwner(tx, f, () => tx`select public.advance_order(${id}::uuid, 'new'::public.order_status, 'preparing'::public.order_status)`);
      expect(await stamps()).toEqual({ updated: true, status_changed: true });
    }));
});
