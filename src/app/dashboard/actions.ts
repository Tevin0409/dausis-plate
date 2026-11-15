"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Enums, Json } from "@/lib/database.types";
import { NOTE_MAX, NOTE_MIN, nextStatus } from "@/lib/board";
import { addDays, weekdayName, weekStart } from "@/lib/format";
import { clashMessage, dow, REFUSAL_FIELD } from "@/lib/planner";
import { deletePhotoSet, PHOTO_KEY, photoExists, publicPhotoUrl } from "@/lib/r2";
import { optionProblem, OPTION_MESSAGES, type OptionInput } from "@/lib/dish-options";
import { refusal } from "@/lib/supabase/refusal";
import { createClient, getStaff } from "@/lib/supabase/server";
import type { ActionResult, BoardResult, OrderRefusal, PlannerResult, Undo } from "./action-result";

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
  const refused = refusal(error);
  return refused ? { error: refused, stale: true } : { error: message };
}

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
  // Slice 2.6: the choices and extras, as JSON from the editor's OptionsEditor. Absent means
  // the form had no options editor (nothing to change).
  options: z.string().max(20000).optional(),
});

const optionsJson = z
  .array(
    z.object({
      id: uuid.optional(),
      kind: z.enum(["choice", "extra"]),
      label: z.string().max(200),
      extra: z.number().nullable(),
      isDefault: z.boolean(),
    }),
  )
  .max(32);

/** The editor's options, or the message to show when they can't be saved as they are. */
function readOptions(json: string | undefined): { rows: OptionInput[] | null } | { error: string } {
  if (json === undefined) return { rows: null };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: OPTION_MESSAGES.shape };
  }
  const parsed = optionsJson.safeParse(raw);
  if (!parsed.success) return { error: OPTION_MESSAGES.shape };
  const problem = optionProblem(parsed.data);
  return problem ? { error: problem.message } : { rows: parsed.data };
}

/** save_dish_options; its P0001 refusals are written for the person saving. */
async function saveOptions(supabase: Db, dishId: string, rows: OptionInput[]): Promise<ActionResult> {
  const { error } = await supabase.rpc("save_dish_options", { p_dish: dishId, p_options: rows as unknown as Json });
  if (!error) return null;
  if (error.code === "P0001") {
    console.error("[action] save_dish_options refused:", error.message);
    return { error: error.message === "That dish isn't there any more." ? "This dish no longer exists. Go back and refresh." : error.message };
  }
  return failed("saveDish options", error, "Couldn’t save the dish. Nothing has changed. Try again.");
}

export async function saveDish(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = dishForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === "plates_per_day")) {
      return { error: `Plates a day must be a whole number up to ${MAX_PLATES_PER_DAY.toLocaleString("en-KE")}. Leave it empty for no limit.` };
    }
    return { error: "Check the name, price and times, then save again." };
  }
  const v = parsed.data;
  const options = readOptions(v.options);
  if ("error" in options) return { error: options.error };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const row: {
    name: string;
    description: string;
    price_kes: number;
    category: Enums<"dish_category">;
    is_regular?: boolean;
    photo_key?: string;
    photo_url?: string;
    photo_thumb_url?: string;
  } = {
    name: v.name,
    description: v.description,
    price_kes: v.price_kes,
    category: v.category,
  };
  // An existing dish's place on the everyday menu is its own switch (slice 2.6), saved at once;
  // only a new dish takes it from the form.
  if (!v.id) row.is_regular = v.is_regular === "on";

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
    // Options first: they are the likelier refusal (stale ids), and then nothing has changed.
    if (options.rows) {
      const refused = await saveOptions(supabase, dishId, options.rows);
      if (refused) return refused;
    }
    const { data: before } = await supabase.from("dishes").select("photo_key").eq("id", dishId).maybeSingle();
    const { data, error } = await supabase.from("dishes").update(row).eq("id", dishId).select("id");
    if (error) return failed("saveDish update", error, "Couldn’t save the dish. Try again.");
    if (data.length === 0) return { error: "This dish no longer exists. Go back and refresh." };
    if (row.photo_key && before?.photo_key && before.photo_key !== row.photo_key) await deletePhotoSet(before.photo_key);
  } else {
    if (!v.new_id) return { error: "Reload the page and try again." };
    dishId = v.new_id;
    const { error } = await supabase.from("dishes").insert({ ...row, id: dishId });
    // 23505 = this form was already submitted once and the dish exists (an earlier try whose
    // options were refused): don't create anything twice, save what was typed over it.
    if (error?.code === UNIQUE_VIOLATION) {
      const words = { ...row };
      delete words.is_regular;
      const { error: again } = await supabase.from("dishes").update(words).eq("id", dishId);
      if (again) return failed("saveDish retry", again, "Couldn’t save the dish. Try again.");
    } else if (error) return failed("saveDish insert", error, "Couldn’t save the dish. Try again.");
    // The retry still adds it to the planned day: the try before stopped before that step.
    created = true;
    if (options.rows && options.rows.length > 0) {
      const refused = await saveOptions(supabase, dishId, options.rows);
      if (refused) return refused;
    }
  }

  if (v.add_day && v.add_kind && (created || v.id)) {
    const added = await addNewDishToMenu(supabase, dishId, v.name, v.add_day, v.add_kind, {
      plates: v.plates_per_day ? v.plates_per_day : null,
      from: v.show_from ?? "11:00",
      until: v.show_until ?? "20:00",
    });
    revalidatePath("/dashboard/menu");
    if (added) return added;
    redirect(`/dashboard/menu?day=${v.add_day}`);
  }
  revalidatePath("/dashboard/manage");
  revalidatePath(`/dashboard/dishes/${dishId}`);
  revalidatePath("/");
  if (v.add_day) redirect(`/dashboard/menu?day=${v.add_day}`);
  // An edit stays on the editor, whose save bar says when it saved; a new dish goes to the list.
  if (v.id) return null;
  redirect(row.is_regular ? "/dashboard/manage" : "/dashboard/manage?view=all");
}

// ───────── rotating menu ─────────

// Slice 2.5: the planner's actions. They are called from the planner panel with plain values (not
// forms) and return what the panel needs: an error under the right field, the removal's Undo, or a
// copy's result for the note. The rules live in the database (add_menu_entry and the rest).

type PgError = { message: string; code?: string; details?: string | null; hint?: string | null } | null;

const SAVE_FAILED = "Couldn’t save. Nothing has changed. Try again.";
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function plannerFailed(what: string, error: PgError, ctx: { name: string; day: string | null; mine: "day" | "week" }, message = SAVE_FAILED): PlannerResult {
  console.error(`[action] ${what} failed:`, error?.code ?? "", error?.message ?? "", error?.details ?? "");
  const refused = refusal(error);
  if (refused) return { ok: false, error: refused, field: "form", stale: true };
  if (error?.code === UNIQUE_VIOLATION) {
    // raise_clash puts the date in detail and the other entry's kind in hint; the bare unique index doesn't.
    const day = isIso(error.details) ? error.details : ctx.day;
    const text = day ? clashMessage(ctx.name, day, ctx.mine, error.hint ?? null) : `${ctx.name} is already on that day’s menu.`;
    return { ok: false, error: text, field: ctx.mine === "week" ? "days" : "dish" };
  }
  const code = error?.code === "P0001" ? (error.details ?? "") : "";
  if (code === "gone") {
    const on = ctx.day ? ` ${weekdayName(ctx.day)}` : " the menu";
    return { ok: false, error: `${ctx.name} was taken off${on} meanwhile.`, field: "form", gone: true };
  }
  if (REFUSAL_FIELD[code] && error) return { ok: false, error: error.message, field: REFUSAL_FIELD[code] };
  return { ok: false, error: message, field: "form" };
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const plates = z.number().int().min(1).max(MAX_PLATES_PER_DAY).nullable();
const price = z.number().int().min(0).max(100000).nullable();

const addInput = z.object({
  dishId: uuid,
  dishName: z.string().max(200),
  kind: z.enum(["day", "week"]),
  days: z.array(isoDay).max(7),
  from: time,
  until: time,
  plates,
  price,
});

/** "+ Day" and "+ Week": adds nothing until the panel's Add. */
export async function addEntry(input: z.input<typeof addInput>): Promise<PlannerResult> {
  const parsed = addInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  const { data, error } = await supabase.rpc("add_menu_entry", {
    p_dish: v.dishId,
    p_kind: v.kind,
    p_days: v.days,
    p_from: v.from,
    p_until: v.until,
    p_plates: v.plates,
    p_price: v.price,
  });
  if (error) return plannerFailed("addEntry", error, { name: v.dishName, day: v.days[0] ?? null, mine: v.kind }, "Couldn’t add it. Nothing has changed. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return { ok: true, entryId: data };
}

const updateInput = z.object({
  entryId: uuid,
  dishName: z.string().max(200),
  kind: z.enum(["day", "week"]),
  day: isoDay,
  from: time,
  until: time,
  plates,
  price,
  days: z.array(isoDay).max(7).nullable(),
});

/** Save in the panel. A week dish's unticked days become days off; no day left removes it. */
export async function updateEntry(input: z.input<typeof updateInput>): Promise<PlannerResult> {
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  const { data, error } = await supabase.rpc("update_menu_entry", {
    p_entry: v.entryId,
    p_from: v.from,
    p_until: v.until,
    p_plates: v.plates,
    p_price: v.price,
    p_days: v.kind === "week" ? v.days : null,
  });
  if (error) return plannerFailed("updateEntry", error, { name: v.dishName, day: v.day, mine: v.kind });
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  // Unticking every remaining day removed it: hand back the Undo as a removal would.
  return data ? { ok: true, undo: data as Undo } : { ok: true };
}

const removeInput = z.object({ entryId: uuid, dishName: z.string().max(200), kind: z.enum(["day", "week"]), day: isoDay.nullable() });

/** "Remove from Tuesday" (a day dish, or one day of a week dish) or "Remove from the rest of the week". */
export async function removeEntry(input: z.input<typeof removeInput>): Promise<PlannerResult> {
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  const { data, error } = await supabase.rpc("remove_menu_entry", { p_entry: v.entryId, p_day: v.kind === "week" ? v.day : null });
  if (error) return plannerFailed("removeEntry", error, { name: v.dishName, day: v.day, mine: v.kind }, "Couldn’t remove it. Nothing has changed. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return { ok: true, undo: data as Undo };
}

const undoInput = z.object({
  dishName: z.string().max(200),
  kind: z.enum(["day", "week"]),
  undo: z.object({ did: z.enum(["deleted", "unpublished", "off_day", "ended"]), entry: uuid, day: isoDay, token: uuid }).passthrough(),
});

/** Undo on "Pilau removed · Undo": reverses exactly what the removal did. */
export async function restoreEntry(input: z.input<typeof undoInput>): Promise<PlannerResult> {
  const parsed = undoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  // Only the token: the database reverses its own record of the removal (RQA25-01).
  const { error } = await supabase.rpc("restore_menu_entry", { p_undo: { token: v.undo.token } as Json });
  if (error) {
    // Back on that day another way meanwhile: the plain "already on" line, whatever the kinds.
    const r = plannerFailed("restoreEntry", error, { name: v.dishName, day: v.undo.day, mine: "day" }, "Couldn’t undo. Try again.");
    return r.ok ? r : { ...r, gone: r.gone || error.code === UNIQUE_VIOLATION };
  }
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return { ok: true };
}

export type CopyResult = {
  copied: number;
  archived: string[];
  outside_hours: { name: string; from: string; until: string }[];
  /** The copied dishes that had a one-day price, with the price each has now; kept is Q1 C's answer. */
  prices: { kept: boolean; dishes: { name: string; price: number }[] };
};

/** "Copy Monday · 3" / "Copy last Tuesday · 5": the result is the note in the day. */
export async function copyDay(input: { from: string; to: string }): Promise<PlannerResult> {
  const parsed = z.object({ from: isoDay, to: isoDay }).safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  const { data, error } = await supabase.rpc("copy_menu_day", { p_from: parsed.data.from, p_to: parsed.data.to });
  if (error) {
    console.error("[action] copyDay failed:", error.code ?? "", error.message);
    const refused = refusal(error);
    if (refused) return { ok: false, error: refused, field: "form", stale: true };
    return { ok: false, error: `Couldn’t copy ${weekdayName(parsed.data.from)}. Nothing was added. Try again.`, field: "form" };
  }
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return { ok: true, copy: data as CopyResult };
}

/** The panel's "Sold out today" switch. */
export async function setEntrySoldOut(input: { entryId: string; dishName: string; soldOut: boolean }): Promise<PlannerResult> {
  const parsed = z.object({ entryId: uuid, dishName: z.string().max(200), soldOut: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: STALE_FORM!.error, field: "form" };
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error, field: "form" };
  const { error } = await supabase.rpc("set_entry_sold_out", { p_entry: parsed.data.entryId, p_sold_out: parsed.data.soldOut });
  if (error) return plannerFailed("setEntrySoldOut", error, { name: parsed.data.dishName, day: null, mine: "day" }, "Couldn’t change sold out. Try again.");
  revalidatePath("/dashboard/menu");
  revalidatePath("/");
  return { ok: true };
}

/** A new dish's "add to the menu" (dish form): the day, or that day to Sunday on its open days. */
async function addNewDishToMenu(
  supabase: Db,
  dishId: string,
  dishName: string,
  day: string,
  kind: Enums<"entry_kind">,
  opts: { plates: number | null; from: string; until: string },
): Promise<ActionResult> {
  let days = [day];
  if (kind === "week") {
    const { data: hours, error } = await supabase.from("opening_hours").select("weekday, is_open");
    if (error) return failed("addNewDishToMenu hours", error, "Saved the dish, but couldn’t add it to the menu. Add it from the planner.");
    const closed = new Set(hours.filter((h) => !h.is_open).map((h) => h.weekday));
    const sunday = addDays(weekStart(day), 6);
    days = [];
    for (let d = day; d <= sunday; d = addDays(d, 1)) if (!closed.has(dow(d))) days.push(d);
  }
  const { error } = await supabase.rpc("add_menu_entry", {
    p_dish: dishId,
    p_kind: kind,
    p_days: days,
    p_from: opts.from,
    p_until: opts.until,
    p_plates: opts.plates,
    p_price: null,
  });
  if (!error) return null;
  const r = plannerFailed("addNewDishToMenu", error, { name: dishName, day, mine: kind }, "Saved the dish, but couldn’t add it to the menu. Add it from the planner.");
  return r.ok ? null : { error: r.error, stale: r.stale };
}

// ───────── regular menu ─────────

/** On sale today (spec-2.2): off stores today's date, so the dish is back tomorrow with no job running. */
export async function setOnSaleToday(dishId: string, onSale: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(dishId).success || typeof onSale !== "boolean") return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.rpc("set_regular_on_sale", { p_dish: dishId, p_on_sale: onSale });
  if (error?.code === "P0001") return failed("setOnSaleToday", error, error.message);
  if (error) return failed("setOnSaleToday", error, "Couldn’t change it. Try again.");
  revalidatePath("/dashboard/manage");
  revalidatePath("/");
  return null;
}

/** Slice 2.6 (Q3 B): a choice or extra out for today, for anyone on the team. Saved at once. */
export async function setOptionOut(
  optionId: string,
  out: boolean,
): Promise<{ error: string; stale?: boolean } | { out: boolean; allChoicesOut: boolean }> {
  if (!uuid.safeParse(optionId).success || typeof out !== "boolean") return STALE_FORM!;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied!;
  const { data, error } = await supabase.rpc("set_option_out", { p_option: optionId, p_out: out });
  if (error?.code === "P0001") return { error: error.message };
  if (error) return failed("setOptionOut", error, "Couldn’t change it. Try again.")!;
  const done = z.object({ out: z.boolean(), all_choices_out: z.boolean() }).safeParse(data);
  if (!done.success) return failed("setOptionOut result", { message: done.error.message }, "Couldn’t tell whether it changed. Refresh the page to check.")!;
  revalidatePath("/");
  return { out: done.data.out, allChoicesOut: done.data.all_choices_out };
}

// ───────── orders ─────────

/**
 * The order RPCs refuse a stale or invalid move with P0001 and a message written for staff
 * (e.g. "Someone else already moved this order"). Return it with the order as it is now, so the
 * board's strip can say where the order went: the refresh remounts the ticket's form, which
 * can't show it. Anything else is an unexpected failure with a generic retry message.
 */
async function orderRefused(
  supabase: Db,
  refusal: Pick<OrderRefusal, "orderId" | "kind" | "from">,
  what: string,
  error: { message: string; code?: string },
  message: string,
): Promise<ActionResult> {
  if (error.code !== "P0001") return failed(what, error, message);
  const { data, error: readError } = await supabase
    .from("orders")
    .select("code, customer_name, status, payment_status")
    .eq("id", refusal.orderId)
    .maybeSingle();
  // Without the current state the strip falls back to the database's own message.
  if (readError) console.error(`[action] ${what} refusal read failed:`, readError.code ?? "", readError.message);
  return {
    error: error.message,
    refused: {
      ...refusal,
      code: data?.code ?? null,
      customerName: data?.customer_name ?? null,
      status: data?.status ?? null,
      paymentStatus: data?.payment_status ?? null,
    },
  };
}

const OPEN_STATUS = z.enum(["new", "preparing", "ready", "on_the_way"]);
const MODE = z.enum(["dine_in", "pickup", "delivery"]);

export async function advanceOrder(_prev: ActionResult, formData: FormData): Promise<BoardResult> {
  const parsed = z.object({ orderId: uuid, from: OPEN_STATUS, mode: MODE }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const v = parsed.data;
  // The order type only picks the button's step; the database checks it again (guard_order_status).
  const to = nextStatus(v.from, v.mode);
  if (!to) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  // advance_order checks the current status, so two tablets tapping at once can't skip a step.
  const { data, error } = await supabase.rpc("advance_order", { p_order: v.orderId, p_from: v.from, p_to: to });
  revalidatePath("/dashboard/orders");
  if (error) return orderRefused(supabase, { orderId: v.orderId, kind: "advance", from: v.from }, "advanceOrder", error, "Couldn’t move the order. Try again.");
  return { version: data };
}

/**
 * The strip's Undo (5 s on the tablet; the server allows 10 s). `version` is what the move
 * returned: the database refuses the Undo if anything changed the order since (QA RQA24-01).
 */
export async function undoOrderMove(orderId: string, status: Enums<"order_status">, version: number): Promise<ActionResult> {
  const parsed = z
    .object({ orderId: uuid, status: z.enum(["preparing", "ready", "on_the_way", "completed"]), version: z.number().int() })
    .safeParse({ orderId, status, version });
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.rpc("undo_order_move", { p_order: orderId, p_status: parsed.data.status, p_version: parsed.data.version });
  revalidatePath("/dashboard/orders");
  if (error) return orderRefused(supabase, { orderId, kind: "undo", from: parsed.data.status }, "undoOrderMove", error, "Couldn’t undo. Try again.");
  return null;
}

export async function markPaid(_prev: ActionResult, formData: FormData): Promise<BoardResult> {
  const parsed = z.object({ orderId: uuid, with: z.enum(["cash", "mpesa"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data, error } = await supabase.rpc("mark_order_paid", { p_order: parsed.data.orderId, p_with: parsed.data.with });
  revalidatePath("/dashboard/orders");
  // mark_order_paid never refuses a stale tap (paying twice is harmless), so there is nothing for
  // the board's strip; its only P0001 is "Order not found", shown under the button.
  if (error) return error.code === "P0001" ? { error: error.message } : failed("markPaid", error, "Couldn’t mark it paid. Try again.");
  // null: it was already paid, so this tap changed nothing and has no Undo.
  return { version: data };
}

/** Mark paid's in-place Undo. Refused after 10 s, or if anything changed the order since (RQA24-01). */
export async function unmarkPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ orderId: uuid, version: z.coerce.number().int() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.rpc("unmark_order_paid", { p_order: parsed.data.orderId, p_version: parsed.data.version });
  revalidatePath("/dashboard/orders");
  if (error) return orderRefused(supabase, { orderId: parsed.data.orderId, kind: "unpaid", from: null }, "unmarkPaid", error, "Couldn’t undo. Try again.");
  return null;
}

const cancelForm = z
  .object({
    orderId: uuid,
    from: OPEN_STATUS,
    reason: z.enum(["sold_out", "too_busy", "cant_deliver", "customer_asked", "no_show", "other"]),
    note: z.string().trim().max(NOTE_MAX).optional(),
  })
  .refine((v) => v.reason !== "other" || (v.note?.length ?? 0) >= NOTE_MIN, { path: ["note"] });

/** Decline (in New) or Cancel order (after Accept), with a reason the customer sees. No undo. */
export async function cancelOrder(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = cancelForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // The form checks these first; this is for a request that skipped it.
    return parsed.error.issues.some((i) => i.path[0] === "note") ? { error: "Say why in a few words." } : STALE_FORM;
  }
  const v = parsed.data;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  // cancel_order checks the status the tap saw, so a Decline can't cancel an order another tablet moved on.
  const { error } = await supabase.rpc("cancel_order", {
    p_order: v.orderId,
    p_from: v.from,
    p_reason: v.reason,
    p_note: v.reason === "other" ? (v.note ?? null) : null,
  });
  revalidatePath("/dashboard/orders");
  const what = v.from === "new" ? "decline" : "cancel";
  if (error) return orderRefused(supabase, { orderId: v.orderId, kind: "cancel", from: v.from }, "cancelOrder", error, `Couldn’t ${what} the order. Try again.`);
  return null;
}

// ───────── removing dishes ─────────

/** On the everyday menu, or off it (the Everyday menu job, spec-2.3), from the dish editor's switch. */
export async function setEveryday(dishId: string, on: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(dishId).success || typeof on !== "boolean") return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data, error } = await supabase.from("dishes").update({ is_regular: on }).eq("id", dishId).select("id");
  if (error) return failed("setEveryday", error, "Couldn’t change it. Try again.");
  if (data.length === 0) return { error: "This dish no longer exists. Refresh the page." };
  revalidatePath("/dashboard/manage");
  revalidatePath("/dashboard/menu");
  revalidatePath(`/dashboard/dishes/${dishId}`);
  revalidatePath("/");
  return null;
}

/** Whether Delete will archive (past orders) or remove for good, so the confirmation's words are right. */
export async function dishHasOrders(dishId: string): Promise<{ error: string; stale?: boolean } | { hasOrders: boolean }> {
  if (!uuid.safeParse(dishId).success) return STALE_FORM!;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied!;
  const { data, error } = await supabase.rpc("dish_has_orders", { p_dish: dishId });
  if (error || typeof data !== "boolean") return failed("dishHasOrders", error, "Couldn’t check the dish. Try again.")!;
  return { hasOrders: data };
}

const deleteResult = z.object({
  result: z.enum(["deleted", "archived", "missing"]),
  photo_key: z.string().nullable().optional(),
});

/**
 * Deletes a dish everywhere, in one database transaction (delete_dish). A dish that was never
 * ordered is removed for good (with its photo); one with past orders is archived instead so
 * receipts and sales history stay intact. Either way it leaves the menu, the planner and the library.
 * Any failure changes nothing, so the message can say so. Afterwards Dishes says which it was.
 */
export async function deleteDish(dishId: string, name: string, regular: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(dishId).success) return STALE_FORM;
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
  const q = new URLSearchParams({ done: done.data.result, dish: dishId, name: name.slice(0, 80) });
  if (!regular) q.set("view", "all");
  redirect(`/dashboard/manage?${q}`);
}

/** Slice 2.6: an archived dish back in the dish list, on no menu (restore_dish). */
export async function restoreDish(dishId: string): Promise<{ error: string; stale?: boolean } | { name: string }> {
  if (!uuid.safeParse(dishId).success) return STALE_FORM!;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied!;
  const { data, error } = await supabase.rpc("restore_dish", { p_dish: dishId });
  if (error) return failed("restoreDish", error, "Couldn’t restore the dish. Try again.")!;
  const done = z.object({ result: z.enum(["restored", "missing"]), name: z.string().nullable() }).safeParse(data);
  if (!done.success) return failed("restoreDish result", { message: done.error.message }, "Couldn’t tell whether it was restored. Refresh the page to check.")!;
  if (done.data.result === "missing") return { error: "That dish isn’t archived any more. Refresh the page." };
  revalidatePath("/dashboard/manage");
  revalidatePath("/dashboard/menu");
  return { name: done.data.name ?? "The dish" };
}

// ───────── planner panel: the dish library ─────────

export type LibraryDish = {
  id: string;
  name: string;
  price: number;
  photo: string | null;
  lastServedOn: string | null;
  /** The first day from..until it's already on (by any entry, days off counted), or null. */
  onDay: string | null;
  last: { from: string; until: string; plates: number | null } | null;
};

/** The panel's dish list: up to 8, most recently served first, not archived, not everyday dishes. */
export async function searchDishes(input: { q: string; from: string; until: string }): Promise<{ ok: true; dishes: LibraryDish[] } | { ok: false }> {
  const parsed = z.object({ q: z.string().max(80), from: isoDay, until: isoDay }).safeParse(input);
  if (!parsed.success) return { ok: false };
  const { q, from, until } = parsed.data;
  const [supabase] = await staffClient();
  if (!supabase) return { ok: false };
  let query = supabase
    .from("dishes")
    .select("id, name, price_kes, photo_thumb_url, last_served_on")
    .eq("archived", false)
    .eq("is_regular", false)
    .order("last_served_on", { ascending: false, nullsFirst: false })
    .order("name")
    .limit(8);
  // ilike wildcards in what was typed are matched literally.
  const term = q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (term) query = query.ilike("name", `%${term}%`);
  const { data: dishes, error } = await query;
  if (error) {
    console.error("[action] searchDishes failed:", error.code ?? "", error.message);
    return { ok: false };
  }
  if (dishes.length === 0) return { ok: true, dishes: [] };
  const ids = dishes.map((d) => d.id);
  const { data: entries, error: entriesError } = await supabase
    .from("menu_entries")
    .select("id, dish_id, starts_on, ends_on, published, ended_early_at, plates_per_day, show_from, show_until, off:menu_entry_off_days(day)")
    .in("dish_id", ids)
    .order("starts_on", { ascending: false });
  if (entriesError) {
    console.error("[action] searchDishes entries failed:", entriesError.code ?? "", entriesError.message);
    return { ok: false };
  }
  return {
    ok: true,
    dishes: dishes.map((d) => {
      const mine = entries.filter((e) => e.dish_id === d.id);
      let onDay: string | null = null;
      for (let day = from; day <= until && !onDay; day = addDays(day, 1)) {
        const live = mine.some(
          (e) => e.published && !e.ended_early_at && e.starts_on <= day && day <= e.ends_on && !e.off.some((o) => o.day === day),
        );
        if (live) onDay = day;
      }
      const last = mine[0];
      return {
        id: d.id,
        name: d.name,
        price: d.price_kes,
        photo: d.photo_thumb_url,
        lastServedOn: d.last_served_on,
        onDay,
        last: last ? { from: last.show_from, until: last.show_until, plates: last.plates_per_day } : null,
      };
    }),
  };
}

// ── Slice 2.9: table requests on the board. Everyone on the team may clear them (no grant); the
// database checks staff. Reads come from the browser's own poll, so these only write.

/** What a table-request write returns: ok, or the line for the bottom strip. */
export type RequestResult = { ok: true } | { ok: false; error: string };
const REQUEST_FAILED = "Couldn’t save. Try again.";

/** Done: clears the request for everyone. Already cleared (someone else was first) is still ok. */
export async function clearTableRequest(id: string): Promise<RequestResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: STALE_FORM!.error };
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error };
  const { error } = await supabase.rpc("clear_table_request", { p_id: id });
  if (error) {
    console.error("[action] clearTableRequest failed:", error.code ?? "", error.message);
    return { ok: false, error: REQUEST_FAILED };
  }
  return { ok: true };
}

/** Done's Undo: 10 s on the server (5 s on the tablet), only by whoever cleared it. */
export async function undoClearTableRequest(id: string, table: string): Promise<RequestResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: STALE_FORM!.error };
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error };
  const { error } = await supabase.rpc("undo_clear_table_request", { p_id: id });
  if (!error) return { ok: true };
  if (error.code === "P0001" && error.message === "asked_again") return { ok: false, error: `${table} asked again. That’s the request on the board now.` };
  if (error.code === "P0001") return { ok: false, error: `Too late to undo. ${table}’s call stays done.` };
  console.error("[action] undoClearTableRequest failed:", error.code ?? "", error.message);
  return { ok: false, error: "Couldn’t undo. Try again." };
}

const paidItems = z.array(z.object({ id: uuid, version: z.number().int() }));
export type PaidAll = { ok: true; items: { id: string; version: number }[] } | { ok: false; error: string };

/**
 * Mark all paid on a bill: 2.12's mark_order_paid for each, all with the one method chosen, and one
 * Undo for the ones it changed. A split bill is marked order by order instead (RW2B-02).
 */
export async function markAllPaid(ids: string[], paidWith: "cash" | "mpesa"): Promise<PaidAll> {
  if (!z.array(uuid).min(1).max(50).safeParse(ids).success || !z.enum(["cash", "mpesa"]).safeParse(paidWith).success) {
    return { ok: false, error: STALE_FORM!.error };
  }
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error };
  const { data, error } = await supabase.rpc("mark_orders_paid", { p_ids: ids, p_with: paidWith });
  revalidatePath("/dashboard/orders");
  if (error) {
    // One refusal marks none (one transaction); say which order when the database names it.
    if (error.code === "P0001" && /was cancelled/.test(error.message)) return { ok: false, error: `${error.message} Nothing has changed.` };
    console.error("[action] markAllPaid failed:", error.code ?? "", error.message);
    return { ok: false, error: "Couldn’t mark them paid. Nothing has changed. Try again." };
  }
  const items = paidItems.safeParse(data);
  return items.success ? { ok: true, items: items.data } : { ok: true, items: [] };
}

/** Mark all paid's Undo: all of them or none (unmark_orders_paid). */
export async function unmarkAllPaid(items: { id: string; version: number }[]): Promise<RequestResult> {
  if (!paidItems.min(1).max(50).safeParse(items).success) return { ok: false, error: STALE_FORM!.error };
  const [supabase, denied] = await staffClient();
  if (!supabase) return { ok: false, error: denied!.error };
  const { error } = await supabase.rpc("unmark_orders_paid", { p_items: items as unknown as Json });
  revalidatePath("/dashboard/orders");
  if (!error) return { ok: true };
  if (error.code === "P0001") return { ok: false, error: `Too late to undo. ${items.length === 1 ? "The order stays" : "They stay"} marked paid.` };
  console.error("[action] unmarkAllPaid failed:", error.code ?? "", error.message);
  return { ok: false, error: "Couldn’t undo. Try again." };
}
