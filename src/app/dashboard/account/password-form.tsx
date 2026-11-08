"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { errorLine, hint, labelText, primary } from "@/components/ui-classes";
import { AUTH, MIN_PASSWORD } from "@/lib/auth-messages";
import { changePassword, type ChangePasswordResult } from "./actions";

type Field = "current" | "password" | "again";
type Problem = Extract<ChangePasswordResult, { ok: false }>;

/**
 * Change password, or Set a password for someone who has only used email links (spec-2.6 Account).
 * `unsure`: the page couldn't tell, so the current field shows with a hint for links-only people.
 */
export function PasswordForm({ email, hasPassword, unsure }: { email: string | null; hasPassword: boolean; unsure: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function show(p: Problem) {
    setProblem(p);
    if (p.field !== "form") document.getElementById(`pw-${p.field}`)?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (hasPassword && !current) return show({ ok: false, field: "current", error: AUTH.noCurrent });
    if (password.length < MIN_PASSWORD) return show({ ok: false, field: "password", error: AUTH.short });
    if (password !== again) return show({ ok: false, field: "again", error: AUTH.mismatch });
    setProblem(null);
    setDone(null);
    startTransition(async () => {
      const r = await changePassword({ current: hasPassword ? current : null, password, again });
      if (!r.ok) return show(r);
      setCurrent("");
      setPassword("");
      setAgain("");
      setDone(hasPassword ? "Password changed." : "Password saved.");
      // Someone who just set their first password now sees "Password" with a current field.
      if (!hasPassword) router.refresh();
    });
  }

  const err = (f: Field) => (problem?.field === f ? problem.error : null);
  const line = (f: Field) =>
    err(f) && (
      <p id={`pw-${f}-err`} role="alert" className={errorLine}>
        {err(f)}
      </p>
    );
  const described = (f: Field, extra?: string) => [err(f) ? `pw-${f}-err` : null, extra].filter(Boolean).join(" ") || undefined;
  const edit = (set: (v: string) => void) => (v: string) => (set(v), setProblem(null), setDone(null));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      {hasPassword && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pw-current" className={labelText}>
            Current password
          </label>
          <PasswordInput
            id="pw-current"
            value={current}
            onChange={edit(setCurrent)}
            autoComplete="current-password"
            enterKeyHint="next"
            invalid={!!err("current")}
            describedBy={described("current", unsure ? "pw-current-hint" : undefined)}
          />
          {unsure && (
            <p id="pw-current-hint" className={hint}>
              Signed in with email links only? Use Forgot password on the sign-in page.
            </p>
          )}
          {line("current")}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pw-password" className={labelText}>
          New password
        </label>
        <PasswordInput
          id="pw-password"
          value={password}
          onChange={edit(setPassword)}
          autoComplete="new-password"
          enterKeyHint="next"
          invalid={!!err("password")}
          describedBy={described("password", "pw-password-hint")}
        />
        <p id="pw-password-hint" className={hint}>
          At least 8 characters.
        </p>
        {line("password")}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pw-again" className={labelText}>
          Type it again
        </label>
        <PasswordInput
          id="pw-again"
          value={again}
          onChange={edit(setAgain)}
          autoComplete="new-password"
          enterKeyHint="done"
          invalid={!!err("again")}
          describedBy={described("again")}
        />
        {line("again")}
      </div>
      {problem?.field === "form" && (
        <p role="alert" className={errorLine}>
          {problem.error}
        </p>
      )}
      {done && (
        <p role="status" className="note-in rounded-[var(--r-sm)] bg-teal-tint px-4 py-3 text-[15px] text-teal-deeper">
          {done}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${primary} w-full min-[600px]:w-auto min-[600px]:self-start`}>
        {pending ? "Saving…" : hasPassword ? "Change password" : "Set a password"}
      </button>
    </form>
  );
}
