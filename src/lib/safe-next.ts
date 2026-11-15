// Slice 2.6, /auth/callback: only a same-site path is followed (no open redirect).
export function safeNext(next: string | null, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f\\]/.test(next)) return fallback;
  return next;
}
