import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot your password?" };

/** spec-2.6 "Forgot password (`/login/forgot`)". */
export default function ForgotPage() {
  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-[28px] leading-tight text-ink">Forgot your password?</h1>
        <p className="mt-1 text-[15px] text-ink-soft">We’ll email you a link to choose a new one.</p>
      </div>
      <ForgotForm />
    </AuthShell>
  );
}
