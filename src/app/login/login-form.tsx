"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

type Mode = "password" | "link";

const input = "min-h-12 rounded-xl border border-line-deep px-3.5 text-base font-normal";

/** Turns Supabase auth errors into something the owner can act on. */
function explain(e: { message: string; status?: number; code?: string }): { text: string; waitSeconds?: number } {
  const wait = /after (\d+) seconds/.exec(e.message)?.[1];
  if (wait) return { text: `Please wait ${wait} seconds before asking for another link.`, waitSeconds: Number(wait) };
  if (e.code === "over_email_send_rate_limit" || e.status === 429) {
    return { text: "Too many sign-in emails were sent in the last hour. Sign in with your password instead, or try the link again in about an hour." };
  }
  if (e.code === "invalid_credentials") return { text: "That email and password don’t match. If you haven’t set a password yet, use the email link once and set one in the dashboard." };
  return { text: "Couldn’t sign in. Check your connection and try again." };
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "working" || cooldown > 0) return;
    setState("working");
    setError(null);
    const auth = getBrowserClient().auth;

    if (mode === "password") {
      const { error: err } = await auth.signInWithPassword({ email, password });
      if (err) {
        setError(explain(err).text);
        setState("idle");
        return;
      }
      router.replace(next);
      router.refresh();
      return;
    }

    const { error: err } = await auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
    });
    if (err) {
      const { text, waitSeconds } = explain(err);
      setError(text);
      if (waitSeconds) setCooldown(waitSeconds);
      setState("idle");
      return;
    }
    setState("sent");
    setCooldown(60);
  }

  if (state === "sent") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl bg-teal-tint px-4 py-3 text-[15px] text-teal-deeper">
          Check {email} for your sign-in link. <b>Open it in this same browser</b>; links opened in the Gmail app or on another device won’t sign you in.
        </p>
        <button
          type="button"
          onClick={() => {
            setState("idle");
            setMode("password");
          }}
          className="self-start text-sm font-semibold text-teal-deep"
        >
          Use a password instead
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="How to sign in" className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef2f6] p-1">
        {(
          [
            ["password", "Password"],
            ["link", "Email me a link"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
            className={`min-h-10 rounded-[10px] text-sm font-semibold ${mode === id ? "bg-white text-teal-deep shadow-sm" : "text-ink-soft"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </label>

      {mode === "password" && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </label>
      )}

      {error && <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-sm text-coral-ink">{error}</p>}

      <button type="submit" disabled={state === "working" || cooldown > 0} className="min-h-12 rounded-xl bg-teal-deep font-bold text-white disabled:opacity-60">
        {state === "working" ? "Signing in…" : cooldown > 0 ? `Try again in ${cooldown}s` : mode === "password" ? "Sign in" : "Email me a link"}
      </button>
      {mode === "link" && (
        <p className="text-xs text-ink-soft">Emails are limited to a few an hour, so use a password for everyday sign-in.</p>
      )}
    </form>
  );
}
