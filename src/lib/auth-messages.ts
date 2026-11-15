// Slice 2.6, Sign-in and passwords: every line the sign-in, forgot, set and change screens show.
export const AUTH = {
  wrong: "That email and password don’t match. Try again, or use Forgot password.",
  rate: "Too many tries. Wait a minute, then try again.",
  linkFailed: "That link has expired or was already used. Send a new one.",
  inviteFailed: "That invite has expired. Ask the owner to send it again.",
  notConfirmed: "Open the invite in your email first, then sign in.",
  linkSent: "Check your email for a link. It works for 1 hour.",
  forgotSent: "If that email is on the team, a link is on its way. It works for 1 hour.",
  offline: "Couldn’t reach the kitchen system. Check your connection and try again.",
  short: "Use at least 8 characters.",
  mismatch: "The two passwords don’t match.",
  sameAsTemp: "Choose a different password from the one you were given.",
  sameAsNow: "That’s already your password. Choose a new one.",
  weak: "That password is too easy to guess. Try a longer one.",
  wrongCurrent: "That isn’t your current password.",
  noCurrent: "Enter your current password.",
  signInAgain: "For your safety, sign out and sign in again, then change it.",
  saveFailed: "Couldn’t save the password. Try again.",
  signedOut: "You’re signed out. Sign in again and retry.",
} as const;

export const MIN_PASSWORD = 8;

type AuthErr = { code?: string; status?: number; message?: string } | null | undefined;

/** Supabase's rate-limit refusals, whichever form they take. */
export const isRateLimited = (e: AuthErr) =>
  !!e && (e.status === 429 || /^over_(request|email_send|sms_send)_rate_limit$/.test(e.code ?? "") || /after \d+ seconds/.test(e.message ?? ""));

/** The line for a refused new password, or null when it's not one of the known refusals. */
export function newPasswordRefusal(e: AuthErr, forced: boolean): string | null {
  if (!e) return null;
  if (e.code === "weak_password") return AUTH.weak;
  if (e.code === "same_password") return forced ? AUTH.sameAsTemp : AUTH.sameAsNow;
  if (e.code === "reauthentication_needed") return AUTH.signInAgain;
  if (isRateLimited(e)) return AUTH.rate;
  return null;
}
