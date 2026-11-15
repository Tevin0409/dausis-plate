import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/result";

export const dynamic = "force-dynamic";

// A route, not a page: the shop layout streams, which would turn a redirect into a client-side one
// (a 200) and break the link without JavaScript.
const ENDED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>This offer has ended · Dausis Plate</title>
<style>body{margin:0;min-height:100dvh;background:#fbf7f1;color:#1a202c;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:0 20px;text-align:center}
h1{font:600 26px/1.2 Georgia,serif;margin:0}p{color:#4a5568;margin:8px 0 24px}
a{display:inline-flex;min-height:52px;align-items:center;padding:0 24px;border-radius:16px;background:#006b66;color:#fff;font-weight:600;text-decoration:none;touch-action:manipulation}</style></head>
<body><main><h1>This offer has ended</h1><p>The neighbour’s ad isn’t showing any more.</p><a href="/">Back to the menu</a></main></body></html>`;

/**
 * An ad's web link (spec 2.11): count the tap, then a 302 to the advertiser. Only a live ad with a
 * web link has somewhere to go, so this is never an open redirect; anything else is a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let url: string | null = null;
  if (isUuid(id)) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("count_ad_tap", { p_id: id });
    if (error) console.error("[db] count_ad_tap failed:", error.message);
    if (typeof data === "string" && data.startsWith("https://")) url = data;
  }
  if (url) return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  return new NextResponse(ENDED, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
