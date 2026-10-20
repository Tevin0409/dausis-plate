"use client";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await getBrowserClient().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return <p className="rounded-xl bg-teal-tint px-4 py-3 text-[15px] text-teal-deeper">Check {email} for your sign-in link.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-12 rounded-xl border border-line-deep px-3.5 text-base font-normal"
        />
      </label>
      {state === "error" && <p role="alert" className="text-sm text-coral-ink">Couldn’t send the link. Try again.</p>}
      <button type="submit" disabled={state === "sending"} className="min-h-12 rounded-xl bg-teal-deep font-bold text-white disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}
