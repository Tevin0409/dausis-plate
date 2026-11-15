import { notFound, redirect } from "next/navigation";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { PromosView } from "@/components/dashboard/promos/promos-view";
import { nairobiToday } from "@/lib/format";
import type { CodeRow, ComboRow } from "@/lib/promos";
import { must } from "@/lib/supabase/result";
import { createClient, getStaff } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads & promos" };

/** spec 2.11 "Owner: Promos". Owner only; staff are sent to the board. */
export default async function PromosPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await getStaff();
  if (!staff) notFound();
  if (staff.role !== "owner") redirect("/dashboard/orders");
  const { tab } = await searchParams;

  const supabase = await createClient();
  const [ads, dishes, comboRows, showing, codeRows, figures] = await Promise.all([
    supabase.rpc("ads_overview").then((r) => must(r, "ads")),
    supabase
      .from("dishes")
      .select("id, name, price_kes, photo_thumb_url, is_pick")
      .eq("archived", false)
      .order("name")
      .then((r) => must(r, "dishes for picks")),
    supabase
      .from("combos")
      .select("id, name, price_kes, active, sort_order, combo_items (dish_id, quantity, sort_order, dishes (name, price_kes))")
      .eq("archived", false)
      .order("sort_order")
      .order("name")
      .then((r) => must(r, "combos")),
    supabase.rpc("customer_combos").then((r) => must(r, "combo status")),
    supabase
      .from("discount_codes")
      .select("id, code, kind, value, cap_kes, starts_on, ends_on, max_uses, once_per_phone, min_order_kes, modes, active")
      .order("ends_on", { ascending: false })
      .order("code")
      .then((r) => must(r, "discount codes")),
    supabase.from("code_figures").select("code_id, uses, discount_given").then((r) => must(r, "code figures")),
  ]);
  const fig = new Map(figures.map((f) => [f.code_id, f]));
  const codes: CodeRow[] = codeRows.map((c) => ({ ...c, uses: fig.get(c.id)?.uses ?? 0, discount_given: fig.get(c.id)?.discount_given ?? 0 }));
  const status = new Map(showing.map((s) => [s.combo_id, s]));
  const combos: ComboRow[] = comboRows.map((c) => {
    const items = [...c.combo_items].sort((a, b) => a.sort_order - b.sort_order);
    const s = status.get(c.id);
    return {
      id: c.id,
      name: c.name,
      price_kes: c.price_kes,
      active: c.active,
      everyday_kes: items.reduce((n, i) => n + (i.dishes?.price_kes ?? 0) * i.quantity, 0),
      parts: items.map((i) => ({ dish_id: i.dish_id, name: i.dishes?.name ?? "A dish", quantity: i.quantity })),
      showing: c.active && s ? { available: s.available, reason: s.reason } : null,
    };
  });

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 tabIndex={-1} className="font-display text-[34px] leading-tight outline-none">
          Ads &amp; promos
        </h1>
        <p className="text-[15px] text-ink-soft">Neighbour ads and your own offers.</p>
        <RefusalNote className="mt-1" />
      </header>
      <PromosView initialTab={tab === "promos" ? "promos" : "ads"} ads={ads} dishes={dishes} combos={combos} codes={codes} today={nairobiToday()} />
    </div>
  );
}
