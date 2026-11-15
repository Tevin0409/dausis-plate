"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nairobiToday } from "@/lib/format";
import { googleLinkProblem } from "@/lib/ratings";
import { createClient, getStaff } from "@/lib/supabase/server";
import { refusal } from "@/lib/supabase/refusal";

// Owner settings (spec-2.2). The database is the gate: every write here goes through RLS or an
// RPC that checks public.has_permission(), so a staff session gets refused there too.
// Messages are the spec's; details go to the server log only.

export type SettingsResult = { ok: true; note?: string } | { ok: false; error: string; stale?: boolean } | null;

type Db = Awaited<ReturnType<typeof createClient>>;

async function ownerClient(): Promise<Db | null> {
  try {
    const staff = await getStaff();
    return staff?.role === "owner" ? await createClient() : null;
  } catch {
    return null;
  }
}

/** A client for anyone on the staff list. Close early is open to its grant holders (spec-2.3); the
 *  RPC itself checks, so a stale page gets the database's refusal line rather than a vague failure. */
async function staffClient(): Promise<Db | null> {
  try {
    return (await getStaff()) ? await createClient() : null;
  } catch {
    return null;
  }
}

/** A refusal (42501) carries its own line and asks the page to refresh. */
function refused(what: string, error: { code?: string; message: string }): SettingsResult | null {
  const line = refusal(error);
  if (!line) return null;
  console.error(`[action] ${what} refused:`, error.message);
  return { ok: false, error: line, stale: true };
}

function fail(what: string, error: { code?: string; message: string } | null, message: string): SettingsResult {
  console.error(`[action] ${what} failed:`, error?.code ?? "", error?.message ?? "not the owner");
  return { ok: false, error: message };
}

/** Every Settings change shows on the menu, checkout and every dashboard screen at once. */
function refreshEverywhere() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/", "layout");
}

// ───────── close early ─────────

export async function closeEarly(): Promise<SettingsResult> {
  const message = "Couldn’t close. Customers can still order. Try again.";
  const db = await staffClient();
  if (!db) return fail("closeEarly", null, message);
  const { error } = await db.rpc("close_early");
  if (error) return refused("closeEarly", error) ?? fail("closeEarly", error, error.code === "P0001" ? error.message : message);
  refreshEverywhere();
  return { ok: true };
}

export async function reopenToday(): Promise<SettingsResult> {
  const message = "Couldn’t reopen. Customers still see closed. Try again.";
  const db = await staffClient();
  if (!db) return fail("reopenToday", null, message);
  const { error } = await db.rpc("reopen_today");
  if (error) return refused("reopenToday", error) ?? fail("reopenToday", error, message);
  refreshEverywhere();
  return { ok: true };
}

// ───────── weekly hours ─────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const week = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), is_open: z.boolean(), opens: hhmm, closes: hhmm }))
  .length(7);

export async function saveHours(days: unknown, lastOrders: unknown): Promise<SettingsResult> {
  const message = "Couldn’t save. Your hours haven’t changed. Try again.";
  const parsed = z.object({ days: week, lastOrders: z.union([z.literal(0), z.literal(15), z.literal(30)]) }).safeParse({ days, lastOrders });
  if (!parsed.success) return fail("saveHours parse", { message: parsed.error.message }, message);
  const db = await ownerClient();
  if (!db) return fail("saveHours", null, message);
  // A closing of 00:00 in the form is midnight: stored as 24:00, the end of that day (2A).
  const p_days = parsed.data.days.map((d) => ({ ...d, closes: d.closes === "00:00" ? "24:00" : d.closes }));
  const { error } = await db.rpc("save_opening_hours", { p_days, p_last_orders_minutes: parsed.data.lastOrders });
  if (error) return fail("saveHours", error, error.code === "P0001" ? error.message : message);
  refreshEverywhere();
  return { ok: true };
}

// ───────── closed dates ─────────

const ADD_FAILED = "Couldn’t save that. Try again.";

export async function addClosedDate(day: string, note: string): Promise<SettingsResult> {
  const parsed = z
    .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(120) })
    .safeParse({ day, note });
  if (!parsed.success) return { ok: false, error: "Pick a date from tomorrow on." };
  // Nairobi's date on the server, so a page left open past midnight still compares with the right day.
  const today = nairobiToday();
  if (parsed.data.day === today) return { ok: false, error: "For today, use Close early." };
  if (parsed.data.day < today) return { ok: false, error: "Pick a date from tomorrow on." };

  const db = await ownerClient();
  if (!db) return fail("addClosedDate", null, ADD_FAILED);
  const { error } = await db.from("closed_dates").insert({ day: parsed.data.day, note: parsed.data.note || null });
  if (error?.code === "23505") return { ok: false, error: "That date is already closed." };
  if (error) return fail("addClosedDate", error, ADD_FAILED);

  // spec-2.2: say if dishes are planned that day. They stay in the planner; customers won't see them.
  const { count } = await db
    .from("menu_entries")
    .select("id", { count: "exact", head: true })
    .eq("published", true)
    .is("ended_early_at", null)
    .lte("starts_on", parsed.data.day)
    .gte("ends_on", parsed.data.day);
  refreshEverywhere();
  if (!count) return { ok: true };
  return {
    ok: true,
    note: `${count} ${count === 1 ? "dish is" : "dishes are"} planned that day. They stay in the planner and customers won’t see them.`,
  };
}

export async function removeClosedDate(day: string): Promise<SettingsResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: ADD_FAILED };
  const db = await ownerClient();
  if (!db) return fail("removeClosedDate", null, ADD_FAILED);
  const { error, count } = await db.from("closed_dates").delete({ count: "exact" }).eq("day", day);
  if (error || count === 0) return fail("removeClosedDate", error ?? { message: "nothing deleted" }, ADD_FAILED);
  refreshEverywhere();
  return { ok: true };
}

/** Undo puts the date back with its note. */
export async function restoreClosedDate(day: string, note: string | null): Promise<SettingsResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: ADD_FAILED };
  const db = await ownerClient();
  if (!db) return fail("restoreClosedDate", null, ADD_FAILED);
  const { error } = await db.from("closed_dates").insert({ day, note });
  if (error && error.code !== "23505") return fail("restoreClosedDate", error, ADD_FAILED);
  refreshEverywhere();
  return { ok: true };
}

// ───────── till number ─────────

export async function saveTill(till: string): Promise<SettingsResult> {
  const message = "Couldn’t save. The till number hasn’t changed. Try again.";
  const value = till.trim();
  if (value && !/^[0-9]{5,10}$/.test(value)) return { ok: false, error: "A till number is 5 to 10 digits, with no spaces." };
  const db = await ownerClient();
  if (!db) return fail("saveTill", null, message);
  const { error } = await db.rpc("set_till_number", { p_till: value });
  if (error) return fail("saveTill", error, error.code === "P0001" ? error.message : message);
  refreshEverywhere();
  return { ok: true };
}

// ───────── Google review link (spec-2.10) ─────────

export type GoogleLinkResult = { ok: true; url: string | null } | { ok: false; error: string };

/** Empty clears it, and customers then see no Google button. The database checks https, no spaces and 500. */
export async function saveGoogleReviewUrl(url: string): Promise<GoogleLinkResult> {
  const message = "Couldn’t save. The link hasn’t changed. Try again.";
  const value = url.trim();
  const problem = googleLinkProblem(value);
  if (problem) return { ok: false, error: problem };
  const db = await ownerClient();
  if (!db) {
    fail("saveGoogleReviewUrl", null, message);
    return { ok: false, error: message };
  }
  const { data, error } = await db.rpc("set_google_review_url", { p_url: value });
  if (error) {
    const r = fail("saveGoogleReviewUrl", error, error.code === "P0001" ? error.message : message);
    return { ok: false, error: r && !r.ok ? r.error : message };
  }
  refreshEverywhere();
  return { ok: true, url: data ?? null };
}
