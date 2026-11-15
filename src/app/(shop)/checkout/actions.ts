"use server";
import { z } from "zod";
import { codeReason, type CodeReason } from "@/lib/discount-words";
import { normaliseKenyanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const item = z.object({
  dishId: z.string().uuid(),
  menuEntryId: z.string().uuid().nullable(),
  optionId: z.string().uuid().nullable(),
  extraIds: z.array(z.string().uuid()).max(8).default([]),
  quantity: z.number().int().min(1).max(20),
  note: z.string().max(200),
});

/** A combo: its dishes with their choices, each part's quantity per combo (spec-2.11 B). */
const combo = z.object({
  comboId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  parts: z
    .array(
      z.object({
        dish_id: z.string().uuid(),
        menu_entry_id: z.string().uuid().nullable(),
        option_id: z.string().uuid().nullable(),
        extra_ids: z.array(z.string().uuid()).max(8),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(8),
});

const input = z
  .object({
    idempotencyKey: z.string().uuid("Refresh the page and try again"),
    mode: z.enum(["dine_in", "pickup", "delivery"]),
    tableToken: z.string().optional(),
    pickupAt: z.string().datetime().nullable().optional(),
    zoneId: z.string().uuid().optional(),
    address: z.string().max(300).optional(),
    riderNotes: z.string().max(300).optional(),
    name: z.string().trim().min(1, "Add your name").max(80),
    phone: z.string(),
    // Launch takes no online payment (spec-2.1-payments.md); place_order checks the same.
    payment: z.enum(["on_handover", "at_counter"], { message: "Choose how you’ll pay" }),
    items: z.array(item).max(30),
    combos: z.array(combo).max(30).default([]),
    discountCode: z.string().trim().max(20).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.items.length + v.combos.length === 0) ctx.addIssue({ code: "custom", message: "Your order is empty" });
    if (v.mode === "delivery" && !v.zoneId) ctx.addIssue({ code: "custom", message: "Choose a delivery area" });
    if (v.mode === "delivery" && !v.address?.trim()) ctx.addIssue({ code: "custom", message: "Add your delivery address" });
    if (v.mode === "dine_in" && !v.tableToken) ctx.addIssue({ code: "custom", message: "Scan the QR code on your table" });
    if (v.mode !== "dine_in" && v.payment === "at_counter")
      ctx.addIssue({ code: "custom", message: "Pay at the counter is for orders at a table. Choose pay on handover." });
  });

export type CheckoutInput = z.input<typeof input>;
export type CheckoutResult =
  | { ok: true; token: string }
  | { ok: false; error: string; reason?: Reason; codeError?: CodeReason };

/**
 * place_order's stable refusal codes (its DETAIL). kitchen_closed and pickup_time rebuild the button
 * and the pickup times; the menu ones (MENU_REASONS) make checkout check the order again (spec-2.8);
 * under_minimum means the area's minimum changed since the page loaded.
 */
const REASONS = ["kitchen_closed", "pickup_time", "sold_out", "over_plates", "not_on_menu", "option_out", "under_minimum"] as const;
type Reason = (typeof REASONS)[number];

const TABLE_GONE = "Scan the QR code on your table again";
const TABLE_CHANGED = "This table’s QR has changed. Scan the code on the table again.";

const reasonOf = (details: string | undefined): Reason | undefined => REASONS.find((r) => r === details);

export async function placeOrder(raw: CheckoutInput): Promise<CheckoutResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details" };
  const v = parsed.data;

  const phone = normaliseKenyanPhone(v.phone);
  if (!phone) return { ok: false, error: "Use a Kenyan mobile number, e.g. 0712 345 678" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("place_order", {
    p: {
      idempotency_key: v.idempotencyKey,
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
        extra_ids: i.extraIds,
        quantity: i.quantity,
        note: i.note,
      })),
      combos: v.combos.map((c) => ({ combo_id: c.comboId, quantity: c.quantity, parts: c.parts })),
      discount_code: v.discountCode || null,
    },
  });

  if (error) {
    // P0001 = messages written for customers inside place_order.
    // A new code or a table turned off mid-order (spec-2.6 States): say why, not just "scan again".
    if (error.code === "P0001" && error.message === TABLE_GONE) return { ok: false, error: TABLE_CHANGED };
    // A code refusal (Q2 A): checkout offers to place the order without it.
    if (error.code === "P0001" && error.details === "discount_code")
      return { ok: false, error: error.message, codeError: codeReason(error.hint?.replace(/^discount_code:/, "")) ?? "unknown" };
    if (error.code === "P0001") return { ok: false, error: error.message, reason: reasonOf(error.details) };
    return { ok: false, error: "Something went wrong placing your order. Try again." };
  }
  const placed = data?.[0];
  if (!placed) return { ok: false, error: "Something went wrong placing your order. Try again." };

  // A retry of an order that already went through gets the same order back (placed.replayed).
  return { ok: true, token: placed.public_token };
}
