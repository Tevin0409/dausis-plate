import { notFound } from "next/navigation";
import { quiet } from "@/components/ui-classes";
import { createClient, getStaff } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { tile, tileHeading } from "../settings/ui";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/** spec-2.6 "Account (`/dashboard/account`)": who you are, your password, Sign out. */
export default async function AccountPage() {
  const staff = await getStaff();
  if (!staff) notFound();
  const { data: hasPassword, error } = await (await createClient()).rpc("has_password");
  if (error) console.error("[db] has_password failed:", error.code ?? "", error.message);
  // null: couldn't tell, so the current-password field shows, with the Forgot password hint.
  const has = error ? null : hasPassword;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <h1 className="font-display text-[34px] leading-tight">Account</h1>

      <section aria-label="You" className={`${tile} flex flex-col gap-0.5`}>
        <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{staff.name?.trim() || staff.email}</p>
        <p className="text-[14px] text-ink-soft">{staff.role === "owner" ? "Owner" : "Staff"}</p>
        <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">{staff.email}</p>
      </section>

      <section aria-labelledby="password-heading" className={`${tile} flex flex-col gap-4`}>
        <div>
          <h2 id="password-heading" className={tileHeading}>
            {has === false ? "Set a password" : "Password"}
          </h2>
          {has === false && (
            <p className="mt-1 text-[14px] text-ink-soft">You’ve been signing in with email links. A password lets you sign in without your email.</p>
          )}
        </div>
        <PasswordForm email={staff.email} hasPassword={has !== false} unsure={has === null} />
      </section>

      <form action={signOut}>
        <button type="submit" className={quiet}>
          Sign out
        </button>
      </form>
    </div>
  );
}
