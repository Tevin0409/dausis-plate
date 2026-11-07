"use server";
import type { ChangeRow } from "@/lib/history";
import { createClient, getStaff } from "@/lib/supabase/server";
import { readFilters, readHistory } from "./query";

export type OlderResult = { rows: ChangeRow[]; more: boolean } | { error: string };

const FAILED = "Couldn’t load older changes. Try again.";

/** "Show older": the next 50 below the last one shown, with the same filters. */
export async function olderHistory(params: { area?: string; who?: string }, before: number): Promise<OlderResult> {
  if (!Number.isSafeInteger(before) || before < 1) return { error: FAILED };
  try {
    const staff = await getStaff();
    if (staff?.role !== "owner") return { error: "Only the owner can see the history." };
  } catch {
    return { error: FAILED };
  }
  const result = await readHistory(await createClient(), readFilters(params), before);
  if (!result.ok) {
    console.error("[action] olderHistory failed:", result.error.code ?? "", result.error.message);
    return { error: FAILED };
  }
  return { rows: result.rows, more: result.more };
}
