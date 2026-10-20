"use client";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

const input = "min-h-12 rounded-xl border border-line-deep px-3.5 text-base font-normal";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don’t match.");
    setState("saving");
    const { error: err } = await getBrowserClient().auth.updateUser({ password });
    if (err) {
      setState("idle");
      setError(err.code === "weak_password" ? "That password is too easy to guess. Try a longer one." : err.code === "same_password" ? "That’s already your password." : "Couldn’t save the password. Try again.");
      return;
    }
    setPassword("");
    setConfirm("");
    setState("saved");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        New password
        <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Type it again
        <input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
      </label>
      {error && <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-sm text-coral-ink">{error}</p>}
      {state === "saved" && <p role="status" className="rounded-xl bg-teal-tint px-4 py-3 text-sm text-teal-deeper">Password saved. Next time, sign in with your email and this password.</p>}
      <button type="submit" disabled={state === "saving"} className="min-h-12 self-start rounded-xl bg-teal-deep px-6 font-bold text-white disabled:opacity-60">
        {state === "saving" ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
