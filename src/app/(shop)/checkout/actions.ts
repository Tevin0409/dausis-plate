"use server";
import { z } from "zod";
import { startCardPayment, startMpesaPayment, type PaymentStart } from "@/lib/payments";
import { normaliseKenyanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const item = z.object({
  dishId: z.string().uuid(),
  menuEntryId: z.string().uuid().nullable(),
  optionId: z.string().uuid().nullable(),
  quantity: z.number().int().min(1).max(20),
  note: z.string().max(200),
});

const input = z
  .object({
    mode: z.enum(["dine_in", "pickup", "delivery"]),
    tableToken: z.string().optional(),
    pickupAt: z.string().datetime().nullable().optional(),
    zoneId: z.string().uuid().optional(),
    address: z.string().max(300).optional(),
    riderNotes: z.string().max(300).optional(),
    name: z.string().trim().min(1, "Add your name").max(80),
    phone: z.string(),
    payment: z.enum(["mpesa", "card", "on_handover"]),
    items: z.array(item).min(1, "Your order is empty").max(30),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "delivery" && !v.zoneId) ctx.addIssue({ code: "custom", message: "Choose a delivery area" });
    if (v.mode === "delivery" && !v.address?.trim()) ctx.addIssue({ code: "custom", message: "Add your delivery address" });
    if (v.mode === "dine_in" && !v.tableToken) ctx.addIssue({ code: "custom", message: "Scan the QR code on your table" });
  });

export type CheckoutInput = z.input<typeof input>;
export type CheckoutResult =
  | { ok: true; token: string; payment: PaymentStart }
  | { ok: false; error: string };

export async function placeOrder(raw: CheckoutInput): Promise<CheckoutResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details" };
  const v = parsed.data;

  const phone = normaliseKenyanPhone(v.phone);
  if (!phone) return { ok: false, error: "Use a Kenyan mobile number, e.g. 0712 345 678" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("place_order", {
    p: {
      mode: v.mode,
      table_token: v.tableToken ?? null,
      pickup_at: v.pickupAt ?? null,
      delivery_zone_id: v.zoneId ?? null,
      delivery_address: v.address ?? null,
      delivery_notes: v.riderNotes ?? null,
      customer_name: v.name,
      customer_phone: phone,
      payment_method: v.payment,
      items: v.items.map((i) => ({
        dish_id: i.dishId,
        menu_entry_id: i.menuEntryId,
        option_id: i.optionId,
        quantity: i.quantity,
        note: i.note,
      })),
    },
  });

  if (error) {
    // P0001 = messages written for customers inside place_order.
    return { ok: false, error: error.code === "P0001" ? error.message : "Something went wrong placing your order. Try again." };
  }
  const placed = data?.[0];
  if (!placed) return { ok: false, error: "Something went wrong placing your order. Try again." };

  const order = { code: placed.code, publicToken: placed.public_token, totalKes: placed.total_kes, phone };
  const payment: PaymentStart =
    v.payment === "mpesa" ? await startMpesaPayment(order) : v.payment === "card" ? await startCardPayment(order) : { kind: "none" };

  return { ok: true, token: placed.public_token, payment };
}
