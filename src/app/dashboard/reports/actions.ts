"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/dashboard/action-result";
import { creditAmountError, creditReasonError } from "@/lib/reports/money";
import { refusal } from "@/lib/supabase/refusal";
import { createClient, getStaff } from "@/lib/supabase/server";

// Credit notes are the owner's alone. The database checks it again (issue_credit_note, void_credit_note).

const uuid = z.string().uuid();

type Owner = { error: string; supabase?: undefined } | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>> };

async function ownerClient(): Promise<Owner> {
  try {
    const staff = await getStaff();
    if (!staff) return { error: "You’re signed out. Sign in again and retry." };
    if (staff.role !== "owner") return { error: "Only the owner can do this." };
  } catch {
    return { error: "Couldn’t check you’re signed in. Try again." };
  }
  return { supabase: await createClient() };
}

const NOTHING_SAVED = "Couldn’t issue the credit note. Nothing was saved. Try again.";

export async function issueCreditNote(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ orderId: uuid, paid: z.coerce.number().int().min(1), amount: z.string().max(12), reason: z.string().max(400), with: z.enum(["cash", "mpesa"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Something didn’t match. Refresh the page and try again." };
  const f = parsed.data;
  const bad = creditAmountError(f.amount, f.paid) ?? creditReasonError(f.reason);
  if (bad) return { error: bad };
  const who = await ownerClient();
  if (who.error !== undefined) return { error: who.error };
  const { error } = await who.supabase.rpc("issue_credit_note", {
    p_order: f.orderId,
    p_amount: Number(f.amount.replace(/[,\s]/g, "")),
    p_reason: f.reason.trim(),
    p_refunded_with: f.with,
  });
  // Refresh either way: "already has a credit note" needs the sheet to show that note.
  revalidatePath("/dashboard/reports");
  if (error) {
    console.error("[action] issueCreditNote failed:", error.code ?? "", error.message);
    const refused = refusal(error);
    if (refused) return { error: refused, stale: true };
    return { error: error.code === "P0001" ? error.message : NOTHING_SAVED };
  }
  return null;
}

export async function voidCreditNote(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, reason: z.string().max(400) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Something didn’t match. Refresh the page and try again." };
  const bad = creditReasonError(parsed.data.reason);
  if (bad) return { error: bad };
  const who = await ownerClient();
  if (who.error !== undefined) return { error: who.error };
  const { error } = await who.supabase.rpc("void_credit_note", { p_id: parsed.data.id, p_reason: parsed.data.reason.trim() });
  revalidatePath("/dashboard/reports");
  if (error) {
    console.error("[action] voidCreditNote failed:", error.code ?? "", error.message);
    const refused = refusal(error);
    if (refused) return { error: refused, stale: true };
    return { error: error.code === "P0001" ? error.message : "Couldn’t void the credit note. Nothing was changed. Try again." };
  }
  return null;
}
