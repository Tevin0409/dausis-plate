import { AuthShell } from "@/components/auth/auth-shell";
import { AUTH } from "@/lib/auth-messages";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/** spec-2.6 "Sign in": password or "Email me a link"; `?error=link|invite` after a failed link. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const linkError = error === "invite" ? AUTH.inviteFailed : error === "link" ? AUTH.linkFailed : null;
  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-[28px] leading-tight text-ink">Dausis Plate</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Kitchen sign-in</p>
      </div>
      <LoginForm next={safeNext(next ?? null)} linkError={linkError} startWithLink={error === "link"} />
    </AuthShell>
  );
}
