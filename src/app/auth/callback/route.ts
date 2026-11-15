import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// spec-2.6 "Build notes": the sign-in, invite and reset links land here. `next` is followed only as a
// path on this site, and an invite or reset passes its `type` on so Set your password picks its
// heading. The link can arrive three ways, depending on how it was made and the email template:
//   ?code=…              a link this browser asked for (PKCE): exchanged here;
//   ?token_hash=…&type=  a template that sends the token hash: verified here;
//   #access_token=…      an invite or a generated link (implicit): the #fragment never reaches the
//                        server, and a redirect keeps it, so /auth/finish reads it in the browser.
// Redirects are relative: the browser stays on the host it came in on (its session cookie is per
// host), and a relative Location keeps the #fragment as an absolute one does.
const go = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

const OTP_TYPES = new Set<EmailOtpType>(["invite", "recovery", "magiclink", "email", "signup", "email_change"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams;
  const asked = q.get("type");
  const failed = () => go(`/login?error=${asked === "invite" ? "invite" : "link"}`);
  const onward = (type: string | null) => {
    const next = new URL(safeNext(q.get("next")), url.origin);
    if (type === "invite" || type === "recovery") next.searchParams.set("type", type);
    return go(next.pathname + next.search);
  };

  if (q.get("error") || q.get("error_code")) return failed();

  const code = q.get("code");
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (error) console.error("[auth] code exchange failed:", error.code ?? "", error.message);
    return error ? failed() : onward(asked);
  }

  const tokenHash = q.get("token_hash");
  if (tokenHash) {
    const type = OTP_TYPES.has(asked as EmailOtpType) ? (asked as EmailOtpType) : "email";
    const { error } = await (await createClient()).auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) console.error("[auth] token hash failed:", error.code ?? "", error.message);
    return error ? failed() : onward(type);
  }

  return go(`/auth/finish${url.search}`);
}
