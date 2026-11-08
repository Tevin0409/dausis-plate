"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GRANTS, OWNER_ONLY, type Grant } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { refusal } from "@/lib/supabase/refusal";
import { createClient, getStaff } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { TEAM, emailProblem, nameProblem, normEmail, type TeamRole } from "@/lib/team";
import { isTempPassword } from "@/lib/temp-password";

// spec-2.6 "Server actions": the Team panel's actions. These, and the Team page's sign-in times,
// are the only places that use the service-role client. Each checks the caller is an owner here,
// and the database checks again. Passwords are never logged or returned.

export type TeamResult =
  | { ok: true; note?: string }
  | { ok: false; error: string; field?: "name" | "email" | "password" | "role" | "form"; stale?: boolean; gone?: boolean };

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string; details?: string } | null;

const uuid = z.string().uuid();
const role = z.enum(["owner", "staff"]);
const grant = z.enum(GRANTS);
const STALE_FORM: TeamResult = { ok: false, error: "Something didn’t match. Refresh the page and try again." };
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

async function ownerClient(): Promise<[Db, string, null] | [null, null, TeamResult]> {
  let me;
  try {
    me = await getStaff();
  } catch {
    return [null, null, { ok: false, error: "Couldn’t check you’re signed in. Try again." }];
  }
  if (!me) return [null, null, { ok: false, error: "You’re signed out. Sign in again and retry." }];
  if (me.role !== "owner") return [null, null, { ok: false, error: OWNER_ONLY.owner, stale: true }];
  return [await createClient(), me.id, null];
}

/** The database's own line (P0001 from the team RPCs and the last-owner rule), a refusal, or `message`. */
function failed(what: string, error: DbError, message: string, field?: "name" | "role" | "form"): TeamResult {
  console.error(`[action] team ${what} failed:`, error?.code ?? "", error?.message ?? "");
  const refused = refusal(error);
  if (refused) return { ok: false, error: refused, stale: true };
  if (error?.code === "P0001") {
    const gone = error.details === "missing";
    return { ok: false, error: error.message, field: error.details === "name" ? "name" : field, gone };
  }
  return { ok: false, error: message, field };
}

const done = (note?: string): TeamResult => {
  revalidatePath("/dashboard/team");
  return { ok: true, note };
};

const inviteLink = async () => `${await siteOrigin()}/auth/callback?next=/account/set-password&type=invite`;

/** The auth account with this email, if any. Small teams: a page of 1,000 is read until the end. */
async function userByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** The person's staff row as the owner sees it, or null when they've gone. */
async function member(db: Db, userId: string) {
  const { data, error } = await db.from("staff").select("role, display_name, invited_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Add someone: a new person gets an invite; someone with an account is back on the team at once. */
export async function inviteMember(input: { name: string; email: string; role: TeamRole }): Promise<TeamResult> {
  const parsed = z.object({ name: z.string(), email: z.string(), role }).safeParse(input);
  if (!parsed.success) return STALE_FORM;
  const nameError = nameProblem(parsed.data.name);
  if (nameError) return { ok: false, error: nameError, field: "name" };
  if (emailProblem(parsed.data.email)) return { ok: false, error: TEAM.email, field: "email" };
  const name = parsed.data.name.trim();
  const email = normEmail(parsed.data.email);
  const [db, , denied] = await ownerClient();
  if (!db) return denied;

  const admin = createAdminClient();
  let existing;
  try {
    existing = await userByEmail(admin, email);
  } catch (e) {
    console.error("[action] team invite lookup failed:", (e as Error).message);
    return { ok: false, error: TEAM.inviteFailed, field: "form" };
  }
  if (existing) {
    try {
      if (await member(db, existing.id)) return { ok: false, error: TEAM.onTeam, field: "email" };
    } catch (e) {
      return failed("invite member read", e as DbError, TEAM.inviteFailed, "form");
    }
  }

  // An account that has been used before (removed and now back): on the team again, no invite.
  if (existing && (existing.email_confirmed_at || existing.last_sign_in_at)) {
    const { error } = await db.from("staff").insert({ user_id: existing.id, role: parsed.data.role, display_name: name });
    if (error?.code === UNIQUE_VIOLATION) return { ok: false, error: TEAM.onTeam, field: "email" };
    if (error) return failed("re-add", error, "Couldn’t add them. Try again.", "form");
    return done(TEAM.hasAccount(name));
  }

  // New, or invited before and never accepted: send the invite, then add the row.
  const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: await inviteLink(), data: { display_name: name } });
  if (inviteError || !data.user) {
    console.error("[action] team invite send failed:", inviteError?.code ?? "", inviteError?.message ?? "");
    return { ok: false, error: TEAM.inviteFailed, field: "form" };
  }
  const { error } = await db.from("staff").insert({ user_id: data.user.id, role: parsed.data.role, display_name: name, invited_at: new Date().toISOString() });
  if (error) {
    // Nothing half-done: the account this invite just made goes again.
    if (!existing) {
      const { error: undoError } = await admin.auth.admin.deleteUser(data.user.id);
      if (undoError) console.error("[action] team invite undo failed:", undoError.code ?? "", undoError.message);
    }
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: TEAM.onTeam, field: "email" };
    return failed("invite insert", error, TEAM.inviteFailed, "form");
  }
  return done(TEAM.inviteSent(email));
}

/** Send again: a new invite link for someone who hasn't accepted. */
export async function resendInvite(userId: string): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success) return STALE_FORM;
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  let row;
  try {
    row = await member(db, userId);
  } catch (e) {
    return failed("resend read", e as DbError, TEAM.resendFailed, "form");
  }
  if (!row) return { ok: false, error: TEAM.gone, gone: true };
  if (!row.invited_at) return { ok: false, error: "They’ve already accepted the invite. Refresh the page.", field: "form" };
  const admin = createAdminClient();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  if (findError || !found.user?.email) {
    console.error("[action] team resend lookup failed:", findError?.code ?? "", findError?.message ?? "");
    return { ok: false, error: TEAM.resendFailed, field: "form" };
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(found.user.email, { redirectTo: await inviteLink() });
  if (error) {
    console.error("[action] team resend failed:", error.code ?? "", error.message);
    return { ok: false, error: TEAM.resendFailed, field: "form" };
  }
  const { error: stampError } = await db.from("staff").update({ invited_at: new Date().toISOString() }).eq("user_id", userId);
  if (stampError) console.error("[action] team resend stamp failed:", stampError.code ?? "", stampError.message);
  return done(TEAM.inviteSentAgain);
}

/** Cancel invite: off the team, and the unused account goes so the link can't sign anyone in. */
export async function cancelInvite(userId: string, name: string): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success) return STALE_FORM;
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  const { error } = await db.rpc("team_remove", { p_user: userId, p_invite: true });
  if (error) return failed("cancel invite", error, "Couldn’t cancel the invite. Try again.", "form");
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  if (data.user && !data.user.last_sign_in_at) {
    const { count, error: logError } = await admin.from("change_log").select("id", { count: "exact", head: true }).eq("actor", userId);
    if (!logError && count === 0) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) console.error("[action] team cancel delete failed:", deleteError.code ?? "", deleteError.message);
    }
  }
  return done(TEAM.cancelled(name.trim() || "Their"));
}

export async function setMemberName(userId: string, name: string): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success || typeof name !== "string") return STALE_FORM;
  const problem = nameProblem(name);
  if (problem) return { ok: false, error: problem, field: "name" };
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  const { error } = await db.rpc("team_set_name", { p_user: userId, p_name: name.trim() });
  if (error) return failed("rename", error, "Couldn’t save the name. Try again.", "name");
  return done();
}

export async function setMemberRole(userId: string, next: TeamRole): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success || !role.safeParse(next).success) return STALE_FORM;
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  const { error } = await db.rpc("team_set_role", { p_user: userId, p_role: next });
  if (error) return failed("role", error, "Couldn’t change the role. Try again.", "role");
  revalidatePath("/dashboard", "layout");
  return done();
}

/** One of the four switches: saves on its own. */
export async function setMemberGrant(userId: string, job: Grant, on: boolean): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success || !grant.safeParse(job).success || typeof on !== "boolean") return STALE_FORM;
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  const { error } = on
    ? await db.from("staff_grants").upsert({ user_id: userId, job }, { onConflict: "user_id,job", ignoreDuplicates: true })
    : await db.from("staff_grants").delete().eq("user_id", userId).eq("job", job);
  if (error?.code === FOREIGN_KEY_VIOLATION) return { ok: false, error: TEAM.gone, gone: true };
  if (error) return failed("grant", error, on ? "Couldn’t switch it on. Try again." : "Couldn’t switch it off. Try again.");
  return done();
}

/** Mama sets a temporary password; the person must choose their own at the next sign-in. */
export async function resetPassword(userId: string, temp: string): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success || typeof temp !== "string") return STALE_FORM;
  if (!isTempPassword(temp) || temp.length > 200) return { ok: false, error: TEAM.tempShort, field: "password" };
  const [db, me, denied] = await ownerClient();
  if (!db) return denied;
  if (userId === me) return { ok: false, error: TEAM.resetSelf, field: "form" };
  let row;
  try {
    row = await member(db, userId);
  } catch (e) {
    return failed("reset read", e as DbError, "Couldn’t set the password. Try again.", "form");
  }
  if (!row) return { ok: false, error: TEAM.gone, gone: true };
  if (row.role === "owner") return { ok: false, error: TEAM.resetOwner, field: "form" };
  if (row.invited_at) return { ok: false, error: "They haven’t accepted the invite yet. Use Send again.", field: "form" };

  const admin = createAdminClient();
  const { error: setError } = await admin.auth.admin.updateUserById(userId, { password: temp });
  if (setError) {
    console.error("[action] team reset failed:", setError.code ?? "", "(password not logged)");
    if (setError.code === "weak_password") return { ok: false, error: "That password is too easy to guess. Try another, or Make one for me.", field: "password" };
    return { ok: false, error: "Couldn’t set the password. Try again.", field: "form" };
  }
  // The History line, the forced change and the end of their sessions.
  const { error } = await db.rpc("team_log_reset", { p_user: userId });
  if (error) return failed("reset log", error, "The password was set, but the reset didn’t finish. Try again.", "form");
  return done();
}

/** Remove from team: the row and grants go, and their sessions end now. The account stays. */
export async function removeMember(userId: string, name: string): Promise<TeamResult> {
  if (!uuid.safeParse(userId).success) return STALE_FORM;
  const [db, , denied] = await ownerClient();
  if (!db) return denied;
  const { error } = await db.rpc("team_remove", { p_user: userId });
  if (error) return failed("remove", error, "Couldn’t remove them. Try again.", "form");
  return done(TEAM.removed(name.trim() || "They were"));
}
