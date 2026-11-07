"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getStaff } from "@/lib/supabase/server";
import type { ActionResult } from "../action-result";

// Form actions return null on success or { error } with a message for the person
// who tapped (shown by ActionForm next to the button). Details go to the server log.

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string } | null;

const STALE_FORM: ActionResult = { error: "Something didn’t match. Refresh the page and try again." };
const UNIQUE_VIOLATION = "23505";

async function staffClient(): Promise<[Db, null] | [null, ActionResult]> {
  try {
    if (!(await getStaff())) return [null, { error: "You’re signed out. Sign in again and retry." }];
  } catch {
    return [null, { error: "Couldn’t check you’re signed in. Try again." }];
  }
  return [await createClient(), null];
}

function failed(what: string, error: DbError, message: string): ActionResult {
  console.error(`[action] ${what} failed:`, error?.code ?? "", error?.message ?? "");
  return { error: message };
}

const done = (): ActionResult => {
  revalidatePath("/dashboard/tables");
  return null;
};

/** Adds tables numbered after the highest existing "Table N", e.g. 6 more after Table 4 → Tables 5–10. */
export async function addTables(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ count: z.coerce.number().int().min(1).max(50) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Add between 1 and 50 tables at a time." };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  // Without the existing labels the numbering would restart at 1, so a failed read stops here.
  const { data, error: readError } = await supabase.from("dining_tables").select("label");
  if (readError) return failed("addTables read", readError, "Couldn’t add tables. Try again.");
  const taken = new Set(data.map((t) => t.label.toLowerCase()));
  const highest = Math.max(0, ...data.map((t) => Number(/^table (\d+)$/i.exec(t.label)?.[1] ?? 0)));
  const rows: { label: string }[] = [];
  for (let n = highest + 1; rows.length < parsed.data.count; n++) {
    if (!taken.has(`table ${n}`)) rows.push({ label: `Table ${n}` });
  }
  const { error } = await supabase.from("dining_tables").insert(rows);
  // 23505: someone added the same numbers a moment ago; the page refresh shows them.
  if (error && error.code !== UNIQUE_VIOLATION) return failed("addTables insert", error, "Couldn’t add tables. Try again.");
  return done();
}

/** A custom-named spot, e.g. "Terrace 1" or "Bar". */
export async function addNamedTable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ label: z.string().trim().min(1).max(40) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Give the spot a name of up to 40 characters." };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("dining_tables").insert({ label: parsed.data.label });
  if (error && error.code !== UNIQUE_VIOLATION) return failed("addNamedTable", error, "Couldn’t add it. Try again.");
  return done();
}

export async function renameTable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(40) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Give the table a name of up to 40 characters." };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase.from("dining_tables").update({ label: parsed.data.label }).eq("id", parsed.data.id);
  if (error?.code === UNIQUE_VIOLATION) return { error: "Another table already has that name." };
  if (error) return failed("renameTable", error, "Couldn’t rename it. Try again.");
  return done();
}

export async function setTableActive(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const on = parsed.data.active === "true";
  const { error } = await supabase.from("dining_tables").update({ active: on }).eq("id", parsed.data.id);
  if (error) return failed("setTableActive", error, on ? "Couldn’t turn it on. Try again." : "Couldn’t turn it off. Try again.");
  return done();
}

/** Issues a new QR code for a table; the old printed code stops working. */
export async function resetTableCode(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return STALE_FORM;
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const qr_token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabase.from("dining_tables").update({ qr_token }).eq("id", parsed.data.id);
  if (error) return failed("resetTableCode", error, "Couldn’t make a new code. The printed one still works. Try again.");
  return done();
}

// ───────── delivery areas ─────────

const fee = z.coerce.number().int().min(0).max(5000);

export async function addZone(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ name: z.string().trim().min(1).max(40), fee_kes: fee }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Name the area and give a fee from 0 to 5,000 KSh." };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { data, error: readError } = await supabase.from("delivery_zones").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  if (readError) return failed("addZone read", readError, "Couldn’t add the area. Try again.");
  const { error } = await supabase.from("delivery_zones").insert({ ...parsed.data, sort_order: (data[0]?.sort_order ?? 0) + 1 });
  if (error && error.code !== UNIQUE_VIOLATION) return failed("addZone insert", error, "Couldn’t add the area. Try again.");
  return done();
}

export async function updateZone(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), fee_kes: fee, active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Give a fee from 0 to 5,000 KSh." };
  const [supabase, denied] = await staffClient();
  if (!supabase) return denied;
  const { error } = await supabase
    .from("delivery_zones")
    .update({ fee_kes: parsed.data.fee_kes, active: parsed.data.active === "true" })
    .eq("id", parsed.data.id);
  if (error) return failed("updateZone", error, "Couldn’t save the area. Try again.");
  return done();
}
