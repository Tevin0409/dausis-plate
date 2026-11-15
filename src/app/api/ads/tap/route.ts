import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/result";

// Slice 2.11 A: a tap on an ad's phone link (web links count in /a/[id]). Live ads only.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && isUuid(body.id) ? body.id : null;
  if (id) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("count_ad_tap", { p_id: id });
    if (error) console.error("[db] count_ad_tap failed:", error.message);
  }
  return new NextResponse(null, { status: 204 });
}
