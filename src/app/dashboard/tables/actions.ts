"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getStaff } from "@/lib/supabase/server";

async function staffClient() {
  if (!(await getStaff())) throw new Error("Not signed in as staff");
  return createClient();
}

const done = () => revalidatePath("/dashboard/tables");

/** Adds tables numbered after the highest existing "Table N", e.g. 6 more after Table 4 → Tables 5–10. */
export async function addTables(formData: FormData) {
  const { count } = z.object({ count: z.coerce.number().int().min(1).max(50) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { data } = await supabase.from("dining_tables").select("label");
  const taken = new Set((data ?? []).map((t) => t.label.toLowerCase()));
  const highest = Math.max(0, ...(data ?? []).map((t) => Number(/^table (\d+)$/i.exec(t.label)?.[1] ?? 0)));
  const rows: { label: string }[] = [];
  for (let n = highest + 1; rows.length < count; n++) {
    if (!taken.has(`table ${n}`)) rows.push({ label: `Table ${n}` });
  }
  const { error } = await supabase.from("dining_tables").insert(rows);
  if (error && error.code !== "23505") throw error;
  done();
}

/** A custom-named spot, e.g. "Terrace 1" or "Bar". */
export async function addNamedTable(formData: FormData) {
  const { label } = z.object({ label: z.string().trim().min(1).max(40) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("dining_tables").insert({ label });
  if (error && error.code !== "23505") throw error;
  done();
}

export async function renameTable(formData: FormData) {
  const v = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(40) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("dining_tables").update({ label: v.label }).eq("id", v.id);
  if (error) throw error;
  done();
}

export async function setTableActive(formData: FormData) {
  const v = z.object({ id: z.string().uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("dining_tables").update({ active: v.active === "true" }).eq("id", v.id);
  if (error) throw error;
  done();
}

/** Issues a new QR code for a table; the old printed code stops working. */
export async function resetTableCode(formData: FormData) {
  const { id } = z.object({ id: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const qr_token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabase.from("dining_tables").update({ qr_token }).eq("id", id);
  if (error) throw error;
  done();
}

// ───────── delivery areas ─────────

export async function addZone(formData: FormData) {
  const v = z
    .object({ name: z.string().trim().min(1).max(40), fee_kes: z.coerce.number().int().min(0).max(5000) })
    .parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { data } = await supabase.from("delivery_zones").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("delivery_zones").insert({ ...v, sort_order: (data?.[0]?.sort_order ?? 0) + 1 });
  if (error && error.code !== "23505") throw error;
  done();
}

export async function updateZone(formData: FormData) {
  const v = z
    .object({ id: z.string().uuid(), fee_kes: z.coerce.number().int().min(0).max(5000), active: z.enum(["true", "false"]) })
    .parse(Object.fromEntries(formData));
  const supabase = await staffClient();
  const { error } = await supabase.from("delivery_zones").update({ fee_kes: v.fee_kes, active: v.active === "true" }).eq("id", v.id);
  if (error) throw error;
  done();
}
