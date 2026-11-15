"use client";
import { useId, useState, useTransition } from "react";
import { setPick } from "@/app/dashboard/promos/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { PanelHeading } from "@/components/dashboard/tables/ui";
import { ctl, field, hint, quiet } from "@/components/ui-classes";
import { PageNote } from "@/components/ui-parts";

export type PickDish = { id: string; name: string; photo_thumb_url: string | null; is_pick: boolean };

function Plate({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a 44 px thumbnail already sized at upload
    <img src={url} alt="" width={44} height={44} loading="lazy" className="size-11 flex-none rounded-full bg-sand object-cover" />
  ) : (
    <span aria-hidden="true" className="size-11 flex-none rounded-full bg-sand" />
  );
}

/** Mama's picks (spec 2.11 "Your promos" 1): the picked dishes, Remove, and Add a pick. */
export function PicksCard({ dishes }: { dishes: PickDish[] }) {
  const picks = dishes.filter((d) => d.is_pick);
  const [adding, setAdding] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const reportRefusal = useReportRefusal();

  function change(d: PickDish, on: boolean) {
    if (busy) return;
    setBusy(d.id);
    start(async () => {
      const r = await setPick(d.id, on);
      setBusy(null);
      if (r.ok) {
        setNote({ text: on ? `${d.name} is a Mama’s pick.` : `Took ${d.name} off Mama’s picks.`, tone: "info" });
        if (on) setVisible(false);
        return;
      }
      setNote({ text: r.error, tone: "error" });
      if (r.stale) reportRefusal(r.error);
    });
  }

  return (
    <article aria-labelledby="picks-title" className="flex flex-col gap-3 rounded-[18px] bg-paper p-4 ring-1 ring-sand min-[600px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="picks-title" className="text-[17px] font-semibold text-ink">
          Mama’s picks
        </h2>
        <button type="button" onClick={() => (setAdding((n) => (n ?? 0) + 1), setVisible(true))} className={`${quiet} min-h-11 px-4`}>
          Add a pick
        </button>
      </div>
      <p className={hint}>Shown with a “Mama’s pick” tag and listed first in their section. Picks work best when there are only a few.</p>
      {note && <PageNote text={note.text} tone={note.tone} />}
      {picks.length === 0 ? (
        <p className="text-[15px] text-ink-soft">No picks yet.</p>
      ) : (
        <ul className="flex flex-col">
          {picks.map((d) => (
            <li key={d.id} className="flex items-center gap-3 border-t border-sand py-2 first:border-t-0">
              <Plate url={d.photo_thumb_url} />
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{d.name}</span>
              <button
                type="button"
                onClick={() => change(d, false)}
                aria-disabled={busy !== null || undefined}
                aria-label={`Remove ${d.name} from Mama’s picks`}
                className={`${ctl} inline-flex min-h-11 shrink-0 items-center rounded-[var(--r-sm)] px-3 text-[14px] font-semibold text-coral-text aria-disabled:opacity-60`}
              >
                {busy === d.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding !== null && <AddPick key={adding} open={visible} dishes={dishes.filter((d) => !d.is_pick)} busy={busy} onPick={(d) => change(d, true)} onClose={() => setVisible(false)} />}
    </article>
  );
}

function AddPick({ open, dishes, busy, onPick, onClose }: { open: boolean; dishes: PickDish[]; busy: string | null; onPick: (d: PickDish) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const needle = q.trim().toLocaleLowerCase("en-KE");
  const shown = needle ? dishes.filter((d) => d.name.toLocaleLowerCase("en-KE").includes(needle)) : dishes;
  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="add-pick-title">
      <PanelHeading id="add-pick-title" title="Add a pick" sub="Your dishes that aren’t archived." onClose={onClose} />
      <div className="mt-5 flex flex-col gap-3 pb-2">
        <label htmlFor={searchId} className="sr-only">
          Find a dish
        </label>
        <input
          id={searchId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a dish"
          autoComplete="off"
          enterKeyHint="search"
          className={field}
        />
        {shown.length === 0 ? (
          <p className="text-[15px] text-ink-soft">{dishes.length === 0 ? "Every dish is already a pick." : `No dish matches “${q.trim()}”.`}</p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-[var(--r-md)] bg-paper ring-1 ring-sand">
            {shown.map((d) => (
              <li key={d.id} className="border-t border-sand first:border-t-0">
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  aria-disabled={busy !== null || undefined}
                  className={`${ctl} flex min-h-14 w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-cream aria-disabled:opacity-60`}
                >
                  <Plate url={d.photo_thumb_url} />
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{d.name}</span>
                  <span className="shrink-0 text-[14px] font-semibold text-teal-deep">{busy === d.id ? "Adding…" : "Add"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PlannerSheet>
  );
}
