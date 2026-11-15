"use client";
import Link from "next/link";
import { useState } from "react";
import { errorLine, field, labelText, linkBtn, primary } from "@/components/ui-classes";
import { AUTH, isRateLimited } from "@/lib/auth-messages";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * Asks for the email, then always shows the same line: it never says whether the email is on the
 * team. The link lands on Set your password through /auth/callback.
 */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (working) return;
    const address = email.trim();
    if (!address) {
      setProblem("Enter your email.");
      document.getElementById("forgot-email")?.focus();
      return;
    }
    setWorking(true);
    setProblem(null);
    const { error } = await getBrowserClient().auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/account/set-password")}&type=recovery`,
    });
    setWorking(false);
    // Only a refusal that says nothing about the email is shown; anything else gets the same line.
    if (error && (isRateLimited(error) || error.name === "AuthRetryableFetchError")) {
      setProblem(isRateLimited(error) ? AUTH.rate : AUTH.offline);
      return;
    }
    if (error) console.error("[auth] resetPasswordForEmail:", error.code ?? "", error.message);
    setSent(true);
  }

  const back = (
    <Link href="/login" className={`${linkBtn} self-start text-[15px]`}>
      Back to sign-in
    </Link>
  );

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="note-in rounded-[var(--r-sm)] bg-teal-tint px-4 py-3 text-[15px] text-teal-deeper">
          {AUTH.forgotSent}
        </p>
        {back}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot-email" className={labelText}>
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => (setEmail(e.target.value), setProblem(null))}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={254}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "forgot-email-err" : undefined}
          className={field}
        />
        {problem && (
          <p id="forgot-email-err" role="alert" className={errorLine}>
            {problem}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <button type="submit" disabled={working} className={`${primary} w-full`}>
          {working ? "Sending…" : "Send link"}
        </button>
        {back}
      </div>
    </form>
  );
}
