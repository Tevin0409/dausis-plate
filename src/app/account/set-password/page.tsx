import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getStaff } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/**
 * spec-2.6 "Set your password": one page for the invite link, the reset link and the forced change
 * after a temporary password. It lives outside /dashboard, so the forced change can't loop.
 */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const staff = await getStaff();
  // Signed in but not on the team: the dashboard shows "isn't on the team". Signed out: middleware.
  if (!staff) redirect("/dashboard");
  const { type } = await searchParams;
  const invite = type === "invite";
  const name = staff.name?.trim();
  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-[28px] leading-tight text-ink">{invite ? "Welcome to Dausis Plate" : "Choose a new password"}</h1>
        {invite && (
          <p className="mt-1 text-[15px] text-ink-soft [overflow-wrap:anywhere]">
            {name ? `Hi ${name}. ` : ""}Choose a password for signing in.
          </p>
        )}
      </div>
      <SetPasswordForm email={staff.email} />
    </AuthShell>
  );
}
