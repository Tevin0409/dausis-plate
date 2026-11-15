"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { errorLine, field, labelText, linkBtn, primary } from "@/components/ui-classes";
import { Segments } from "@/components/ui-parts";
import { AUTH, isRateLimited } from "@/lib/auth-messages";
import { getBrowserClient } from "@/lib/supabase/client";

type Mode = "password" | "link";
type Problem = { field: "email" | "password"; text: string } | null;

const RESEND_SECONDS = 60;

/** spec-2.6 "Sign in (`/login`)". Errors sit under the field they're about. */
export function LoginForm({ next, linkError, startWithLink }: { next: string; linkError: string | null; startWithLink: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(startWithLink ? "link" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<Problem>(linkError ? { field: "email", text: linkError } : null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  function fail(p: NonNullable<Problem>) {
    setProblem(p);
    setWorking(false);
    document.getElementById(`login-${p.field}`)?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (working || (mode === "link" && wait > 0)) return;
    const address = email.trim();
    if (!address) return fail({ field: "email", text: "Enter your email." });
    setWorking(true);
    setProblem(null);
    const auth = getBrowserClient().auth;

    if (mode === "password") {
      if (!password) return fail({ field: "password", text: "Enter your password." });
      const { error } = await auth.signInWithPassword({ email: address, password });
      if (error) {
        if (error.code === "invalid_credentials") return fail({ field: "password", text: AUTH.wrong });
        if (error.code === "email_not_confirmed") return fail({ field: "email", text: AUTH.notConfirmed });
        if (isRateLimited(error)) return fail({ field: "password", text: AUTH.rate });
        return fail({ field: "password", text: AUTH.offline });
      }
      // The dashboard sends a forced change (a temporary password) on to Set your password.
      router.replace(next);
      router.refresh();
      return;
    }

    const { error } = await auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
    });
    // An email that isn't on the team is refused with otp_disabled; it gets the same "Check your
    // email" line, so the page never says who is on the team.
    if (error && error.code !== "otp_disabled" && error.code !== "user_not_found") {
      return fail({ field: "email", text: isRateLimited(error) ? AUTH.rate : AUTH.offline });
    }
    setWorking(false);
    setSent(true);
    setWait(RESEND_SECONDS);
  }

  const err = (f: "email" | "password") => (problem?.field === f ? problem.text : null);
  const errLine = (f: "email" | "password") =>
    err(f) && (
      <p id={`login-${f}-err`} role="alert" className={errorLine}>
        {err(f)}
      </p>
    );

  const label =
    mode === "password" ? (working ? "Signing in…" : "Sign in") : working ? "Sending…" : wait > 0 ? `Send again in ${wait} s` : "Email me a link";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Segments
        label="How to sign in"
        value={mode}
        options={[
          ["password", "Password"],
          ["link", "Email me a link"],
        ]}
        onChange={(m) => {
          setMode(m);
          setProblem(null);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className={labelText}>
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => (setEmail(e.target.value), setProblem(null))}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={mode === "password" ? "next" : "send"}
          maxLength={254}
          aria-invalid={err("email") ? true : undefined}
          aria-describedby={err("email") ? "login-email-err" : undefined}
          className={field}
        />
        {errLine("email")}
      </div>

      {mode === "password" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className={labelText}>
            Password
          </label>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={(v) => (setPassword(v), setProblem(null))}
            autoComplete="current-password"
            enterKeyHint="go"
            invalid={!!err("password")}
            describedBy={err("password") ? "login-password-err" : undefined}
          />
          {errLine("password")}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button type="submit" disabled={working || (mode === "link" && wait > 0)} className={`${primary} w-full`}>
          {label}
        </button>
        {mode === "password" ? (
          <Link href="/login/forgot" className={`${linkBtn} self-start text-[15px]`}>
            Forgot password?
          </Link>
        ) : (
          sent && (
            <p role="status" className="note-in rounded-[var(--r-sm)] bg-teal-tint px-4 py-3 text-[15px] text-teal-deeper">
              {AUTH.linkSent}
            </p>
          )
        )}
      </div>
    </form>
  );
}
