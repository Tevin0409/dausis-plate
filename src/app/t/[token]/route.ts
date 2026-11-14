import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLE_COOKIE } from "@/lib/table-cookie";

/**
 * The URL printed in each table's QR code: /t/<qr_token>. A working code remembers the table; an
 * unknown, turned-off or replaced one forgets any old table and says so on the menu (spec-2.8b §3).
 * The redirect is relative so it stays on the host the customer scanned (new URL(…, request.url)
 * turned 127.0.0.1 into localhost in dev).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_table", { p_token: token });
  const table = data?.[0];

  const res = new NextResponse(null, { status: 303, headers: { Location: table ? "/" : "/?qr=unknown" } });
  if (table) {
    res.cookies.set(TABLE_COOKIE, JSON.stringify({ token, label: table.label, at: new Date().toISOString() }), {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 4,
      path: "/",
    });
  } else {
    res.cookies.set(TABLE_COOKIE, "", { maxAge: 0, path: "/" });
  }
  return res;
}
