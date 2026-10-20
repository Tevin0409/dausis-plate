import Image from "next/image";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { PrintButton } from "@/components/dashboard/print-button";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { formatKes } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addNamedTable, addTables, addZone, renameTable, resetTableCode, setTableActive, updateZone } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tables & delivery" };

const field = "min-h-11 rounded-xl border border-line-deep px-3 text-[15px]";
const smallBtn = "min-h-10 rounded-[10px] border border-line-deep bg-white px-3 text-sm font-semibold";

async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && /^https?:\/\//.test(configured) && !configured.includes("localhost")) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function TablesPage() {
  const supabase = await createClient();
  const origin = await siteOrigin();
  const [{ data: tables }, { data: zones }] = await Promise.all([
    supabase.from("dining_tables").select("id, label, qr_token, active").order("label"),
    supabase.from("delivery_zones").select("id, name, fee_kes, active").order("sort_order"),
  ]);

  const sorted = (tables ?? []).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const withQr = await Promise.all(
    sorted.map(async (t) => {
      const url = `${origin}/t/${t.qr_token}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a202c", light: "#0000" } });
      return { ...t, url, svg };
    }),
  );
  const active = withQr.filter((t) => t.active);

  return (
    <div className="flex max-w-[1080px] flex-col gap-8 print:max-w-none">
      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-[34px] leading-tight">Tables &amp; delivery</h1>
          <p className="mt-1 max-w-xl text-[15px] text-ink-soft">
            Each table gets its own QR code. Guests scan it, the menu opens with their table already chosen, and the order arrives on the board as dine-in.
          </p>
        </div>
        {active.length > 0 && <PrintButton label={`Print ${active.length} QR cards`} />}
      </header>

      <section aria-label="Add tables" className="flex flex-wrap items-end gap-6 rounded-[20px] border border-line bg-white p-5 print:hidden">
        <form action={addTables} className="flex items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Add numbered tables
            <input name="count" type="number" min={1} max={50} defaultValue={sorted.length ? 1 : 10} className={`${field} w-24`} />
          </label>
          <SubmitButton pendingLabel="Adding…" className="min-h-11 rounded-xl bg-teal-deep px-4 text-sm font-bold text-white">
            Add
          </SubmitButton>
        </form>
        <form action={addNamedTable} className="flex items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Or a named spot
            <input name="label" required maxLength={40} placeholder="e.g. Terrace 1, Bar" className={`${field} w-52`} />
          </label>
          <SubmitButton pendingLabel="Adding…" className="min-h-11 rounded-xl border-[1.5px] border-teal-deep bg-white px-4 text-sm font-bold text-teal-deep">
            Add
          </SubmitButton>
        </form>
      </section>

      {withQr.length === 0 ? (
        <p className="rounded-2xl bg-blush px-5 py-4 text-[15px] text-coral-ink print:hidden">No tables yet. Add them above to get their QR codes.</p>
      ) : (
        <section aria-label="Tables" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 print:grid-cols-2 print:gap-6">
          {withQr.map((t) => (
            <article
              key={t.id}
              className={`flex flex-col items-center gap-3 rounded-[22px] border border-line bg-white p-5 text-center break-inside-avoid print:rounded-none print:border-2 print:border-dashed print:p-8 ${
                t.active ? "" : "opacity-50 print:hidden"
              }`}
            >
              <div className="flex items-center gap-2">
                <Image src="/brand/dausis-plate-icon.svg" alt="" width={28} height={28} />
                <span className="font-display text-lg">Dausis Plate</span>
              </div>
              <span className="font-display text-3xl">{t.label}</span>
              <div className="w-44 print:w-56 [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label={`QR code for ${t.label}`} dangerouslySetInnerHTML={{ __html: t.svg }} />
              <span className="text-[15px] font-semibold">Scan to see the menu &amp; order</span>
              <span className="hidden font-script text-xl text-coral-text print:block">Mama’s Flavour.</span>

              <div className="mt-1 flex w-full flex-col gap-2 border-t border-line pt-3 print:hidden">
                <a href={t.url} target="_blank" rel="noreferrer" className="truncate text-xs text-teal-deep underline">{t.url.replace(/^https?:\/\//, "")}</a>
                <form action={renameTable} className="flex gap-1.5">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="label" defaultValue={t.label} aria-label={`Rename ${t.label}`} maxLength={40} className={`${field} min-w-0 flex-1`} />
                  <SubmitButton className={smallBtn}>Rename</SubmitButton>
                </form>
                <div className="flex justify-center gap-1.5">
                  <form action={setTableActive}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                    <SubmitButton className={smallBtn}>{t.active ? "Turn off" : "Turn on"}</SubmitButton>
                  </form>
                  <form action={resetTableCode}>
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton className={`${smallBtn} text-coral-ink`} aria-label={`New QR code for ${t.label}; the printed one stops working`}>
                      New code
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <section aria-label="Delivery areas" className="flex flex-col gap-4 rounded-[20px] border border-line bg-white p-5 print:hidden">
        <div>
          <h2 className="text-[17px] font-bold">Delivery areas</h2>
          <p className="text-sm text-ink-soft">Customers pick one at checkout and its fee is added to the order. Delivery can’t be chosen until at least one area is on.</p>
        </div>
        {(zones ?? []).map((z) => (
          <form key={z.id} action={updateZone} className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <input type="hidden" name="id" value={z.id} />
            <span className={`min-w-32 flex-1 font-semibold ${z.active ? "" : "text-ink-soft line-through"}`}>{z.name}</span>
            <label className="flex items-center gap-2 text-sm">
              Fee (KSh)
              <input name="fee_kes" type="number" min={0} defaultValue={z.fee_kes} className={`${field} w-24`} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <select name="active" defaultValue={z.active ? "true" : "false"} className={field}>
                <option value="true">Delivering</option>
                <option value="false">Paused</option>
              </select>
            </label>
            <SubmitButton className={smallBtn}>Save</SubmitButton>
            <span className="sr-only">Currently {formatKes(z.fee_kes)}</span>
          </form>
        ))}
        <form action={addZone} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Area
            <input name="name" required maxLength={40} placeholder="e.g. Kilimani" className={`${field} w-48`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Fee (KSh)
            <input name="fee_kes" type="number" min={0} required placeholder="150" className={`${field} w-28`} />
          </label>
          <SubmitButton pendingLabel="Adding…" className="min-h-11 rounded-xl bg-teal-deep px-4 text-sm font-bold text-white">
            Add area
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
