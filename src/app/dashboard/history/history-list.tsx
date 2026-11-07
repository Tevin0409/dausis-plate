"use client";
import { useState, useTransition } from "react";
import { timeLabel } from "@/lib/format";
import { byDay, dayHeading, sentence, type ChangeRow, type Piece } from "@/lib/history";
import { olderHistory } from "./actions";

function Pieces({ pieces }: { pieces: Piece[] }) {
  return pieces.map((p, i) => {
    if (!p.bold) return p.text;
    if (!p.nowrap) return <strong key={i} className="font-semibold">{p.text}</strong>;
    // An order code ("DP-0107") never breaks; the customer's name after it can wrap.
    const cut = p.text.indexOf(" ");
    const [code, after] = cut < 0 ? [p.text, ""] : [p.text.slice(0, cut), p.text.slice(cut)];
    return (
      <strong key={i} className="font-semibold">
        <span className="whitespace-nowrap">{code}</span>
        {after}
      </strong>
    );
  });
}

/** The record by Nairobi day, with sticky day headers and "Show older" in steps of 50. */
export function HistoryList({
  initial,
  more: initialMore,
  params,
  today,
}: {
  initial: ChangeRow[];
  more: boolean;
  params: { area?: string; who?: string };
  today: string;
}) {
  const [rows, setRows] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function older() {
    const last = rows.at(-1);
    if (!last) return;
    setError(null);
    start(async () => {
      const res = await olderHistory(params, last.id).catch(() => null);
      if (!res || "error" in res) {
        setError(res?.error ?? "Couldn’t load older changes. Try again.");
        return;
      }
      setRows((r) => [...r, ...res.rows]);
      setMore(res.more);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {byDay(rows).map((g) => (
        <section key={g.day} aria-labelledby={`day-${g.day}`}>
          {/* Sticky at the top of the scroll, below the notch; the tab bar is at the foot. */}
          <h2 id={`day-${g.day}`} className="sticky top-[env(safe-area-inset-top,0px)] z-10 bg-cream py-2 text-[15px] font-bold">
            {dayHeading(g.day, today)}
          </h2>
          <ol className="rounded-[var(--r-md)] bg-paper px-4 shadow-[var(--shadow-card)]">
            {g.rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-t border-sand py-3 first:border-t-0">
                <time dateTime={r.at} className="pt-px text-[13px] font-semibold tabular-nums text-ink-soft">
                  {timeLabel(r.at)}
                </time>
                <p className="text-[15px] leading-[1.45] [overflow-wrap:anywhere]">
                  <Pieces pieces={sentence(r)} />
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {more && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={older}
            disabled={pending}
            className="press min-h-11 rounded-xl border-[1.5px] border-line-deep bg-paper px-5 text-[15px] font-semibold text-ink touch-manipulation select-none [-webkit-touch-callout:none] disabled:opacity-60"
          >
            {pending ? "Loading…" : "Show older"}
          </button>
          {error && (
            <p role="alert" className="note-in text-[13px] font-semibold text-coral-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
