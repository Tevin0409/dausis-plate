"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AUTH, MIN_PASSWORD, newPasswordRefusal } from "@/lib/auth-messages";
import { createClient, getStaff } from "@/lib/supabase/server";

export type SetPasswordResult = { field: "password" | "again" | "form"; error: string };

const input = z.object({ password: z.string().max(200), again: z.string().max(200) });

/**
 * Saves the new password, then ends "must change" and "Invited", then goes to the board with
 * "Password saved." The page never says the password is already saved (RQA26-01): every submit sends
 * both fields, and the database's clear_must_change_password decides whether the change is done
 * (a password exists, and after a reset it isn't the temporary one).
 */
export async function saveNewPassword(values: { password: string; again: string }): Promise<SetPasswordResult> {
  const parsed = input.safeParse(values);
  if (!parsed.success) return { field: "form", error: "Something didn’t match. Refresh the page and try again." };
  const { password, again } = parsed.data;
  if (password.length < MIN_PASSWORD) return { field: "password", error: AUTH.short };
  if (password !== again) return { field: "again", error: AUTH.mismatch };

  let staff;
  try {
    staff = await getStaff();
  } catch {
    return { field: "form", error: "Couldn’t check you’re signed in. Try again." };
  }
  if (!staff) return { field: "form", error: AUTH.signedOut };
  const supabase = await createClient();
  const pendingClear = staff.mustChangePassword || staff.invited;

  const { error } = await supabase.auth.updateUser({ password });
  // "Same password" with a clear still pending is the retry after the last step failed: the password
  // was saved. The database below refuses it if that password is still the temporary one.
  if (error && !(error.code === "same_password" && pendingClear)) {
    const refused = newPasswordRefusal(error, staff.mustChangePassword);
    if (refused) return { field: refused === AUTH.rate || refused === AUTH.signInAgain ? "form" : "password", error: refused };
    console.error("[auth] set password failed:", error.code ?? "", error.message);
    return { field: "form", error: AUTH.saveFailed };
  }

  const { error: clearError } = await supabase.rpc("clear_must_change_password");
  if (clearError) {
    if (clearError.code === "P0001" && clearError.details === "temporary") return { field: "password", error: AUTH.sameAsTemp };
    console.error("[db] clear_must_change_password failed:", clearError.code ?? "", clearError.message);
    return { field: "form", error: "Your password is saved, but the last step didn’t finish. Try again." };
  }
  redirect("/dashboard/orders?saved=password");
}
