"use client";
import { useId, useRef, useState, useTransition } from "react";
import { addDays, closedDateLabel } from "@/lib/format";
import { addClosedDate, removeClosedDate, restoreClosedDate } from "./actions";
import { btnLink, btnPrimary, errorText, field, hint, tile, tileHeading } from "./ui";

export type ClosedDate = { day: string; note: string | null };

type Row = ClosedDate & { removed?: boolean; fresh?: boolean; note2?: string };

export function ClosedDates({ initial, today, canEdit }: { initial: ClosedDate[]; today: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ day: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const dayRef = useRef<HTMLInputElement>(null);
  const tomorrow = addDays(today, 1);

  const sort = (rs: Row[]) => [...rs].sort((a, b) => a.day.localeCompare(b.day));

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!day) {
      setError("Pick a date from tomorrow on.");
      dayRef.current?.focus();
      return;
    }
    const chosen = day;
    const text = note.trim();
    start(async () => {
      const res = await addClosedDate(chosen, text).catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Couldn’t save that. Try again.");
        dayRef.current?.focus();
        return;
      }
      setRows((rs) => sort([...rs.filter((r) => r.day !== chosen), { day: chosen, note: text || null, fresh: true, note2: res.note }]));
      setDay("");
      setNote("");
    });
  }

  function remove(r: Row) {
    setRowError(null);
    start(async () => {
      const res = await removeClosedDate(r.day).catch(() => null);
      if (!res?.ok) return setRowError({ day: r.day, text: "Couldn’t save that. Try again." });
      setRows((rs) => rs.map((x) => (x.day === r.day ? { ...x, removed: true, fresh: false, note2: undefined } : x)));
    });
  }

  function undo(r: Row) {
    setRowError(null);
    start(async () => {
      const res = await restoreClosedDate(r.day, r.note).catch(() => null);
      if (!res?.ok) return setRowError({ day: r.day, text: "Couldn’t save that. Try again." });
      setRows((rs) => rs.map((x) => (x.day === r.day ? { ...x, removed: false, fresh: true } : x)));
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        Closed dates
      </h2>
      <p className={`${hint} mt-1`}>Holidays and days off. Customers see the next day you open.</p>

      {rows.length === 0 ? (
        <p className="mt-4 text-[15px] text-ink-soft">No closed dates coming up.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((r) => {
            const label = closedDateLabel(r.day, today);
            const err = rowError?.day === r.day ? rowError.text : null;
            return (
              <li key={r.day} className={`border-t border-sand py-3 first:border-t-0 ${r.fresh ? "note-in" : ""}`}>
                {r.removed ? (
                  <div className="flex flex-wrap items-center gap-x-1 text-[15px] text-ink-soft">
                    <span>{label} removed</span>
                    {canEdit && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button type="button" onClick={() => undo(r)} disabled={pending} className={btnLink}>
                          Undo<span className="sr-only"> removing {label}</span>
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold tabular-nums">{label}</p>
                      {r.note && <p className="mt-0.5 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{r.note}</p>}
                    </div>
                    {canEdit && (
                      <button type="button" onClick={() => remove(r)} disabled={pending} className={`${btnLink} -my-1.5 flex-none`}>
                        Remove<span className="sr-only"> {label}</span>
                      </button>
                    )}
                  </div>
                )}
                {r.note2 && !r.removed && <p className="mt-1.5 text-[14px] font-semibold text-ink">{r.note2}</p>}
                {err && (
                  <p role="alert" className={`${errorText} mt-1.5`}>
                    {err}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={add} noValidate className="mt-4 flex flex-col gap-3 border-t border-sand pt-4 min-[600px]:grid min-[600px]:grid-cols-[minmax(10.5rem,1fr)_minmax(0,1.4fr)_auto] min-[600px]:items-start">
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
            Date
            <input
              ref={dayRef}
              type="date"
              min={tomorrow}
              value={day}
              onChange={(e) => (setError(null), setDay(e.target.value))}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
              className={field}
            />
            {/* Under the field it's about (spec-2.2 "Closed dates" cases). */}
            {error && (
              <span key={error} id={`${id}-err`} role="alert" className={errorText}>
                {error}
              </span>
            )}
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
            Note (optional)
            <input
              type="text"
              maxLength={120}
              value={note}
              placeholder="Christmas Day"
              onChange={(e) => setNote(e.target.value)}
              aria-describedby={`${id}-nh`}
              className={field}
            />
            <span id={`${id}-nh`} className="font-normal">
              Only you and staff see this.
            </span>
          </label>
          <button type="submit" disabled={pending} className={`${btnPrimary} min-[600px]:mt-[22px]`}>
            {pending ? "Adding…" : "Add"}
          </button>
        </form>
      )}
    </section>
  );
}
