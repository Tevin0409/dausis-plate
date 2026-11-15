"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { restoreDish, setOnSaleToday } from "@/app/dashboard/actions";
import { Plate } from "@/components/dashboard/planner/plate";
import { Switch } from "@/components/dashboard/switch";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { formatKes } from "@/lib/format";

export type DishRowData = {
  id: string;
  name: string;
  category: "mains" | "sides" | "breakfast" | "drinks";
  price_kes: number;
  photo: string | null;
  is_regular: boolean;
  onSale: boolean;
  archivedOn: string | null;
};

export const CATEGORY = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" } as const;

const list = "flex flex-col overflow-hidden rounded-[18px] bg-paper ring-1 ring-sand";
const rowLink =
  "press flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-deep";

const Note = ({ text, tone = "info", children }: { text: string; tone?: "info" | "error"; children?: React.ReactNode }) => (
  <p
    key={text}
    role={tone === "error" ? "alert" : "status"}
    className={`note-in flex flex-wrap items-baseline gap-x-2 rounded-[var(--r-sm)] px-4 py-3 text-[15px] ${
      tone === "error" ? "bg-blush font-semibold text-coral-ink" : "bg-teal-tint text-teal-deeper"
    }`}
  >
    <span className="[overflow-wrap:anywhere]">{text}</span>
    {children}
  </p>
);

/** One dish: plate, name, then category and price; the row opens the editor, the control sits outside the link. */
function Row({ d, sub, control }: { d: DishRowData; sub: React.ReactNode; control?: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-center border-t border-sand first:border-t-0">
      <Link href={`/dashboard/dishes/${d.id}`} className={rowLink}>
        <Plate id={d.id} photo={d.photo} size={44} dim={d.archivedOn !== null} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{d.name}</span>
          {sub}
        </span>
      </Link>
      {control && <div className="flex shrink-0 items-center pr-3">{control}</div>}
    </li>
  );
}

const meta = (d: DishRowData) => (
  <span className="text-[13px] text-ink-soft">
    {CATEGORY[d.category]} · <span className="whitespace-nowrap tabular-nums">{formatKes(d.price_kes)}</span>
  </span>
);

/** The On sale today switch on an everyday row (spec-2.2), saved at once. */
function SaleSwitch({ d, onError }: { d: DishRowData; onError: (text: string) => void }) {
  const [on, setOn] = useState(d.onSale);
  const [pending, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();
  useEffect(() => setOn(d.onSale), [d.onSale]);
  return (
    <Switch
      checked={on}
      label={`${d.name} on sale today`}
      className="min-h-11 min-w-11 justify-end"
      onChange={(v) => {
        if (pending) return;
        setOn(v);
        startTransition(async () => {
          const r = await setOnSaleToday(d.id, v);
          if (r?.error) {
            setOn(!v);
            onError(r.error);
            if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
          }
        });
      }}
    />
  );
}

/** Everyday menu: grouped by category, each with its On sale today switch. */
export function EverydayList({ dishes, canAdd }: { dishes: DishRowData[]; canAdd: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (dishes.length === 0) {
    return (
      <div className={`${list} items-start gap-3 p-5`}>
        <p className="text-[15px] text-ink-soft">Nothing on the everyday menu yet. Dishes here are on sale every day the kitchen is open.</p>
        {canAdd && <AddDish href="/dashboard/dishes/new?regular=1" />}
      </div>
    );
  }
  const groups = (Object.keys(CATEGORY) as (keyof typeof CATEGORY)[])
    .map((c) => ({ c, rows: dishes.filter((d) => d.category === c) }))
    .filter((g) => g.rows.length > 0);
  return (
    <div className="flex flex-col gap-5">
      {error && <Note text={error} tone="error" />}
      {groups.map((g) => (
        <section key={g.c} aria-labelledby={`cat-${g.c}`} className="flex flex-col gap-2">
          <h2 id={`cat-${g.c}`} className="text-[15px] font-bold">
            {CATEGORY[g.c]}
          </h2>
          <ul className={list}>
            {g.rows.map((d) => (
              <Row
                key={d.id}
                d={d}
                sub={
                  <>
                    {meta(d)}
                    {!d.onSale && <span className="text-[13px] font-semibold text-amber-ink">Off today · back on tomorrow</span>}
                  </>
                }
                control={<SaleSwitch d={d} onError={setError} />}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** All dishes: every dish that isn't archived, A to Z, with a search once there are more than 12. */
export function AllList({ dishes }: { dishes: DishRowData[] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query ? dishes.filter((d) => d.name.toLowerCase().includes(query)) : dishes;
  return (
    <div className="flex flex-col gap-3">
      {dishes.length > 12 && (
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Find a dish</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a dish"
            enterKeyHint="search"
            autoComplete="off"
            className="min-h-12 w-full rounded-xl border border-line-deep bg-paper px-3.5 text-base"
          />
        </label>
      )}
      {dishes.length === 0 ? (
        <p className={`${list} p-5 text-[15px] text-ink-soft`}>No dishes yet.</p>
      ) : shown.length === 0 ? (
        <p role="status" className="text-[15px] text-ink-soft [overflow-wrap:anywhere]">
          No dish called “{q.trim()}”.
        </p>
      ) : (
        <ul className={list}>
          {shown.map((d) => (
            <Row
              key={d.id}
              d={d}
              sub={
                <>
                  {meta(d)}
                  <span className="text-[13px] text-ink-soft">{d.is_regular ? "Everyday" : "Planned days"}</span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

const RESTORED = (name: string) => `${name} is back in your dishes. Put it on the everyday menu or plan it to sell it again.`;

function useRestore() {
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();
  function restore(id: string) {
    setBusy(id);
    startTransition(async () => {
      const r = await restoreDish(id);
      setBusy(null);
      if ("error" in r) {
        setNote({ text: r.error, tone: "error" });
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
      } else setNote({ text: RESTORED(r.name), tone: "info" });
    });
  }
  return { note, busy, restore };
}

const restoreBtn =
  "press min-h-11 rounded-[var(--r-sm)] border-[1.5px] border-line-deep bg-paper px-3.5 text-sm font-semibold text-teal-deep touch-manipulation select-none disabled:opacity-60";

/** Archived (owner): newest first, each with the day it was archived and Restore. */
export function ArchivedList({ dishes }: { dishes: DishRowData[] }) {
  const { note, busy, restore } = useRestore();
  return (
    <div className="flex flex-col gap-3">
      {note && <Note text={note.text} tone={note.tone} />}
      {dishes.length === 0 ? (
        <p className={`${list} p-5 text-[15px] text-ink-soft`}>Nothing archived. Dishes with past orders are archived here when you delete them.</p>
      ) : (
        <ul className={list}>
          {dishes.map((d) => (
            <Row
              key={d.id}
              d={d}
              sub={
                <>
                  {meta(d)}
                  {d.archivedOn && <span className="text-[13px] text-ink-soft">Archived {shortDay(d.archivedOn)}</span>}
                </>
              }
              control={
                <button type="button" onClick={() => restore(d.id)} disabled={busy !== null} aria-label={`Restore ${d.name}`} className={restoreBtn}>
                  {busy === d.id ? "Restoring…" : "Restore"}
                </button>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * After Delete in the editor: "Pilau deleted." or "Pilau archived. Restore". The URL loses its
 * note at once, so a reload or Back doesn't repeat it, and Restore works until the page is left.
 */
export function DoneNote({ done, dishId, name }: { done: "deleted" | "archived"; dishId: string; name: string }) {
  const { note, busy, restore } = useRestore();
  useEffect(() => {
    const url = new URL(window.location.href);
    ["done", "dish", "name"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", url);
  }, []);
  if (note) return <Note text={note.text} tone={note.tone} />;
  if (done === "deleted") return <Note text={`${name} deleted.`} />;
  return (
    <Note text={`${name} archived.`}>
      <button type="button" onClick={() => restore(dishId)} disabled={busy !== null} className="press min-h-11 font-semibold underline underline-offset-2 touch-manipulation select-none disabled:opacity-60">
        {busy ? "Restoring…" : "Restore"}
      </button>
    </Note>
  );
}

export function AddDish({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="press inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-sm)] bg-teal-deep px-4 text-sm font-bold text-paper touch-manipulation select-none"
    >
      <span aria-hidden="true" className="text-lg leading-none">+</span> Add a dish
    </Link>
  );
}
