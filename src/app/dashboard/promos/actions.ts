"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OWNER_ONLY } from "@/lib/permissions";
import { AD_LIMITS, PRICE_KEPT, PRICE_NEEDED, parseAdLink, parseAdPrice, type AdAction } from "@/lib/promos";
import { PHOTO_KEY, photoExists, publicPhotoUrl } from "@/lib/r2";
import { refusal } from "@/lib/supabase/refusal";
import { createClient, getStaff } from "@/lib/supabase/server";

// Slice 2.11 A: the Promos screen's actions. Each checks the caller is the owner here, and the
// database checks again (RLS, the ads guard, ad_action). Approval, pausing and ending only go
// through ad_action, which locks the space so two approvals can't both take it.

export type AdField = "advertiser" | "line" | "place" | "link_label" | "link" | "dates" | "price" | "logo" | "form";
export type AdResult =
  | { ok: true; id: string; status?: string }
  | { ok: false; error: string; field?: AdField; id?: string; stale?: boolean; gone?: boolean };
export type PromoResult = { ok: true } | { ok: false; error: string; stale?: boolean; gone?: boolean };

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string; details?: string; hint?: string } | null;

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SIGNED_OUT = "You’re signed out. Sign in again and retry.";

async function ownerClient(): Promise<Db | { ok: false; error: string; stale?: boolean }> {
  let me;
  try {
    me = await getStaff();
  } catch {
    return { ok: false, error: "Couldn’t check you’re signed in. Try again." };
  }
  if (!me) return { ok: false, error: SIGNED_OUT };
  if (me.role !== "owner") return { ok: false, error: OWNER_ONLY.owner, stale: true };
  return createClient();
}
const isFail = (x: unknown): x is { ok: false; error: string; stale?: boolean } =>
  typeof x === "object" && x !== null && "ok" in x && (x as { ok: unknown }).ok === false;

/** The database's own line (P0001: overlap, state, ended), a refusal, or `message`. */
function failed(what: string, error: DbError, message: string): { ok: false; error: string; stale?: boolean; gone?: boolean } {
  console.error(`[action] promos ${what} failed:`, error?.code ?? "", error?.message ?? "");
  const refused = refusal(error);
  if (refused) return { ok: false, error: refused, stale: true };
  if (error?.code === "P0001") return { ok: false, error: error.message, gone: error.details === "ad_missing" || error.details === "combo_missing" };
  return { ok: false, error: message };
}

/** An approved ad's price was cleared: the ads_price_when_approved check. */
const priceGone = (error: DbError) => error?.code === "23514" && (error.message ?? "").includes("ads_price_when_approved");

const done = () => {
  revalidatePath("/dashboard/promos");
  revalidatePath("/");
};

const text = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(min).max(max));

const adForm = z.object({
  id: uuid.optional().or(z.literal("")),
  advertiser: z.string(),
  line: z.string(),
  place: z.string().optional().default(""),
  link_label: z.string(),
  link: z.string(),
  space: z.enum(["menu", "order"]),
  starts_on: z.string(),
  ends_on: z.string(),
  price_kes: z.string().optional().default(""),
  logo_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  logo_thumb_key: z.string().regex(PHOTO_KEY).optional().or(z.literal("")),
  remove_logo: z.literal("on").optional(),
  intent: z.enum(["save", "approve"]).default("save"),
});

/** Field by field, in form order, so the first problem is the one shown. */
function checkFields(v: z.infer<typeof adForm>):
  | { ok: true; row: { advertiser: string; line: string; place: string; link_label: string; link_url: string; space: "menu" | "order"; starts_on: string; ends_on: string; price_kes: number | null } }
  | { ok: false; error: string; field: AdField } {
  const advertiser = text(AD_LIMITS.advertiser).safeParse(v.advertiser);
  if (!advertiser.success) return { ok: false, field: "advertiser", error: v.advertiser.trim() ? `Keep the name to ${AD_LIMITS.advertiser} characters.` : "Add the advertiser’s name." };
  const line = text(AD_LIMITS.line).safeParse(v.line);
  if (!line.success) return { ok: false, field: "line", error: v.line.trim() ? `Keep the line to ${AD_LIMITS.line} characters.` : "Add one line about them." };
  const place = text(AD_LIMITS.place, 0).safeParse(v.place);
  if (!place.success) return { ok: false, field: "place", error: `Keep the place to ${AD_LIMITS.place} characters.` };
  const label = text(AD_LIMITS.linkLabel).safeParse(v.link_label);
  if (!label.success) return { ok: false, field: "link_label", error: v.link_label.trim() ? `Keep the link label to ${AD_LIMITS.linkLabel} characters.` : "Add the words for the link, like “See today’s bread”." };
  const link = parseAdLink(v.link);
  if (!link.ok) return { ok: false, field: "link", error: link.error };
  if (!day.safeParse(v.starts_on).success || !day.safeParse(v.ends_on).success) return { ok: false, field: "dates", error: "Pick a start and an end date." };
  if (v.ends_on < v.starts_on) return { ok: false, field: "dates", error: "The end date is before the start date." };
  const price = parseAdPrice(v.price_kes);
  if (!price.ok) return { ok: false, field: "price", error: price.error };
  // A draft may wait for its price; approving needs one (0 for free). The database refuses too.
  if (v.intent === "approve" && price.value === null) return { ok: false, field: "price", error: PRICE_NEEDED };
  return {
    ok: true,
    row: {
      advertiser: advertiser.data,
      line: line.data,
      place: place.data,
      link_label: label.data,
      link_url: link.value,
      space: v.space,
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      price_kes: price.value,
    },
  };
}

/** New ad or edit; with intent "approve" the saved draft is then approved (after the page's confirm). */
export async function saveAd(_prev: AdResult | null, formData: FormData): Promise<AdResult> {
  const db = await ownerClient();
  if (isFail(db)) return db;
  const parsed = adForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, field: "form", error: "Something didn’t match. Refresh the page and try again." };
  const v = parsed.data;
  const checked = checkFields(v);
  if (!checked.ok) return checked;
  const row: typeof checked.row & { logo_key?: string | null; logo_url?: string | null } = { ...checked.row };

  // A new logo: both files must really be in storage before the ad points at them.
  if (v.logo_key && v.logo_thumb_key) {
    try {
      const sameSet = v.logo_key.split("/")[1] === v.logo_thumb_key.split("/")[1];
      const [full, thumb] = await Promise.all([photoExists(v.logo_key), photoExists(v.logo_thumb_key)]);
      if (!sameSet || !full || !thumb) return { ok: false, field: "logo", error: "The logo didn’t finish uploading. Try again." };
      row.logo_key = v.logo_key;
      row.logo_url = publicPhotoUrl(v.logo_thumb_key);
    } catch (e) {
      console.error("[action] promos logo check failed:", e instanceof Error ? e.message : e);
      return { ok: false, field: "logo", error: "Couldn’t check the logo upload. Try again." };
    }
  } else if (v.remove_logo === "on") {
    row.logo_key = null;
    row.logo_url = null;
  }

  let id: string;
  if (v.id) {
    const { data, error } = await db.from("ads").update(row).eq("id", v.id).select("id").maybeSingle();
    // A later end date that runs into another approved ad (R211-01) is the dates' problem.
    if (error && priceGone(error)) return { ok: false, field: "price", error: PRICE_KEPT };
    if (error) return { ...failed("save ad", error, "Couldn’t save the ad. Try again."), field: error.details === "ad_overlap" ? "dates" : "form" };
    if (!data) return { ok: false, error: "This ad isn’t there any more. It may have been deleted.", gone: true };
    id = data.id;
  } else {
    const { data, error } = await db.from("ads").insert(row).select("id").single();
    if (error) return { ...failed("add ad", error, "Couldn’t save the ad. Try again."), field: "form" };
    id = data.id;
  }
  done();
  if (v.intent !== "approve") return { ok: true, id };

  const { data: status, error } = await db.rpc("ad_action", { p_id: id, p_action: "approve" });
  if (error) return { ...failed("approve ad", error, "Saved as a draft, but couldn’t approve it. Try again."), id, field: error.details === "ad_price" ? "price" : "form" };
  done();
  return { ok: true, id, status: status ?? undefined };
}

/** Approve, Pause, Resume or End now, through ad_action (it locks the space and checks overlaps). */
export async function adAction(id: string, action: AdAction): Promise<PromoResult> {
  if (!uuid.safeParse(id).success || !["approve", "pause", "resume", "end"].includes(action)) {
    return { ok: false, error: "Something didn’t match. Refresh the page and try again." };
  }
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { error } = await db.rpc("ad_action", { p_id: id, p_action: action });
  if (error) return failed(`ad ${action}`, error, "Couldn’t change the ad. Try again.");
  done();
  return { ok: true };
}

/**
 * An ended ad's price only (spec-2.11-ad-price: Mama can still correct her invoice figure). The rest
 * of an ended ad is read-only; the price never reaches customers, so the guard lets it change.
 */
export async function saveAdPrice(id: string, input: string): Promise<AdResult> {
  if (!uuid.safeParse(id).success) return { ok: false, field: "form", error: "Something didn’t match. Refresh the page and try again." };
  const price = parseAdPrice(input);
  if (!price.ok) return { ok: false, field: "price", error: price.error };
  // An approved ad's price can't go back to empty: Amount due would lose its figure.
  if (price.value === null) return { ok: false, field: "price", error: PRICE_KEPT };
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { data, error } = await db.from("ads").update({ price_kes: price.value }).eq("id", id).select("id").maybeSingle();
  if (error) return { ...failed("save ad price", error, "Couldn’t save the price. Try again."), field: "form" };
  if (!data) return { ok: false, error: "This ad isn’t there any more. It may have been deleted.", gone: true };
  done();
  return { ok: true, id: data.id };
}

/** Drafts only (RLS and the guard: an approved or shown ad is ended, never deleted). */
export async function deleteAd(id: string): Promise<PromoResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Something didn’t match. Refresh the page and try again." };
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { data, error } = await db.from("ads").delete().eq("id", id).select("id");
  if (error) return failed("delete ad", error, "Couldn’t delete the draft. Try again.");
  if (!data || data.length === 0) {
    return { ok: false, error: "This draft couldn’t be deleted. It may have been approved or already deleted. Refresh to see it.", gone: true };
  }
  done();
  return { ok: true };
}

/** Mark or unmark a dish as Mama's pick. */
export async function setPick(dishId: string, on: boolean): Promise<PromoResult> {
  if (!uuid.safeParse(dishId).success) return { ok: false, error: "Something didn’t match. Refresh the page and try again." };
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { data, error } = await db.from("dishes").update({ is_pick: on }).eq("id", dishId).select("id").maybeSingle();
  if (error) return failed("pick", error, on ? "Couldn’t add the pick. Try again." : "Couldn’t remove the pick. Try again.");
  if (!data) return { ok: false, error: "That dish isn’t there any more.", gone: true };
  done();
  return { ok: true };
}

// ── Combos (2.11 B). save_combo checks everything again: owner, 2–4 dishes, priced below everyday.

export type ComboField = "name" | "items" | "price" | "form";
export type ComboResult = { ok: true; id: string } | { ok: false; error: string; field?: ComboField; stale?: boolean; gone?: boolean };

const comboInput = z.object({
  id: uuid.nullable(),
  name: text(40),
  price_kes: z.number().int().min(1).max(99999),
  items: z.array(z.object({ dish_id: uuid, quantity: z.number().int().min(1).max(4) })).max(4),
});

const COMBO_FIELD: Record<string, ComboField> = {
  combo_name: "name",
  combo_items: "items",
  combo_dish: "items",
  combo_price: "price",
  combo_no_saving: "price",
};

export async function saveCombo(input: { id: string | null; name: string; price_kes: number; items: { dish_id: string; quantity: number }[] }): Promise<ComboResult> {
  const parsed = comboInput.safeParse(input);
  if (!parsed.success) {
    const path = String(parsed.error.issues[0]?.path[0] ?? "");
    if (path === "name") return { ok: false, field: "name", error: "Give the combo a name of up to 40 characters." };
    if (path === "price_kes") return { ok: false, field: "price", error: "Enter a price in shillings." };
    if (path === "items") return { ok: false, field: "items", error: "A combo has 2 to 4 dishes in total." };
    return { ok: false, field: "form", error: "Something didn’t match. Refresh the page and try again." };
  }
  const total = parsed.data.items.reduce((n, i) => n + i.quantity, 0);
  if (total < 2 || total > 4) return { ok: false, field: "items", error: "A combo has 2 to 4 dishes in total." };
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { data, error } = await db.rpc("save_combo", { p: parsed.data });
  if (error) {
    const r = failed("combo save", error, "Couldn’t save the combo. Try again.");
    return { ...r, field: COMBO_FIELD[error.details ?? ""] ?? "form" };
  }
  done();
  return { ok: true, id: data };
}

export async function comboAction(id: string, action: "on" | "off" | "archive"): Promise<PromoResult> {
  if (!uuid.safeParse(id).success || !["on", "off", "archive"].includes(action)) {
    return { ok: false, error: "Something didn’t match. Refresh the page and try again." };
  }
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { error } = await db.rpc("combo_action", { p_id: id, p_action: action });
  if (error) {
    const what = action === "archive" ? "archive the combo" : action === "on" ? "switch the combo on" : "switch the combo off";
    return failed(`combo ${action}`, error, `Couldn’t ${what}. Try again.`);
  }
  done();
  return { ok: true };
}

// ── Discount codes (2.11 C). Writes only through save_discount_code and discount_code_action.

export type CodeField = "code" | "value" | "cap" | "dates" | "max_uses" | "min_order" | "modes" | "form";
export type CodeResult = { ok: true; id: string } | { ok: false; error: string; field: CodeField; stale?: boolean; gone?: boolean };

const CODE_FIELD: Record<string, CodeField> = {
  code_code: "code",
  code_taken: "code",
  code_value: "value",
  code_used: "value",
  code_cap: "cap",
  code_dates: "dates",
  code_max_uses: "max_uses",
  code_min_order: "min_order",
  code_modes: "modes",
};

const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const codeInput = z.object({
  id: uuid.nullable(),
  code: z.string().regex(/^[A-Z0-9]{3,20}$/),
  kind: z.enum(["percent", "amount"]),
  value: whole(1, 5000),
  cap_kes: whole(1, 99999).nullable(),
  starts_on: day,
  ends_on: day,
  max_uses: whole(1, 100000).nullable(),
  once_per_phone: z.boolean(),
  min_order_kes: whole(1, 999999).nullable(),
  modes: z.array(z.enum(["dine_in", "pickup", "delivery"])).min(1).max(3),
});
export type CodeInput = z.input<typeof codeInput>;

const CODE_PATH_FIELD: Record<string, [CodeField, string]> = {
  code: ["code", "A code is 3 to 20 letters and numbers."],
  kind: ["value", "Pick what the code gives."],
  value: ["value", "Enter the amount as a whole number."],
  cap_kes: ["cap", "Enter the most one order can save, in shillings."],
  starts_on: ["dates", "Pick the dates again."],
  ends_on: ["dates", "Pick an end date."],
  max_uses: ["max_uses", "Total uses is a number from 1."],
  min_order_kes: ["min_order", "Enter the minimum in shillings."],
  modes: ["modes", "Pick at least one order type."],
};

export async function saveCode(input: CodeInput): Promise<CodeResult> {
  const parsed = codeInput.safeParse({ ...input, code: String(input.code ?? "").trim().toUpperCase() });
  if (!parsed.success) {
    const [field, error] = CODE_PATH_FIELD[String(parsed.error.issues[0]?.path[0] ?? "")] ?? ["form", "Something didn’t match. Refresh the page and try again."];
    return { ok: false, field, error };
  }
  const db = await ownerClient();
  if (isFail(db)) return { ...db, field: "form" };
  const { data, error } = await db.rpc("save_discount_code", { p: parsed.data });
  if (error) {
    const r = failed("code save", error, "Couldn’t save the code. Try again.");
    return { ...r, gone: error.details === "code_missing", field: CODE_FIELD[error.details ?? ""] ?? "form" };
  }
  done();
  return { ok: true, id: data };
}

export async function codeAction(id: string, action: "on" | "off"): Promise<PromoResult> {
  if (!uuid.safeParse(id).success || !["on", "off"].includes(action)) {
    return { ok: false, error: "Something didn’t match. Refresh the page and try again." };
  }
  const db = await ownerClient();
  if (isFail(db)) return db;
  const { error } = await db.rpc("discount_code_action", { p_id: id, p_action: action });
  if (error) {
    const r = failed(`code ${action}`, error, `Couldn’t switch the code ${action}. Try again.`);
    return { ...r, gone: r.gone || error.details === "code_missing" };
  }
  done();
  return { ok: true };
}

/** The form's live check: is this code free? `null` when it couldn't check. */
export async function codeIsFree(code: string, exceptId: string | null): Promise<boolean | null> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(c)) return null;
  if (exceptId !== null && !uuid.safeParse(exceptId).success) return null;
  const db = await ownerClient();
  if (isFail(db)) return null;
  let q = db.from("discount_codes").select("id").eq("code", c);
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.limit(1);
  if (error) return null;
  return data.length === 0;
}
