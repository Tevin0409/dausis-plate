"use client";
import { useState, useTransition } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { errorLine, labelText, primary } from "@/components/ui-classes";
import { AUTH, MIN_PASSWORD } from "@/lib/auth-messages";
import { saveNewPassword, type SetPasswordResult } from "./actions";

/** New password, Type it again, Save password (spec-2.6 "Set your password"). */
export function SetPasswordForm({ email }: { email: string | null }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<SetPasswordResult | null>(null);
  const [pending, startTransition] = useTransition();

  function show(p: SetPasswordResult) {
    setProblem(p);
    if (p.field !== "form") document.getElementById(`set-${p.field}`)?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (password.length < MIN_PASSWORD) return show({ field: "password", error: AUTH.short });
    if (password !== again) return show({ field: "again", error: AUTH.mismatch });
    setProblem(null);
    startTransition(async () => {
      const r = await saveNewPassword({ password, again });
      if (r) show(r);
    });
  }

  const err = (f: "password" | "again") => (problem?.field === f ? problem.error : null);
  const line = (f: "password" | "again") =>
    err(f) && (
      <p id={`set-${f}-err`} role="alert" className={errorLine}>
        {err(f)}
      </p>
    );
  const edit = (set: (v: string) => void) => (v: string) => (set(v), setProblem(null));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {/* For password managers: which account this new password belongs to. */}
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="set-password" className={labelText}>
          New password
        </label>
        <PasswordInput
          id="set-password"
          value={password}
          onChange={edit(setPassword)}
          autoComplete="new-password"
          enterKeyHint="next"
          invalid={!!err("password")}
          describedBy={err("password") ? "set-password-err set-password-hint" : "set-password-hint"}
        />
        <p id="set-password-hint" className="text-[13px] text-ink-soft">
          At least 8 characters.
        </p>
        {line("password")}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="set-again" className={labelText}>
          Type it again
        </label>
        <PasswordInput
          id="set-again"
          value={again}
          onChange={edit(setAgain)}
          autoComplete="new-password"
          enterKeyHint="done"
          invalid={!!err("again")}
          describedBy={err("again") ? "set-again-err" : undefined}
        />
        {line("again")}
      </div>
      {problem?.field === "form" && (
        <p role="alert" className={errorLine}>
          {problem.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${primary} w-full`}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
