"use server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AUTH, MIN_PASSWORD, isRateLimited, newPasswordRefusal } from "@/lib/auth-messages";
import { env } from "@/lib/env";
import { createClient, getStaff } from "@/lib/supabase/server";

export type ChangePasswordResult = { ok: true } | { ok: false; field: "current" | "password" | "again" | "form"; error: string };

const input = z.object({ current: z.string().max(200).nullable(), password: z.string().max(200), again: z.string().max(200) });

/**
 * Account, Change password (spec-2.6). Someone with a password proves it first: it is checked on a
 * separate client with no cookies, so this session stays as it is, and that check's own session is
 * ended at once. Someone who has only used email links sets one without it. The user stays signed in.
 */
export async function changePassword(values: { current: string | null; password: string; again: string }): Promise<ChangePasswordResult> {
  const parsed = input.safeParse(values);
  if (!parsed.success) return { ok: false, field: "form", error: "Something didn’t match. Refresh the page and try again." };
  const { current, password, again } = parsed.data;
  if (password.length < MIN_PASSWORD) return { ok: false, field: "password", error: AUTH.short };
  if (password !== again) return { ok: false, field: "again", error: AUTH.mismatch };

  let staff;
  try {
    staff = await getStaff();
  } catch {
    return { ok: false, field: "form", error: "Couldn’t check you’re signed in. Try again." };
  }
  if (!staff?.email) return { ok: false, field: "form", error: AUTH.signedOut };
  const supabase = await createClient();

  // The server decides whether the current password is needed, never the form. If it can't tell,
  // it asks for it (the page then shows the "email links only? Use Forgot password" hint).
  const { data: hasPassword, error: hasError } = await supabase.rpc("has_password");
  if (hasError) console.error("[db] has_password failed:", hasError.code ?? "", hasError.message);
  if (hasPassword !== false) {
    if (!current) return { ok: false, field: "current", error: AUTH.noCurrent };
    const check = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await check.auth.signInWithPassword({ email: staff.email, password: current });
    if (error) {
      if (error.code === "invalid_credentials") return { ok: false, field: "current", error: AUTH.wrongCurrent };
      if (isRateLimited(error)) return { ok: false, field: "form", error: AUTH.rate };
      console.error("[auth] current password check failed:", error.code ?? "", error.message);
      return { ok: false, field: "form", error: "Couldn’t check your current password. Try again." };
    }
    await check.auth.signOut({ scope: "local" });
    if (data.user.id !== staff.id) return { ok: false, field: "form", error: AUTH.signedOut };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const refused = newPasswordRefusal(error, false);
    if (refused) return { ok: false, field: refused === AUTH.rate || refused === AUTH.signInAgain ? "form" : "password", error: refused };
    console.error("[auth] change password failed:", error.code ?? "", error.message);
    return { ok: false, field: "form", error: AUTH.saveFailed };
  }
  return { ok: true };
}
