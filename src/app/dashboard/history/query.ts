import type { createClient } from "@/lib/supabase/server";
import { AREAS, HISTORY_COLUMNS, PAGE, type Area, type ChangeRow } from "@/lib/history";
import { isUuid } from "@/lib/supabase/result";

type Db = Awaited<ReturnType<typeof createClient>>;
export type Filters = { area: Area | null; who: string | null };

/** The URL's filters, with anything unknown dropped (spec-2.3: `?area=menu&who=<id>`). */
export function readFilters(params: { area?: string; who?: string }): Filters {
  const area = AREAS.find((a) => a === params.area) ?? null;
  const who = params.who && isUuid(params.who) ? params.who : null;
  return { area, who };
}

/**
 * One page of the record, newest first, keyset on id. All (no area) leaves out order moves (4B);
 * Orders shows them. One extra row says whether "Show older" has anything to show.
 */
export async function readHistory(db: Db, { area, who }: Filters, before: number | null) {
  let q = db.from("change_log").select(HISTORY_COLUMNS).order("id", { ascending: false }).limit(PAGE + 1);
  q = area ? q.eq("area", area) : q.neq("action", "order.move");
  if (who) q = q.eq("actor", who);
  if (before !== null) q = q.lt("id", before);
  const { data, error } = await q;
  if (error) return { ok: false, error } as const;
  const rows = data as ChangeRow[];
  return { ok: true, rows: rows.slice(0, PAGE), more: rows.length > PAGE } as const;
}
