import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/result";

// Slice 2.11 A: an ad view beacon. count_ad_view counts live ads only, at most 2 ids; nothing about
// the customer is stored. Always 204: a beacon has no one to tell.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && isUuid(x)) : [];
  if (ids.length > 0 && ids.length <= 2) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("count_ad_view", { p_ids: ids });
    if (error) console.error("[db] count_ad_view failed:", error.message);
  }
  return new NextResponse(null, { status: 204 });
}
