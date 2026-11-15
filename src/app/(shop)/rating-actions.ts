"use server";
// Slice 2.10: the customer's rating, sent with the order's public token as the anon caller. The
// window, the status and "already rated" are the database's (rate_order).
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { COMMENT_MAX, COULDNT_SEND, rateRefusal, type RateResult } from "@/lib/ratings";

const input = z.object({
  token: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(COMMENT_MAX * 2), // the database refuses over 500 after trimming
});
const sent = z.object({ stars: z.number(), comment_sent: z.boolean() });

export async function rateOrder(token: string, stars: number, comment: string): Promise<RateResult> {
  const parsed = input.safeParse({ token, stars, comment });
  if (!parsed.success) return { ok: false, line: COULDNT_SEND };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_order", {
    p_token: parsed.data.token,
    p_stars: parsed.data.stars,
    p_comment: parsed.data.comment,
  });
  if (error) {
    if (error.code !== "P0001") console.error("[action] rateOrder failed:", error.code ?? "", error.message);
    return rateRefusal(error.code === "P0001" ? error.message : undefined);
  }
  const row = sent.safeParse(data);
  if (!row.success) {
    console.error("[action] rateOrder returned an unexpected shape");
    return { ok: false, line: COULDNT_SEND };
  }
  return { ok: true, stars: row.data.stars, commentSent: row.data.comment_sent };
}
