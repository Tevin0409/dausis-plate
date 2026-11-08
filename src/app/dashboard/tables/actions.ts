"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refusal } from "@/lib/supabase/refusal";
import { createClient, getStaff } from "@/lib/supabase/server";
import { TABLE_MESSAGES, ZONE_MESSAGES, nextTableLabels, zoneProblem, type ZoneInput } from "@/lib/tables";
import type { ActionResult } from "../action-result";

// Plain-value actions for the table and zone panels (spec-2.6 "Tables & delivery"). Each returns
// null on success or { error } with the line to show; `stale` marks a refusal for a job the person
// no longer holds, so the page refreshes and the controls go. Details go to the server log.

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

const STALE_FORM: ActionResult = { error: "Something didn’t match. Refresh the page and try again." };
const UNIQUE_VIOLATION = "23505";
const uuid = z.string().uuid();
const label = z.string().trim().min(1).max(40);

async function staffClient(): Promise<[Db, null] | [null, ActionResult]> {
  try {
    if (!(await getStaff())) return [null, { error: "You’re signed out. Sign in again and retry." }];
  } catch {
    return [null, { error: "Couldn’t check you’re signed in. Try again." }];
  }
  return [await createClient(), null];
}

function failed(what: string, error: DbError | null, message: string): ActionResult {
  console.error(`[action] ${what} failed:`, error?.code ?? "", error?.message ?? "");
  const refused = refusal(error);
  return refused ? { error: refused, stale: true } : { error: message };
}

const done = (): ActionResult => {
  revalidatePath("/dashboard/tables");
  return null;
};

/** The other row that already has this name, ignoring case and outer spaces (excluding `self`). */
const nameTaken = (rows: { id: string; name: string }[], name: string, self?: string) => {
  const key = name.trim().toLowerCase();
  return rows.find((r) => r.id !== self && r.name.trim().toLowerCase() === key)?.name.trim();
};

/** Adds `count` tables numbered after the highest "Table N", e.g. 3 more after Table 12 → Tables 13–15. */
export async function addTables(count: number): Promise<ActionResult> {
  const parsed = z.number().int().min(1).max(50).safeParse(count);
  if (!parsed.success) return { error: TABLE_MESSAGES.count };
  const [db, denied] = await staffClient();
  if (!db) return denied;
  // Without the existing labels the numbering would restart at 1, so a failed read stops here.
  const { data, error: readError } = await db.from("dining_tables").select("label");
  if (readError) return failed("addTables read", readError, "Couldn’t add tables. Try again.");
  const rows = nextTableLabels(data.map((t) => t.label), parsed.data).map((l) => ({ label: l }));
  const { error } = await db.from("dining_tables").insert(rows);
  // 23505: someone added the same numbers a moment ago; the page refresh shows them.
  if (error && error.code !== UNIQUE_VIOLATION) return failed("addTables insert", error, "Couldn’t add tables. Try again.");
  return done();
}

/** A named spot, e.g. "Garden bench". */
export async function addNamedTable(name: string): Promise<ActionResult> {
  const parsed = label.safeParse(name);
  if (!parsed.success) return { error: TABLE_MESSAGES.name };
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const { data, error: readError } = await db.from("dining_tables").select("id, name:label");
  if (readError) return failed("addNamedTable read", readError, "Couldn’t add it. Try again.");
  const other = nameTaken(data, parsed.data);
  if (other) return { error: TABLE_MESSAGES.taken(other) };
  const { error } = await db.from("dining_tables").insert({ label: parsed.data });
  if (error?.code === UNIQUE_VIOLATION) return { error: TABLE_MESSAGES.taken(parsed.data) };
  if (error) return failed("addNamedTable", error, "Couldn’t add it. Try again.");
  return done();
}

export async function renameTable(tableId: string, name: string): Promise<ActionResult> {
  if (!uuid.safeParse(tableId).success) return STALE_FORM;
  const parsed = label.safeParse(name);
  if (!parsed.success) return { error: TABLE_MESSAGES.name };
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const { data, error: readError } = await db.from("dining_tables").select("id, name:label");
  if (readError) return failed("renameTable read", readError, "Couldn’t rename it. Try again.");
  const other = nameTaken(data, parsed.data, tableId);
  if (other) return { error: TABLE_MESSAGES.taken(other) };
  const { error } = await db.from("dining_tables").update({ label: parsed.data }).eq("id", tableId);
  if (error?.code === UNIQUE_VIOLATION) return { error: TABLE_MESSAGES.taken(parsed.data) };
  if (error) return failed("renameTable", error, "Couldn’t rename it. Try again.");
  return done();
}

export async function setTableActive(tableId: string, on: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(tableId).success || typeof on !== "boolean") return STALE_FORM;
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const { error } = await db.from("dining_tables").update({ active: on }).eq("id", tableId);
  if (error) return failed("setTableActive", error, on ? "Couldn’t turn it on. Try again." : "Couldn’t turn it off. Try again.");
  return done();
}

/** Issues a new QR code for a table; the old printed code stops working. The panel asks first. */
export async function resetTableCode(tableId: string): Promise<ActionResult> {
  if (!uuid.safeParse(tableId).success) return STALE_FORM;
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const qr_token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await db.from("dining_tables").update({ qr_token }).eq("id", tableId);
  if (error) return failed("resetTableCode", error, "Couldn’t make a new code. The printed one still works. Try again.");
  return done();
}

// ───────── delivery zones ─────────

const zoneInput = z.object({ name: z.string(), fee: z.number().nullable(), minimum: z.number().nullable(), active: z.boolean() });

/** Checks a zone as the server sees it, including a name another zone has: null when it's fine. */
async function zoneRefusal(db: Db, v: ZoneInput, what: string, message: string, self?: string): Promise<ActionResult> {
  const p = zoneProblem(v);
  if (p) return { error: p.message };
  const { data, error } = await db.from("delivery_zones").select("id, name");
  if (error) return failed(`${what} read`, error, message);
  const other = nameTaken(data, v.name, self);
  if (other) return { error: ZONE_MESSAGES.taken(other) };
  return null;
}

/** A new zone with name, fee, minimum (0 = none) and Delivering. */
export async function addZone(input: ZoneInput): Promise<ActionResult> {
  const parsed = zoneInput.safeParse(input);
  if (!parsed.success) return STALE_FORM;
  const v = parsed.data;
  const message = "Couldn’t add the zone. Try again.";
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const refused = await zoneRefusal(db, v, "addZone", message);
  if (refused) return refused;
  const { data, error: readError } = await db.from("delivery_zones").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  if (readError) return failed("addZone order", readError, message);
  const { error } = await db.from("delivery_zones").insert({
    name: v.name.trim(),
    fee_kes: v.fee ?? 0,
    min_order_kes: v.minimum ?? 0,
    active: v.active,
    sort_order: (data[0]?.sort_order ?? 0) + 1,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: ZONE_MESSAGES.taken(v.name.trim()) };
  if (error) return failed("addZone insert", error, message);
  return done();
}

/** Saves a zone's name, fee, minimum and Delivering. */
export async function updateZone(zoneId: string, input: ZoneInput): Promise<ActionResult> {
  const parsed = zoneInput.safeParse(input);
  if (!parsed.success || !uuid.safeParse(zoneId).success) return STALE_FORM;
  const v = parsed.data;
  const message = "Couldn’t save the zone. Try again.";
  const [db, denied] = await staffClient();
  if (!db) return denied;
  const refused = await zoneRefusal(db, v, "updateZone", message, zoneId);
  if (refused) return refused;
  const { data, error } = await db
    .from("delivery_zones")
    .update({ name: v.name.trim(), fee_kes: v.fee ?? 0, min_order_kes: v.minimum ?? 0, active: v.active })
    .eq("id", zoneId)
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) return { error: ZONE_MESSAGES.taken(v.name.trim()) };
  if (error) return failed("updateZone", error, message);
  // Nothing matched: the zone went, or the database kept the change from this person.
  if (data.length === 0) return { error: "Couldn’t save the zone. Refresh the page and try again.", stale: true };
  return done();
}
