import "server-only";
import { cache } from "react";
import { backOnSale, menuDayOf } from "./kitchen";
import { getKitchen } from "./kitchen-server";
import { buildCombos, buildMenu, type CustomerMenuRow } from "./menu-model";
import { createClient } from "./supabase/server";
import { must } from "./supabase/result";

/**
 * The menu customers see, built once per request for the menu and the dish page (which keeps the
 * rail and the panel beside it). customer_menu() is today's menu while open and the next open
 * day's while closed, with fresh plate counts.
 */
export const loadMenu = cache(async () => {
  const supabase = await createClient();
  const [menuResult, regularsResult, optionsResult, placeResult, zonesResult, kitchen, combosResult] = await Promise.all([
    supabase.rpc("customer_menu"),
    supabase
      .from("dishes")
      .select("id, name, description, price_kes, photo_thumb_url, category, unavailable_on, sort_order, rating_count, rating_total, is_pick")
      .eq("is_regular", true)
      .eq("archived", false)
      .order("sort_order"),
    // Any choice or extra that isn't archived sends "+" to the dish page (spec-2.6).
    supabase.from("dish_options").select("dish_id").eq("archived", false),
    supabase.rpc("kitchen_place"),
    supabase.from("delivery_zones").select("name").eq("active", true).order("sort_order"),
    getKitchen(),
    // 2.11 B: combos for the menu's day, each with whether every dish in it can be ordered.
    supabase.rpc("customer_combos"),
  ]);

  // A failed read throws to error.tsx: an empty menu must mean nothing is planned, not a broken query.
  const rows = must(menuResult, "the menu") as CustomerMenuRow[];
  const regulars = must(regularsResult, "the regular menu");
  const optionDishIds = new Set(must(optionsResult, "dish options").map((o) => o.dish_id));
  const place = (must(placeResult, "the kitchen address") ?? {}) as { address?: string | null };
  const zones = must(zonesResult, "delivery areas").map((z) => z.name);
  const { status } = kitchen;

  const model = buildMenu({
    rows,
    regulars,
    optionDishIds,
    open: status.state === "open",
    today: status.today,
    menuDay: rows[0]?.menu_day ?? menuDayOf(status),
  });
  const combos = buildCombos(must(combosResult, "combos") ?? [], model);
  return { model, combos, address: place.address ?? null, zones, soldOutLine: backOnSale(status) };
});
