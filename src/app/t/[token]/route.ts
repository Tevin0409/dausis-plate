import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLE_COOKIE } from "@/lib/table-cookie";

// The URL printed in each table's QR code: /t/<qr_token>
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_table", { p_token: token });
  const table = data?.[0];

  const res = NextResponse.redirect(new URL("/", request.url));
  if (table) {
    res.cookies.set(TABLE_COOKIE, JSON.stringify({ token, label: table.label }), {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 4,
      path: "/",
    });
  }
  return res;
}
