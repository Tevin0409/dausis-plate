"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Enums } from "@/lib/database.types";
import { addDays, weekStart } from "@/lib/format";
import { deletePhotoSet, PHOTO_KEY, photoExists, publicPhotoUrl } from "@/lib/r2";
import { createClient, getStaff } from "@/lib/supabase/server";

async function staffClient() {
  const staff = await getStaff();
  if (!staff) throw new Error("Not signed in as staff");
  return createClient();
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ───────── dishes ─────────

const dishForm = z.object({
  id: uuid.optional().or(z.literal("")),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  price_kes: z.coerce.number().int().min(0).max(100000),
  category: z.enum(["mains", "sides", "breakfast", "drinks"]),
  photo_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  photo_thumb_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  is_regular: z.literal("on").optional(),
  add_day: isoDay.optional().or(z.literal("")),
  add_kind: z.enum(["day", "week"]).optional(),
  plates_per_day: z.coerce.number().int().min(0).max(1000).optional(),
  show_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  show_until: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export async function saveDish(formData: FormData) {
  const supabase = await staffClient();
  const v = dishForm.parse(Object.fromEntries(formData));
  const row: {
    name: string;
    description: string;
    price_kes: number;
    category: Enums<"dish_category">;
    is_regular: boolean;
    photo_key?: string;
    photo_url?: string;
    photo_thumb_url?: string;
  } = {
    name: v.name,
    description: v.description,
    price_kes: v.price_kes,
    category: v.category,
    is_regular: v.is_regular === "on",
  };

  // A new photo was uploaded: make sure both files really are in R2 before pointing the dish at them.
  if (v.photo_key && v.photo_thumb_key) {
    const sameSet = v.photo_key.split("/")[1] === v.photo_thumb_key.split("/")[1];
    const [full, thumb] = await Promise.all([photoExists(v.photo_key), photoExists(v.photo_thumb_key)]);
    if (!sameSet || !full || !thumb) throw new Error("The photo didn’t finish uploading. Try again.");
    row.photo_key = v.photo_key;
    row.photo_url = publicPhotoUrl(v.photo_key);
    row.photo_thumb_url = publicPhotoUrl(v.photo_thumb_key);
  }

  let dishId = v.id || null;
  if (dishId) {
    const { data: before } = await supabase.from("dishes").select("photo_key").eq("id", dishId).maybeSingle();
    const { error } = await supabase.from("dishes").update(row).eq("id", dishId);
    if (error) throw error;
    if (row.photo_key && before?.photo_key && before.photo_key !== row.photo_key) await deletePhotoSet(before.photo_key);
  } else {
    const { data, error } = await supabase.from("dishes").insert(row).select("id").single();
    if (error) throw error;
    dishId = data.id;
  }

  if (v.add_day && v.add_kind) {
    await insertEntry(dishId, v.add_day, v.add_kind, {
      plates_per_day: v.plates_per_day ? v.plates_per_day : null,
      show_from: v.show_from ?? "11:00",
      show_until: v.show_until ?? "20:00",
    });
    revalidatePath("/dashboard/menu");
    redirect(`/dashboard/menu?day=${v.add_day}`);
  }
  revalidatePath("/dashboard/manage");
  revalidatePath("/");
  redirect(row.is_regular ? "/dashboard/manage" : "/dashboard/menu");
}

// ───────── rotating menu ─────────

async function insertEntry(
  dishId: string,
  day: string,
  kind: Enums<"entry_kind">,
  opts: { plates_per_day: number | null; show_from: string; show_until: string },
) {
  const supabase = await staffClient();
  const ends_on = kind === "day" ? day : addDays(weekStart(day), 6);
  const { error } = await supabase.from("menu_entries").insert({ dish_id: dishId, kind, starts_on: day, ends_on, ...opts });
  if (error) throw error;
  await supabase.from("dishes").update({ last_served_on: day }).eq("id", dishId);
}

/** "+ Tue" in the dish library: reuse the dish's last plate count and hours. */
export async function addFromLibrary(formData: FormData) {
  const v = z.object({ dishId: uuid, day: isoDay, kind: z.enum(["day", "week"]) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { data: last } = await supabase
    .from("menu_entries")
    .select("plates_per_day, show_from, show_until")
    .eq("dish_id", v.dishId)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  await insertEntry(v.dishId, v.day, v.kind, {
    plates_per_day: last?.plates_per_day ?? null,
    show_from: last?.show_from?.slice(0, 5) ?? "11:00",
    show_until: last?.show_until?.slice(0, 5) ?? "20:00",
  });
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
}

export async function copyDay(formData: FormData) {
  const v = z.object({ from: isoDay, to: isoDay }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.rpc("copy_menu_day", { p_from: v.from, p_to: v.to });
  if (error) throw error;
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
}

export async function setSoldOut(formData: FormData) {
  const v = z.object({ entryId: uuid, soldOut: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.rpc("set_entry_sold_out", { p_entry: v.entryId, p_sold_out: v.soldOut === "true" });
  if (error) throw error;
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
}

export async function endEntryEarly(formData: FormData) {
  const { entryId } = z.object({ entryId: uuid }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("menu_entries").update({ ended_early_at: new Date().toISOString() }).eq("id", entryId);
  if (error) throw error;
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
}

/** Removes a planned dish. Entries that already have orders are unpublished instead, to keep history. */
export async function removeEntry(formData: FormData) {
  const { entryId } = z.object({ entryId: uuid }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("menu_entries").delete().eq("id", entryId);
  if (error) await supabase.from("menu_entries").update({ published: false }).eq("id", entryId);
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
}

// ───────── regular menu ─────────

export async function setRegularAvailable(formData: FormData) {
  const v = z.object({ dishId: uuid, available: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("dishes").update({ regular_available: v.available === "true" }).eq("id", v.dishId);
  if (error) throw error;
  revalidatePath("/dashboard/manage");
  revalidatePath("/");
}

// ───────── orders ─────────

const NEXT_STATUS: Partial<Record<Enums<"order_status">, Enums<"order_status">>> = {
  new: "preparing",
  preparing: "ready",
  ready: "completed",
};

export async function advanceOrder(formData: FormData) {
  const v = z.object({ orderId: uuid, from: z.enum(["new", "preparing", "ready"]) }).parse(Object.fromEntries(formData));
  const to = NEXT_STATUS[v.from];
  if (!to) return;
  const supabase = await staffClient();
  // Guarded on the current status so two tablets tapping at once can't skip a step.
  const { error } = await supabase.from("orders").update({ status: to }).eq("id", v.orderId).eq("status", v.from);
  if (error) throw error;
  revalidatePath("/dashboard/orders");
}

export async function markPaid(formData: FormData) {
  const { orderId } = z.object({ orderId: uuid }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/dashboard/orders");
}

export async function cancelOrder(formData: FormData) {
  const { orderId } = z.object({ orderId: uuid }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/dashboard/orders");
}
