"use client";
import { useState, useTransition } from "react";
import { setOptionOut } from "@/app/dashboard/actions";
import { Switch } from "@/components/dashboard/switch";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { optionPriceLabel, type OptionKind } from "@/lib/dish-options";

/** A saved choice or extra as the editor reads it. */
export type SavedOption = { id: string; kind: OptionKind; label: string; extra: number; isDefault: boolean; outToday: boolean };

type Note = { text: string; error?: boolean };

/**
 * Out today (Q3 B): anyone on the team, saved at once, for today only. Holds which saved options
 * are out, the note after the last switch, and whether every choice is out.
 */
export function useOptionOut(dishName: string, options: readonly SavedOption[]) {
  const [out, setOut] = useState<Record<string, boolean>>(() => Object.fromEntries(options.map((o) => [o.id, o.outToday])));
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();

  function toggle(id: string, label: string, on: boolean) {
    setOut((m) => ({ ...m, [id]: on }));
    setBusy(id);
    startTransition(async () => {
      const r = await setOptionOut(id, on);
      setBusy(null);
      if ("error" in r) {
        setOut((m) => ({ ...m, [id]: !on }));
        setNote({ text: r.error, error: true });
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
        return;
      }
      setNote({ text: on ? `${label} is out today for ${dishName}. It’s back tomorrow.` : `${label} is back on for ${dishName}.` });
    });
  }

  const choices = options.filter((o) => o.kind === "choice");
  const allChoicesOut = choices.length > 0 && choices.every((c) => out[c.id]);
  return { out, toggle, note, busy, allChoicesOut };
}

/** The switch at the end of a choice or extra row. */
export function OutTodaySwitch({ label, on, busy, onChange }: { label: string; on: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <Switch
      checked={on}
      onChange={(v) => !busy && onChange(v)}
      label={`${label || "This option"} out today`}
      className="min-h-11 shrink-0 gap-2 pl-1 text-[13px] font-semibold text-ink-soft"
    >
      <span className="sr-only">{`${label || "This option"} out today`}</span>
      <span aria-hidden="true">Out today</span>
    </Switch>
  );
}

/** The note under the lists, and the line when every choice is out. */
export function OutNotes({ dishName, note, allChoicesOut }: { dishName: string; note: Note | null; allChoicesOut: boolean }) {
  return (
    <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
      {allChoicesOut && (
        <p className="note-in rounded-[var(--r-sm)] bg-amber-tint px-3 py-2 text-[13px] font-semibold text-amber-ink">
          Every choice is out today, so customers see {dishName} as sold out.
        </p>
      )}
      {note && (
        <p key={note.text} role={note.error ? "alert" : undefined} className={`note-in text-[13px] ${note.error ? "font-semibold text-coral-ink" : "text-ink-soft"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

/** Without Dishes and prices: the options as text, each with its Out today switch. */
export function OptionsReadOnly({ dishName, options }: { dishName: string; options: SavedOption[] }) {
  const { out, toggle, note, busy, allChoicesOut } = useOptionOut(dishName, options);
  if (options.length === 0) return null;
  const list = (kind: OptionKind, title: string) => {
    const rows = options.filter((o) => o.kind === kind);
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink-soft">{title}</h3>
        <ul className="flex flex-col">
          {rows.map((o) => (
            <li key={o.id} className="flex min-h-12 items-center gap-3 border-t border-sand first:border-t-0">
              <span className={`min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere] ${out[o.id] ? "text-ink-soft" : ""}`}>
                {o.label} · <span className="tabular-nums">{optionPriceLabel(o.extra)}</span>
              </span>
              <OutTodaySwitch label={o.label} on={!!out[o.id]} busy={busy === o.id} onChange={(v) => toggle(o.id, o.label, v)} />
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-4 border-t border-sand pt-[18px]">
      {list("choice", "Comes with")}
      {list("extra", "Extras")}
      <OutNotes dishName={dishName} note={note} allChoicesOut={allChoicesOut} />
    </div>
  );
}
