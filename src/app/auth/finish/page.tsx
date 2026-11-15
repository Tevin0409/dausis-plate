"use client";
import { useEffect, useRef } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/lib/safe-next";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * The last step of an invite or generated link (see /auth/callback): the session is in the #fragment.
 * It is taken out of the address bar first, then kept as the cookie session, then the page moves on.
 */
export default function FinishSignIn() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const q = new URLSearchParams(window.location.search);
    const type = hash.get("type") ?? q.get("type");
    const fail = () => window.location.replace(`/login?error=${type === "invite" || q.get("type") === "invite" ? "invite" : "link"}`);
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (hash.get("error") || !access_token || !refresh_token) return fail();

    getBrowserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) return fail();
        const next = new URL(safeNext(q.get("next")), window.location.origin);
        if (type === "invite" || type === "recovery") next.searchParams.set("type", type);
        window.location.replace(next.toString());
      }, fail);
  }, []);

  return (
    <AuthShell>
      <title>Signing in</title>
      <p role="status" className="text-[15px] text-ink-soft">
        Signing you in…
      </p>
    </AuthShell>
  );
}
