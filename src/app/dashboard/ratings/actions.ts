"use server";
// Slice 2.10: the owner's Ratings screen. The database is the gate (list_ratings, set_rating_hidden and
// reply_to_rating refuse anyone but the owner); these only word the result.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getStaff } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/result";
import { COMMENT_MAX, REPLY_FAILED, REPLY_LONG, type OwnerRating, type RatingFilter, parseFilter } from "@/lib/ratings";

type Db = Awaited<ReturnType<typeof createClient>>;

async function ownerClient(): Promise<Db | null> {
  try {
    const staff = await getStaff();
    return staff?.role === "owner" ? await createClient() : null;
  } catch {
    return null;
  }
}

function refreshRatings() {
  revalidatePath("/dashboard/ratings");
  // The dish averages on the menu move with hiding.
  revalidatePath("/", "layout");
}

export type LoadResult = { ok: true; rows: OwnerRating[] } | { ok: false };

/** The next 30, older than `before` (the last card's send time). */
export async function loadMoreRatings(show: RatingFilter, before: string): Promise<LoadResult> {
  const db = await ownerClient();
  if (!db || Number.isNaN(Date.parse(before))) return { ok: false };
  const { data, error } = await db.rpc("list_ratings", { p_show: parseFilter(show), p_before: before });
  if (error) {
    console.error("[action] loadMoreRatings failed:", error.code ?? "", error.message);
    return { ok: false };
  }
  return { ok: true, rows: data as OwnerRating[] };
}

export type HideResult = { ok: true; hidden: boolean } | { ok: false; error: string };

export async function setRatingHidden(orderId: string, hidden: boolean): Promise<HideResult> {
  const message = hidden ? "Couldn’t hide the rating. Try again." : "Couldn’t show the rating. Try again.";
  const db = await ownerClient();
  if (!db || !isUuid(orderId)) return { ok: false, error: message };
  const { data, error } = await db.rpc("set_rating_hidden", { p_order_id: orderId, p_hidden: hidden });
  if (error) {
    console.error("[action] setRatingHidden failed:", error.code ?? "", error.message);
    return { ok: false, error: message };
  }
  refreshRatings();
  return { ok: true, hidden: Boolean(data) };
}

const replyShape = z.object({ text: z.string(), replied_at: z.string() }).nullable();
export type ReplyResult = { ok: true; reply: { text: string; replied_at: string } | null } | { ok: false; error: string };

/** Empty text removes the reply. */
export async function replyToRating(orderId: string, text: string): Promise<ReplyResult> {
  if (text.trim().length > COMMENT_MAX) return { ok: false, error: REPLY_LONG };
  const db = await ownerClient();
  if (!db || !isUuid(orderId)) return { ok: false, error: REPLY_FAILED };
  const { data, error } = await db.rpc("reply_to_rating", { p_order_id: orderId, p_reply: text });
  if (error) {
    if (error.code === "P0001" && error.message === "reply_long") return { ok: false, error: REPLY_LONG };
    console.error("[action] replyToRating failed:", error.code ?? "", error.message);
    return { ok: false, error: REPLY_FAILED };
  }
  const reply = replyShape.safeParse(data);
  if (!reply.success) return { ok: false, error: REPLY_FAILED };
  revalidatePath("/dashboard/ratings");
  return { ok: true, reply: reply.data };
}
