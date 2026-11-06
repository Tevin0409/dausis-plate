"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Enums } from "@/lib/database.types";
import { addDays, weekdayName, weekStart } from "@/lib/format";
import { deletePhotoSet, PHOTO_KEY, photoExists, publicPhotoUrl } from "@/lib/r2";
import { createClient, getStaff } from "@/lib/supabase/server";
import type { ActionResult } from "./action-result";

// Form actions return null on success or { error } with a message for the person
// who tapped (shown by ActionForm). Details go to the server log, never the UI.

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string } | null;

const SIGNED_OUT: ActionResult = { error: "You’re signed out. Sign in again and retry." };
const STALE_FORM: ActionResult = { error: "Something didn’t match. Refresh the page and try again." };

/** The caller's client when they are signed-in staff; otherwise the message to show instead. */
async function staffClient(): Promise<[Db, null] | [null, ActionResult]> {
  try {
    if (!(await getStaff())) return [null, SIGNED_OUT];
  } catch {
    return [null, { error: "Couldn’t check you’re signed in. Try again." }];
  }
  return [await createClient(), null];
}

function failed(what: string, error: DbError, message: string): ActionResult {
  console.error(`[action] ${what} failed:`, error?.code ?? "", error?.message ?? "");
  return { error: message };
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ───────── dishes ─────────

/** The most plates a menu entry can offer in a day (the planner's "Plates a day" field). */
const MAX_PLATES_PER_DAY = 1000;

const dishForm = z.object({
  id: uuid.optional().or(z.literal("")),
  new_id: uuid.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  price_kes: z.coerce.number().int().min(0).max(100000),
  category: z.enum(["mains", "sides", "breakfast", "drinks"]),
  photo_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  photo_thumb_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  is_regular: z.literal("on").optional(),
  add_day: isoDay.optional().or(z.literal("")),
  add_kind: z.enum(["day", "week"]).optional(),
  plates_per_day: z.coerce.number().int().min(0).max(MAX_PLATES_PER_DAY).optional(),
  show_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  show_until: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export async function saveDish(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = dishForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === "plates_per_day")) {
      return { error: `Plates a day must be a whole number up to ${MAX_PLATES_PER_DAY.toLocaleString("en-KE")}. Leave it empty for no limit.` };
    }
    return { error: "Check the name, price and times, then save again." };
  }
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
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
    if (!sameSet || !full || !thumb) return { error: "The photo didn’t finish uploading. Try again." };
    row.photo_key = v.photo_key;
    row.photo_url = publicPhotoUrl(v.photo_key);
    row.photo_thumb_url = publicPhotoUrl(v.photo_thumb_key);
  }

  let dishId: string;
  let created = false;
  if (v.id) {
    dishId = v.id;
    const { data: before } = await supabase.from("dishes").select("photo_key").eq("id", dishId).maybeSingle();
    const { data, error } = await supabase.from("dishes").update(row).eq("id", dishId).select("id");
    if (error) return failed("saveDish update", error, "Couldn’t save the dish. Try again.");
    if (data.length === 0) return { error: "This dish no longer exists. Go back and refresh." };
    if (row.photo_key && before?.photo_key && before.photo_key !== row.photo_key) await deletePhotoSet(before.photo_key);
  } else {
    if (!v.new_id) return { error: "Reload the page and try again." };
    dishId = v.new_id;
    const { error } = await supabase.from("dishes").insert({ ...row, id: dishId });
    // 23505 = this form was already submitted once and the dish exists: don't create anything twice.
    if (error && error.code !== "23505") return failed("saveDish insert", error, "Couldn’t save the dish. Try again.");
    created = !error;
  }

  if (v.add_day && v.add_kind && (created || v.id)) {
    const added = await insertEntry(supabase, dishId, v.add_day, v.add_kind, {
      plates_per_day: v.plates_per_day ? v.plates_per_day : null,
      show_from: v.show_from ?? "11:00",
      show_until: v.show_until ?? "20:00",
    });
    revalidatePath("/dashboard/menu");
    if (added) return added;
    redirect(`/dashboard/menu?day=${v.add_day}`);
  }
  revalidatePath("/dashboard/manage");
  revalidatePath("/");
  if (v.add_day) redirect(`/dashboard/menu?day=${v.add_day}`);
  redirect(row.is_regular ? "/dashboard/manage" : "/dashboard/menu");
}

// ───────── rotating menu ─────────

async function insertEntry(
  supabase: Db,
  dishId: string,
  day: string,
  kind: Enums<"entry_kind">,
  opts: { plates_per_day: number | null; show_from: string; show_until: string },
): Promise<ActionResult> {
  const ends_on = kind === "day" ? day : addDays(weekStart(day), 6);
  const { error } = await supabase.from("menu_entries").insert({ dish_id: dishId, kind, starts_on: day, ends_on, ...opts });
  // 23505 = menu_entries_one_per_day: it's already planned for that day, so retrying can't help.
  if (error?.code === UNIQUE_VIOLATION) return { error: `This dish is already on ${weekdayName(day)}’s menu.` };
  if (error) return failed("insertEntry", error, "Couldn’t add the dish to the menu. Try again.");
  const { error: served } = await supabase.from("dishes").update({ last_served_on: day }).eq("id", dishId);
  if (served) return failed("insertEntry last_served_on", served, "Added to the menu, but the dish library date didn’t update.");
  return null;
}

/** "+ Tue" in the dish library: reuse the dish's last plate count and hours. */
export async function addFromLibrary(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ dishId: uuid, day: isoDay, kind: z.enum(["day", "week"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data: last, error } = await supabase
    .from("menu_entries")
    .select("plates_per_day, show_from, show_until")
    .eq("dish_id", v.dishId)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return failed("addFromLibrary last entry", error, "Couldn’t add the dish to the menu. Try again.");
  const added = await insertEntry(supabase, v.dishId, v.day, v.kind, {
    plates_per_day: last?.plates_per_day ?? null,
    show_from: last?.show_from?.slice(0, 5) ?? "11:00",
    show_until: last?.show_until?.slice(0, 5) ?? "20:00",
  });
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return added;
}

export async function copyDay(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ from: isoDay, to: isoDay }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.rpc("copy_menu_day", { p_from: parsed.data.from, p_to: parsed.data.to });
  if (error) return failed("copyDay", error, "Couldn’t copy the menu. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return null;
}

export async function setSoldOut(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ entryId: uuid, soldOut: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.rpc("set_entry_sold_out", { p_entry: parsed.data.entryId, p_sold_out: parsed.data.soldOut === "true" });
  if (error) return failed("setSoldOut", error, "Couldn’t change sold out. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return null;
}

export async function endEntryEarly(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ entryId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("menu_entries").update({ ended_early_at: new Date().toISOString() }).eq("id", parsed.data.entryId);
  if (error) return failed("endEntryEarly", error, "Couldn’t end it early. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return null;
}

/** Removes a planned dish. Entries that already have orders are unpublished instead, to keep history. */
export async function removeEntry(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ entryId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("menu_entries").delete().eq("id", parsed.data.entryId);
  if (error) {
    // Only an entry that orders still point at falls back to unpublishing.
    if (error.code !== FOREIGN_KEY_VIOLATION) return failed("removeEntry delete", error, "Couldn’t remove it. Try again.");
    const { error: hide } = await supabase.from("menu_entries").update({ published: false }).eq("id", parsed.data.entryId);
    if (hide) return failed("removeEntry unpublish", hide, "Couldn’t remove it. Try again.");
  }
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return null;
}

// ───────── regular menu ─────────

export async function setRegularAvailable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ dishId: uuid, available: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("dishes").update({ regular_available: parsed.data.available === "true" }).eq("id", parsed.data.dishId);
  if (error) return failed("setRegularAvailable", error, "Couldn’t change it. Try again.");
  revalidatePath("/dashboard/manage");
  revalidatePath("/");
  return null;
}

// ───────── orders ─────────

const NEXT_STATUS: Partial<Record<Enums<"order_status">, Enums<"order_status">>> = {
  new: "preparing",
  preparing: "ready",
  ready: "completed",
};

export async function advanceOrder(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ orderId: uuid, from: z.enum(["new", "preparing", "ready"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const v = parsed.data;
  const to = NEXT_STATUS[v.from];
  if (!to) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  // Guarded on the current status so two tablets tapping at once can't skip a step.
  const { data, error } = await supabase.from("orders").update({ status: to }).eq("id", v.orderId).eq("status", v.from).select("id");
  revalidatePath("/dashboard/orders");
  if (error) return failed("advanceOrder", error, "Couldn’t move the order. Try again.");
  if (data.length === 0) return { error: "Someone else already moved this order. The board is updated." };
  return null;
}

export async function markPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ orderId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", parsed.data.orderId);
  if (error) return failed("markPaid", error, "Couldn’t mark it paid. Try again.");
  revalidatePath("/dashboard/orders");
  return null;
}

export async function cancelOrder(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ orderId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", parsed.data.orderId);
  if (error) return failed("cancelOrder", error, "Couldn’t decline the order. Try again.");
  revalidatePath("/dashboard/orders");
  return null;
}

// ───────── removing dishes ─────────

/** Takes a regular dish off the everyday menu; it stays in the dish library for rotating days. */
export async function removeFromRegulars(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ dishId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data, error } = await supabase.from("dishes").update({ is_regular: false }).eq("id", parsed.data.dishId).select("id");
  if (error) return failed("removeFromRegulars", error, "Couldn’t take it off the menu. Try again.");
  if (data.length === 0) return { error: "This dish no longer exists. Refresh the page." };
  revalidatePath("/dashboard/manage");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return null;
}

const deleteResult = z.object({
  result: z.enum(["deleted", "archived", "missing"]),
  photo_key: z.string().nullable().optional(),
});

/**
 * Deletes a dish everywhere, in one database transaction (delete_dish). A dish that was never
 * ordered is removed for good (with its photo); one with past orders is archived instead so
 * receipts and sales history stay intact. Either way it leaves the menu, the planner and the library.
 * Any failure changes nothing, so the message can say so.
 */
export async function deleteDish(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ dishId: uuid, after: z.enum(["/dashboard/menu", "/dashboard/manage"]).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const { dishId, after } = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data, error } = await supabase.rpc("delete_dish", { p_dish: dishId });
  if (error) return failed("deleteDish", error, "Couldn’t delete the dish. Nothing was changed. Try again.");
  const done = deleteResult.safeParse(data);
  if (!done.success) {
    return failed("deleteDish result", { message: done.error.message }, "Couldn’t tell whether the dish was deleted. Refresh the page to check.");
  }
  if (done.data.result === "missing") return { error: "This dish was already deleted. Refresh the page." };
  if (done.data.result === "deleted") await deletePhotoSet(done.data.photo_key ?? null);
  revalidatePath("/dashboard/manage");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  if (after) redirect(after);
  return null;
}
