import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { TablesView } from "@/components/dashboard/tables/tables-view";
import { ZonesView } from "@/components/dashboard/tables/zones-view";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";
import { siteOrigin } from "@/lib/site-origin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tables & delivery" };

type View = "tables" | "zones";
type Db = Awaited<ReturnType<typeof createClient>>;

/** spec-2.6 "Tables & delivery": Tables · Delivery zones (`?view=zones`); Print this card uses `?only=<id>`. */
export default async function TablesPage({ searchParams }: { searchParams: Promise<{ view?: string; only?: string }> }) {
  const staff = await getStaff();
  if (!staff) notFound();
  const q = await searchParams;
  const view: View = q.view === "zones" ? "zones" : "tables";
  // Without Tables and delivery, the QR cards and Print stay; everything that changes them goes (spec-2.3).
  const edits = can(staff, "tables_delivery");
  const supabase = await createClient();

  const segments: [View, string][] = [
    ["tables", "Tables"],
    ["zones", "Delivery zones"],
  ];

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-5 print:max-w-none">
      <header className="flex flex-col gap-4 print:hidden">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] leading-tight">Tables &amp; delivery</h1>
          <RefusalNote className="mt-1" />
        </div>
        <nav aria-label="Tables and delivery views" className="grid max-w-[420px] grid-cols-2 gap-1 rounded-[14px] bg-sand p-1">
          {segments.map(([v, text]) => (
            <Link
              key={v}
              href={v === "tables" ? "/dashboard/tables" : "/dashboard/tables?view=zones"}
              aria-current={view === v ? "page" : undefined}
              className={`press flex min-h-11 items-center justify-center rounded-[10px] px-2 text-center text-sm font-semibold leading-tight touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-teal-deep ${
                view === v ? "bg-paper text-teal-deep shadow-[0_1px_2px_rgb(26_32_44/0.08)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {text}
            </Link>
          ))}
        </nav>
        {!edits && <p className="text-sm text-ink-soft">{OWNER_ONLY.tables_delivery}</p>}
      </header>

      {view === "tables" ? <Tables supabase={supabase} edits={edits} only={q.only ?? null} /> : <Zones supabase={supabase} edits={edits} />}
    </div>
  );
}

async function Tables({ supabase, edits, only }: { supabase: Db; edits: boolean; only: string | null }) {
  const origin = await siteOrigin();
  // A failed read throws to error.tsx (with Try again) instead of looking like "no tables yet".
  const tables = must(await supabase.from("dining_tables").select("id, label, qr_token, active"), "tables");
  tables.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const cards = await Promise.all(
    tables.map(async (t) => {
      const url = `${origin}/t/${t.qr_token}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a202c", light: "#0000" } });
      return { id: t.id, label: t.label, url, svg, active: t.active };
    }),
  );
  const onlyId = only && cards.some((c) => c.id === only) ? only : null;
  return <TablesView tables={cards} edits={edits} only={onlyId} />;
}

async function Zones({ supabase, edits }: { supabase: Db; edits: boolean }) {
  const zones = must(await supabase.from("delivery_zones").select("id, name, fee_kes, min_order_kes, active").order("sort_order"), "delivery zones");
  return <ZonesView zones={zones} edits={edits} />;
}
