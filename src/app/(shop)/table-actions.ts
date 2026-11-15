"use server";
// Slice 2.9: the customer's table requests. The order page asks by its order's token (from the
// URL); the menu asks by the table cookie, read here on the server, so the browser never sends a
// table code. Every rule is the database's (request_table_help, request_waiter_at_table).
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseTableCookie, TABLE_COOKIE } from "@/lib/table-cookie";
import { askRefusal, COULDNT_SEND, waiterStatus, type AskResult, type WaiterStatus } from "@/lib/table-requests";

const ask = z.object({ token: z.string().uuid(), kind: z.enum(["waiter", "bill"]) });

/** Call waiter or Request bill from an order's status page. */
export async function askTableHelp(token: string, kind: "waiter" | "bill"): Promise<AskResult> {
  const parsed = ask.safeParse({ token, kind });
  if (!parsed.success) return { ok: false, line: COULDNT_SEND };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_table_help", { p_token: parsed.data.token, p_kind: parsed.data.kind });
  if (error || !data?.[0]) {
    if (error?.code !== "P0001") console.error("[action] askTableHelp failed:", error?.code ?? "", error?.message ?? "no row");
    return askRefusal(error?.code === "P0001" ? error.message : undefined);
  }
  return { ok: true, askedAt: data[0].asked_at, created: data[0].created };
}

async function tableToken() {
  return parseTableCookie((await cookies()).get(TABLE_COOKIE)?.value)?.token ?? null;
}

/** Call waiter from the menu at a table (Q1 B): the table comes from the cookie. */
export async function callWaiterFromMenu(): Promise<AskResult> {
  const token = await tableToken();
  if (!token) return askRefusal("request_table_gone");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_waiter_at_table", { p_qr_token: token });
  if (error || !data?.[0]) {
    if (error?.code !== "P0001") console.error("[action] callWaiterFromMenu failed:", error?.code ?? "", error?.message ?? "no row");
    return askRefusal(error?.code === "P0001" ? error.message : undefined);
  }
  return { ok: true, askedAt: data[0].asked_at, created: data[0].created };
}

/** The menu button's poll while a call is open. `undefined` when it couldn't be read (try again later). */
export async function menuWaiterStatus(): Promise<WaiterStatus | undefined> {
  const token = await tableToken();
  if (!token) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("table_waiter_status", { p_qr_token: token });
  if (error) {
    console.error("[action] menuWaiterStatus failed:", error.code ?? "", error.message);
    return undefined;
  }
  const parsed = waiterStatus.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
