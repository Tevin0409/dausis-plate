"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { copyDay, removeEntry, restoreEntry, type CopyResult } from "@/app/dashboard/actions";
import type { Undo } from "@/app/dashboard/action-result";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { addDays, formatKes, hhmm, weekdayName, weekStart } from "@/lib/format";
import {
  dayTitle,
  daysLabel,
  hoursLabel,
  n,
  platesLabel,
  soldLine,
  statusLine,
  tileHead,
  weekLabel,
  copyPriceLine,
} from "@/lib/planner";
import { PlannerPanel, type PanelMode, type PanelOutcome } from "./panel";
import { Plate } from "./plate";
import { entryDays, runsOn, type PlannerData, type PlannerDay, type PlannerEntry } from "./types";

/** 1280 tiles with more than COLLAPSE_OVER day dishes show the first COLLAPSE_SHOW and a “+N more” button. */
const COLLAPSE_OVER = 6;
const COLLAPSE_SHOW = 5;

// Slice 2.5: the menu planner (spec-2.5-menu-planner.md "Layouts"). Three layouts of the same week:
// seven tiles from 1280, one row per day from 600, one day at a time below 600. Only one is shown
// (display), so the others are out of the accessibility tree. The panel and the phone's day live in
// the URL (?day=, ?add=, ?entry=) through history.pushState, so Back closes the panel without a
// server round trip and a refresh keeps it.

const REFRESH_AFTER_REFUSAL_MS = 3000;
const ctl = "press touch-manipulation select-none [-webkit-touch-callout:none]";
const addBtn = `${ctl} flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--r-sm)] border-[1.5px] border-dashed border-sand-deep px-3 text-[14px] font-bold text-teal-deeper`;
const quietBtn = `${ctl} flex min-h-11 items-center justify-center rounded-[var(--r-sm)] bg-cream px-3 text-[13px] font-semibold text-ink ring-1 ring-sand-deep ring-inset disabled:opacity-60`;
const noteCls = "note-in flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ink";
const undoBtn = `${ctl} -my-1 min-h-11 px-1 text-[13px] font-bold text-teal-deeper underline underline-offset-4`;
const hoverBlush = "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-blush-deep";

type Note = { key: string; place: string; text: string; undo?: { name: string; kind: "day" | "week"; undo: Undo } };

const closedLine = "Customers won’t see these while it’s closed.";

export function Planner({ data }: { data: PlannerData }) {
  const { today, monday, days, entries } = data;
  const params = useSearchParams();
  const pathname = usePathname();
  const reportRefusal = useReportRefusal();
  const sunday = days[6]!.day;
  const thisWeek = weekStart(today) === monday;
  const readOnly = sunday < today;

  // ── URL state: the phone's day, and the panel.
  const dayParam = params.get("day");
  const inWeek = (d: string | null): d is string => !!d && d >= monday && d <= sunday;
  const selected = inWeek(dayParam) ? dayParam : thisWeek ? today : monday;
  const pushed = useRef(false);

  function go(next: Record<string, string | null>, mode: "push" | "replace") {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const url = `${pathname}?${q.toString()}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }
  const pickDay = (d: string) => go({ day: d, add: null, entry: null }, "replace");
  const openPanel = (p: { add?: "day" | "week"; entry?: string; day: string }) => {
    pushed.current = true;
    go({ day: p.day, add: p.add ?? null, entry: p.entry ?? null }, "push");
  };
  const closePanel = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else go({ add: null, entry: null }, "replace");
  };
  useEffect(() => {
    const onPop = () => (pushed.current = false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const dayOf = (d: string) => days.find((w) => w.day === d);
  const canAddOn = (d: PlannerDay) => !readOnly && d.day >= today && d.hours !== null;
  const editable = (e: PlannerEntry) => !readOnly && e.endsOn >= today;

  const urlMode: PanelMode | null = (() => {
    if (readOnly) return null;
    const add = params.get("add");
    const entryId = params.get("entry");
    if (entryId) {
      const e = entries.find((x) => x.id === entryId);
      return e && editable(e) ? { kind: "edit", entry: e, day: inWeek(dayParam) && dayParam >= today ? dayParam : today > monday ? today : monday } : null;
    }
    if (add === "week") return days.some((d) => canAddOn(d)) ? { kind: "add", entryKind: "week", day: selected >= today ? selected : today } : null;
    if (add === "day") {
      const d = dayOf(selected);
      return d && canAddOn(d) ? { kind: "add", entryKind: "day", day: d.day } : null;
    }
    return null;
  })();
  const modeKey = (m: PanelMode | null) => (m === null ? "" : m.kind === "edit" ? `edit:${m.entry.id}` : `add:${m.entryKind}:${m.day}`);

  // The panel keeps its last mode while it leaves, and starts fresh each time it opens.
  const [session, setSession] = useState<{ mode: PanelMode | null; n: number; open: boolean }>({ mode: urlMode, n: 0, open: urlMode !== null });
  if ((urlMode !== null) !== session.open || (urlMode !== null && modeKey(urlMode) !== modeKey(session.mode))) {
    setSession((s) => (urlMode ? { mode: urlMode, n: s.n + 1, open: true } : { ...s, open: false }));
  }

  // ── Notes in place (removed · Undo, copy results), kept until the page is left.
  const [notes, setNotes] = useState<Note[]>([]);
  const addNote = (note: Omit<Note, "key">) => setNotes((ns) => [...ns.filter((x) => !(x.place === note.place && x.undo && note.undo && x.undo.name === note.undo.name)), { ...note, key: crypto.randomUUID() }]);
  const dropNote = (key: string) => setNotes((ns) => ns.filter((x) => x.key !== key));
  const setNoteText = (key: string, text: string) => setNotes((ns) => ns.map((x) => (x.key === key ? { key, place: x.place, text } : x)));

  const placeOf = (undo: Undo) => (undo.did === "ended" ? "week" : undo.day);

  function onDone(o: PanelOutcome) {
    if (o.type === "removed") addNote({ place: placeOf(o.undo), text: `${o.name} removed`, undo: { name: o.name, kind: o.entryKind, undo: o.undo } });
    if (o.type === "gone") addNote({ place: o.day, text: o.text });
  }

  // ── Dishes just added or copied enter in their new place (same week only).
  const seen = useRef<{ monday: string; ids: Set<string> } | null>(null);
  const fresh = new Set(seen.current && seen.current.monday === monday ? entries.filter((e) => !seen.current!.ids.has(e.id)).map((e) => e.id) : []);
  useEffect(() => {
    seen.current = { monday, ids: new Set(entries.map((e) => e.id)) };
  }, [monday, entries]);

  // ── Actions from the page itself: copy, remove a week dish from one day, undo.
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  // 1280 tiles with more than 6 day dishes show 5 and "+N more dishes" (follow-ups item 3); a tile
  // opened in place stays open until the week changes.
  // The closed-date notes opened in place (item 7) share it, keyed "note:<day>".
  const [shown, setShown] = useState<{ monday: string; days: Set<string> }>({ monday, days: new Set() });
  // Leaving the week closes them again, even when coming back to it.
  if (shown.monday !== monday) setShown({ monday, days: new Set() });
  const opened = (k: string) => shown.monday === monday && shown.days.has(k);
  const openIn = (...ks: string[]) => setShown((s) => ({ monday, days: new Set([...(s.monday === monday ? s.days : []), ...ks]) }));
  const showAll = opened;
  function run(key: string, job: () => Promise<void>) {
    setBusy(key);
    start(async () => {
      await job();
      setBusy(null);
    });
  }
  const stale = (r: { stale?: boolean; error: string }) => r.stale && setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);

  function copy(from: string, to: string, label: string) {
    run(`copy:${from}:${to}`, async () => {
      const r = await copyDay({ from, to });
      if (!r.ok) {
        addNote({ place: to, text: r.error });
        stale(r);
        return;
      }
      if (r.copy) addNote({ place: to, text: copyText(r.copy, label, dayOf(to)!) });
    });
  }
  function removeOneDay(e: PlannerEntry, day: string) {
    run(`off:${e.id}:${day}`, async () => {
      const r = await removeEntry({ entryId: e.id, dishName: e.name, kind: "week", day });
      if (!r.ok) {
        addNote({ place: day, text: r.error });
        stale(r);
        return;
      }
      if (r.undo) addNote({ place: placeOf(r.undo), text: `${e.name} removed`, undo: { name: e.name, kind: "week", undo: r.undo } });
    });
  }
  function undo(note: Note) {
    const u = note.undo!;
    run(`undo:${note.key}`, async () => {
      const r = await restoreEntry({ dishName: u.name, kind: u.kind, undo: u.undo });
      if (r.ok) return dropNote(note.key);
      setNoteText(note.key, r.error);
      stale(r);
    });
  }

  // ── Per-day reads.
  const on = (d: string) => entries.filter((e) => runsOn(e, d));
  const dayDishes = (d: string) => on(d).filter((e) => e.kind === "day");
  const weekDishes = (d: string) => (dayOf(d)?.hours ? on(d).filter((e) => e.kind === "week") : []);
  const allWeek = entries.filter((e) => e.kind === "week");
  const openDays = days.filter((d) => d.hours).map((d) => d.day);

  const meta = (e: PlannerEntry, d: string) => {
    const parts = [d === today && e.today ? soldLine(e.today.sold, e.plates, e.today.manual).text : platesLabel(e.plates), hoursLabel(e.from, e.until)];
    if (e.price !== null) parts.push(formatKes(e.price));
    return parts.join(" · ");
  };
  const soldOutToday = (e: PlannerEntry) => e.today !== null && soldLine(e.today.sold, e.plates, e.today.manual).out;

  const notesFor = (place: string) =>
    notes
      .filter((x) => x.place === place)
      .map((x) => (
        <p key={x.key} role="status" className={noteCls}>
          <span className="whitespace-pre-line [overflow-wrap:anywhere]">{x.text}</span>
          {x.undo && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => undo(x)} disabled={pending && busy === `undo:${x.key}`} className={undoBtn} aria-label={`Undo removing ${x.undo.name}`}>
                {pending && busy === `undo:${x.key}` ? "Undoing…" : "Undo"}
              </button>
            </>
          )}
        </p>
      ));

  function dishButton(e: PlannerEntry, d: string, wide = false) {
    const closed = dayOf(d)?.closedNote != null;
    const out = d === today && soldOutToday(e);
    const body = (
      <>
        <Plate id={e.dishId} photo={e.photo} size={30} dim={closed} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13.5px] leading-snug font-semibold [overflow-wrap:anywhere] ${closed ? "text-ink-soft" : "text-ink"}`}>{e.name}</span>
          <span className={`block text-[12px] leading-snug font-medium [overflow-wrap:anywhere] ${out ? "text-coral-ink" : "text-ink-soft"}`}>{meta(e, d)}</span>
        </span>
      </>
    );
    const cls = `flex min-h-[52px] items-start gap-2 rounded-[var(--r-sm)] bg-blush px-2.5 py-2 text-left ${wide ? "w-full" : "w-auto max-w-[260px]"} ${fresh.has(e.id) ? "dish-in" : ""}`;
    if (!editable(e) || d < today) return <div key={e.id} data-dish="" tabIndex={-1} className={`${cls} outline-none`}>{body}</div>;
    return (
      <button key={e.id} data-dish="" type="button" onClick={() => openPanel({ entry: e.id, day: d })} className={`${ctl} ${cls} ${hoverBlush}`}>
        {body}
      </button>
    );
  }

  function copyButtons(d: PlannerDay, full = true) {
    if (!canAddOn(d)) return null;
    const prev = addDays(d.day, -1);
    const last = addDays(d.day, -7);
    const items = [
      { from: prev, count: d.copy.prev, label: weekdayName(prev) },
      { from: last, count: d.copy.lastWeek, label: `last ${weekdayName(last)}` },
    ].filter((x) => x.count > 0);
    if (items.length === 0) return null;
    return (
      <div className={full ? "flex flex-col gap-1.5" : "flex flex-wrap gap-1.5"}>
        {items.map((x) => {
          const key = `copy:${x.from}:${d.day}`;
          const going = pending && busy === key;
          return (
            <button key={key} type="button" disabled={pending} onClick={() => copy(x.from, d.day, x.label)} className={`${quietBtn} ${full ? "w-full" : ""}`}>
              {going ? "Copying…" : `Copy ${x.label} · ${n(x.count)}`}
            </button>
          );
        })}
      </div>
    );
  }

  const status = (d: PlannerDay) => {
    if (!d.hours) return <span className="text-[13px] font-semibold text-ink-soft">Closed</span>;
    const s = statusLine(d.day, today, on(d.day).length);
    return <span className={`text-[13px] font-semibold ${s.unplanned ? "text-coral-ink" : "text-ink-soft"}`}>{s.text}</span>;
  };
  // In a 1280 tile the note is cut to 2 lines (follow-ups item 4); one that is really cut is a
  // button that shows it in full, open until the week changes (item 7).
  const closedDateLine = (d: PlannerDay, clamp = false) =>
    d.closedNote !== null && (
      <p className="text-[12.5px] leading-snug font-semibold text-amber-ink [overflow-wrap:anywhere]">
        {clamp && d.closedNote ? (
          <ClampedNote text={`Closed · ${d.closedNote}`} open={opened(`note:${d.day}`)} onOpen={() => openIn(`note:${d.day}`)} />
        ) : d.closedNote ? `Closed · ${d.closedNote}` : "Closed"}
        <span className="block font-medium text-ink-soft">{closedLine}</span>
      </p>
    );
  const weekLine = (d: string) => {
    const w = weekDishes(d).length;
    return w > 0 ? (
      <a href="#all-week" className="inline-flex min-h-6 items-center text-[12.5px] font-semibold text-teal-deeper underline-offset-4 hover:underline">
        + {n(w)} all week
      </a>
    ) : null;
  };
  const weeklyClosed = (
    <span className="text-[13px] font-semibold text-ink-soft">
      Closed ·{" "}
      <Link href="/dashboard/settings" className="text-teal-deeper underline underline-offset-4">
        see Hours
      </Link>
    </span>
  );

  // ── Header pieces.
  const arrows = (
    <div className="flex items-center gap-1">
      <Link href={`${pathname}?day=${addDays(monday, -7)}`} aria-label="Previous week" className={`${ctl} flex size-12 items-center justify-center rounded-full text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:bg-sand`}>
        <Chevron dir="left" />
      </Link>
      <span className="min-w-[7.5rem] text-center text-[15px] font-bold whitespace-nowrap text-ink tabular-nums">{weekLabel(monday)}</span>
      <Link href={`${pathname}?day=${addDays(monday, 7)}`} aria-label="Next week" className={`${ctl} flex size-12 items-center justify-center rounded-full text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:bg-sand`}>
        <Chevron dir="right" />
      </Link>
    </div>
  );
  const thisWeekLink = !thisWeek && (
    <Link href={pathname} className={`${ctl} inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-teal-deeper underline underline-offset-4`}>
      This week
    </Link>
  );
  const canWeek = days.some((d) => canAddOn(d));
  const plusWeek = canWeek && (
    <button
      type="button"
      onClick={() => openPanel({ add: "week", day: selected >= today ? selected : today })}
      className={`${ctl} flex min-h-12 items-center gap-1.5 rounded-[var(--r-md)] bg-teal-deep px-5 text-[15px] font-bold text-paper`}
    >
      + Week
    </button>
  );

  // ── Plan tomorrow (current week only, as today's page).
  const next = thisWeek ? data.next : null;
  const planTomorrow = next && (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--r-md)] px-4 py-3 text-[14px] ${next.count ? "bg-teal-tint text-teal-deeper" : "bg-amber-tint text-amber-ink"}`}>
      <p className="min-w-0 flex-[1_1_240px]">
        {next.count ? (
          <>
            <b>{weekdayName(next.day)} is planned.</b> It goes live on its own in the morning.
          </>
        ) : (
          <>
            <b>{weekdayName(next.day)} isn’t planned yet.</b> Plan it tonight and there’s nothing to do in the morning.
          </>
        )}
      </p>
      {inWeek(next.day) ? (
        <button
          type="button"
          onClick={() => {
            if (next.count) {
              pickDay(next.day);
              document.getElementById(`day-${next.day}`)?.scrollIntoView({ block: "nearest" });
              document.getElementById(`row-${next.day}`)?.scrollIntoView({ block: "nearest" });
            } else openPanel({ add: "day", day: next.day });
          }}
          className={`${ctl} min-h-11 font-bold underline underline-offset-4`}
        >
          {next.count ? "Review" : "Plan"} {weekdayName(next.day)}
        </button>
      ) : (
        <Link href={`${pathname}?day=${next.day}`} className={`${ctl} inline-flex min-h-11 items-center font-bold underline underline-offset-4`}>
          {next.count ? "Review" : "Plan"} {weekdayName(next.day)}
        </Link>
      )}
    </div>
  );

  // ── All week.
  const allWeekList = (
    <section id="all-week" aria-labelledby="all-week-title" className="flex scroll-mt-4 flex-col gap-3 min-[1280px]:max-w-[720px]">
      <h2 id="all-week-title" className="font-display text-[22px] leading-tight text-ink">
        All week
      </h2>
      {notesFor("week")}
      {allWeek.length === 0 ? (
        <p className="text-[14px] text-ink-soft">{canWeek ? "No dishes running all week. Use + Week to add one." : "No dishes running all week."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {allWeek.map((e) => {
            const its = entryDays(e, days);
            const right = thisWeek && (() => {
              if (!runsOn(e, today) || !dayOf(today)?.hours) return { text: "Not today", out: false };
              const t = e.today ?? { sold: 0, manual: false };
              const s = soldLine(t.sold, e.plates, t.manual);
              if (s.out) return { text: "Sold out today", out: true };
              return { text: e.plates === null ? `${n(t.sold)} sold today` : `${n(e.plates - t.sold)} left today`, out: false };
            })();
            const row = (
              <>
                <Plate id={e.dishId} photo={e.photo} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-bold text-ink [overflow-wrap:anywhere]">{e.name}</span>
                  <span className="block text-[13px] text-ink-soft [overflow-wrap:anywhere]">
                    {[platesLabel(e.plates, true), formatKes(e.price ?? e.usualPrice), hoursLabel(e.from, e.until)].join(" · ")}
                  </span>
                  <span className="block text-[13px] font-semibold text-teal-deeper">{daysLabel(its, openDays)}</span>
                </span>
                {right && <span className={`shrink-0 text-right text-[13px] font-semibold whitespace-nowrap ${right.out ? "text-coral-ink" : "text-ink-soft"}`}>{right.text}</span>}
              </>
            );
            const cls = `flex w-full items-center gap-3 rounded-[var(--r-md)] bg-paper px-3 py-2.5 text-left shadow-[var(--shadow-card)] ${fresh.has(e.id) ? "dish-in" : ""}`;
            return (
              <li key={e.id}>
                {editable(e) ? (
                  <button type="button" onClick={() => openPanel({ entry: e.id, day: selected >= today ? selected : today })} className={`${ctl} ${cls}`}>
                    {row}
                  </button>
                ) : (
                  <div className={cls}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  // A dish just added or copied into a collapsed tile opens it (item 7), before the entrance plays.
  const toOpen = days.filter((d) => d.hours && !showAll(d.day) && dayDishes(d.day).length > COLLAPSE_OVER && dayDishes(d.day).some((e) => fresh.has(e.id))).map((d) => d.day);
  if (toOpen.length > 0) openIn(...toOpen);

  // ── From 1280: seven tiles.
  const tiles = (
    <div className="hidden grid-cols-[repeat(7,minmax(0,1fr))] items-start gap-2.5 min-[1280px]:grid">
      {days.map((d) => {
        const isToday = d.day === today;
        const list = dayDishes(d.day);
        return (
          <section
            key={d.day}
            id={`day-${d.day}`}
            aria-label={dayTitle(d.day)}
            className={`flex min-w-0 flex-col gap-2 rounded-[var(--r-lg)] p-3 ${d.hours ? "bg-paper shadow-[var(--shadow-card)]" : "closed-hatch"} ${isToday ? "ring-[3px] ring-teal ring-inset" : ""}`}
          >
            <div className="flex items-center justify-between gap-1">
              <h3 className="text-[15px] font-bold text-ink">{tileHead(d.day)}</h3>
              {isToday && <span className="rounded-full bg-teal-tint px-2 py-0.5 text-[11px] font-bold text-teal-deeper">Today</span>}
            </div>
            {d.hours ? status(d) : weeklyClosed}
            {d.hours && (
              <>
                {closedDateLine(d, true)}
                {(list.length > COLLAPSE_OVER && !showAll(d.day) ? list.slice(0, COLLAPSE_SHOW) : list).map((e) => dishButton(e, d.day, true))}
                {list.length > COLLAPSE_OVER && !showAll(d.day) && (
                  <button
                    type="button"
                    onClick={() => {
                      openIn(d.day);
                      // The button goes; focus moves to the first dish it revealed.
                      requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(`#day-${d.day} [data-dish]`)[COLLAPSE_SHOW]?.focus());
                    }}
                    className={`${ctl} flex min-h-11 items-center px-1 text-left text-[13px] font-semibold text-teal-deeper`}
                  >
                    {`+${n(list.length - COLLAPSE_SHOW)} more dishes`}
                  </button>
                )}
                {weekLine(d.day)}
                {notesFor(d.day)}
                {canAddOn(d) && (
                  <button type="button" onClick={() => openPanel({ add: "day", day: d.day })} className={`${addBtn} w-full`} aria-label={`Add a dish to ${weekdayName(d.day)}`}>
                    + Day
                  </button>
                )}
                {copyButtons(d)}
              </>
            )}
          </section>
        );
      })}
    </div>
  );

  // ── 600–1279: one row per day.
  const rows = (
    <div className="hidden flex-col gap-2 min-[600px]:flex min-[1280px]:hidden">
      {days.map((d) => {
        const isToday = d.day === today;
        if (!d.hours)
          return (
            <section key={d.day} id={`row-${d.day}`} aria-label={dayTitle(d.day)} className="closed-hatch flex min-h-14 items-center gap-4 rounded-[var(--r-lg)] px-4">
              <h3 className="w-[80px] shrink-0 text-[15px] font-bold text-ink">{tileHead(d.day)}</h3>
              {weeklyClosed}
            </section>
          );
        const list = dayDishes(d.day);
        return (
          <section
            key={d.day}
            id={`row-${d.day}`}
            aria-label={dayTitle(d.day)}
            className={`flex items-start gap-4 rounded-[var(--r-lg)] bg-paper p-3 pl-4 shadow-[var(--shadow-card)] ${isToday ? "ring-[3px] ring-teal ring-inset" : ""}`}
          >
            <div className="flex w-[80px] shrink-0 flex-col gap-0.5 pt-1">
              <h3 className="text-[15px] font-bold text-ink">{tileHead(d.day)}</h3>
              {isToday && <span className="self-start rounded-full bg-teal-tint px-2 py-0.5 text-[11px] font-bold text-teal-deeper">Today</span>}
              {status(d)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {closedDateLine(d)}
              {(list.length > 0 || weekDishes(d.day).length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.map((e) => (
                    dishButton(e, d.day)
                  ))}
                  {weekLine(d.day)}
                </div>
              )}
              {notesFor(d.day)}
              {copyButtons(d, false)}
            </div>
            {canAddOn(d) && (
              <button type="button" onClick={() => openPanel({ add: "day", day: d.day })} className={`${addBtn} shrink-0 px-4`} aria-label={`Add a dish to ${weekdayName(d.day)}`}>
                + Day
              </button>
            )}
          </section>
        );
      })}
    </div>
  );

  // ── Below 600: the day strip and one day.
  const sel = dayOf(selected)!;
  const selDay = dayDishes(selected);
  const selWeek = weekDishes(selected);
  const wd = weekdayName(selected);
  const phone = (
    <div className="flex flex-col gap-4 min-[600px]:hidden">
      <div role="group" aria-label="Days of the week" className="grid grid-cols-7 gap-0.5 min-[360px]:gap-1">
        {days.map((d) => {
          const isSel = d.day === selected;
          const count = on(d.day).length;
          const dot = !d.hours ? null : count > 0 ? "bg-teal" : d.day >= today ? "bg-coral" : null;
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={isSel}
              aria-label={`${dayTitle(d.day)}${d.hours ? "" : ", closed"}`}
              onClick={() => pickDay(d.day)}
              className={`${ctl} flex h-12 min-w-0 flex-col items-center justify-center rounded-[var(--r-sm)] text-[12px] leading-none font-bold ${
                isSel ? "bg-teal-deep text-paper" : d.hours ? "bg-paper text-ink ring-1 ring-sand ring-inset" : "closed-hatch text-ink-soft"
              } ${d.day === today && !isSel ? "ring-2 ring-teal ring-inset" : ""}`}
            >
              <span>{weekdayName(d.day).slice(0, 1)}</span>
              <span className="mt-1 tabular-nums">{d.day.slice(8).replace(/^0/, "")}</span>
              <span className={`mt-1 size-1.5 rounded-full ${dot && !isSel ? dot : dot && isSel ? "bg-paper" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <section aria-labelledby="phone-day" className="flex flex-col gap-3">
        <div>
          <h2 id="phone-day" className="font-display text-[22px] leading-tight text-ink">
            {dayTitle(selected)}
          </h2>
          {sel.hours ? status(sel) : weeklyClosed}
        </div>
        {sel.hours && (
          <>
            {closedDateLine(sel)}
            <h3 className="text-[14px] font-bold text-ink">{wd} only</h3>
            {selDay.length === 0 ? (
              <p className="text-[14px] text-ink-soft">{selected < today ? "Nothing was on." : "Nothing yet."}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selDay.map((e) => (
                  <li key={e.id}>
                    {phoneRow(e, selected)}
                  </li>
                ))}
              </ul>
            )}
            {notesFor(selected)}
            {canAddOn(sel) && (
              <button type="button" onClick={() => openPanel({ add: "day", day: selected })} className={`${addBtn} w-full`}>
                + Add to {wd}
              </button>
            )}
            {copyButtons(sel)}
            <h3 className="mt-2 text-[14px] font-bold text-ink">All week on {wd}</h3>
            {selWeek.length === 0 ? (
              <p className="text-[14px] text-ink-soft">No all-week dishes on {wd}.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selWeek.map((e) => (
                  <li key={e.id} className="flex items-stretch gap-1">
                    <div className="min-w-0 flex-1">
                      {phoneRow(e, selected)}
                    </div>
                    {editable(e) && selected >= today && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => removeOneDay(e, selected)}
                        aria-label={`Remove ${e.name} from ${wd}`}
                        className={`${ctl} min-h-11 shrink-0 px-2 text-[13px] font-semibold text-coral-ink`}
                      >
                        {pending && busy === `off:${e.id}:${selected}` ? "Removing…" : `Remove from ${wd}`}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWeek && (
              <button type="button" onClick={() => openPanel({ add: "week", day: selected >= today ? selected : today })} className={`${quietBtn} min-h-12 w-full text-[14px] font-bold`}>
                + Add for the week
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );

  function phoneRow(e: PlannerEntry, d: string) {
    const closed = dayOf(d)?.closedNote != null;
    const out = d === today && soldOutToday(e);
    const body = (
      <>
        <Plate id={e.dishId} photo={e.photo} size={44} dim={closed} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[16px] font-bold [overflow-wrap:anywhere] ${closed ? "text-ink-soft" : "text-ink"}`}>{e.name}</span>
          <span className={`block text-[13px] [overflow-wrap:anywhere] ${out ? "font-semibold text-coral-ink" : "text-ink-soft"}`}>{meta(e, d)}</span>
        </span>
      </>
    );
    const cls = `flex min-h-[60px] w-full items-center gap-3 rounded-[var(--r-md)] bg-paper px-3 py-2 text-left shadow-[var(--shadow-card)] ${fresh.has(e.id) ? "dish-in" : ""}`;
    if (!editable(e) || d < today) return <div className={cls}>{body}</div>;
    return (
      <button type="button" onClick={() => openPanel({ entry: e.id, day: d })} className={`${ctl} ${cls}`}>
        {body}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-0 min-[600px]:hidden">
        {arrows}
        {thisWeekLink}
      </div>
      <div className="-mt-2 hidden flex-wrap items-center justify-end gap-2 min-[600px]:flex">
        {thisWeekLink}
        {arrows}
        {plusWeek}
      </div>

      {tiles}
      {rows}
      {phone}
      {planTomorrow}
      {allWeekList}

      {session.mode && (
        <PlannerPanel key={session.n} open={session.open} mode={session.mode} data={data} onClose={closePanel} onDone={onDone} />
      )}
    </div>
  );
}

function copyText(c: CopyResult, label: string, to: PlannerDay): string {
  // Follow-ups items 6 and 7: "Copied…", the price line, then skips and hours, each on its own line.
  const head = `Copied ${n(c.copied)} ${c.copied === 1 ? "dish" : "dishes"} from ${label}.`;
  const priceLine = c.prices ? copyPriceLine(c.prices, label) : null;
  const lines: string[] = [];
  for (const name of c.archived) lines.push(`${name} wasn’t copied: it’s archived.`);
  const wd = weekdayName(to.day);
  for (const o of c.outside_hours) {
    const hours = `${hhmm(o.from)}–${hhmm(o.until)}`;
    const late = to.hours && hhmm(o.until) > hhmm(to.hours.closes) && hhmm(to.hours.closes) !== "00:00";
    lines.push(late ? `${o.name}’s hours (${hours}) are later than ${wd}’s closing time.` : `${o.name}’s hours (${hours}) are earlier than ${wd}’s opening time.`);
  }
  return [head, priceLine, lines.join(" ")].filter(Boolean).join("\n");
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/** A closed-date note cut to 2 lines. Only when it really is cut does it become a button that shows it in full. */
function ClampedNote({ text, open, onOpen }: { text: string; open: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text, cut]);
  const body = (
    <span ref={ref} className={open ? "block" : "line-clamp-2"}>
      {text}
    </span>
  );
  if (!cut && !open) return body;
  return (
    <button type="button" aria-expanded={open} onClick={open ? undefined : onOpen} className="press touch-manipulation block w-full text-left">
      {body}
    </button>
  );
}
