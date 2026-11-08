"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addEntry, removeEntry, searchDishes, setEntrySoldOut, updateEntry, type LibraryDish } from "@/app/dashboard/actions";
import type { PlannerResult, Undo } from "@/app/dashboard/action-result";
import { Switch } from "@/components/dashboard/switch";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { closedDateLabel, formatKes, hhmm, weekdayName } from "@/lib/format";
import { checkFields, closedLine, dayTitle, defaultHours, n, shortWeekday, soldLine, type PlannerField } from "@/lib/planner";
import { Plate } from "./plate";
import { PlannerSheet } from "./sheet";
import { entryDays, runsOn, type PlannerData, type PlannerEntry } from "./types";

export type PanelMode =
  | { kind: "add"; entryKind: "day" | "week"; day: string }
  | { kind: "edit"; entry: PlannerEntry; day: string };

export type PanelOutcome =
  | { type: "removed"; name: string; day: string; entryKind: "day" | "week"; undo: Undo }
  | { type: "added"; entryId: string }
  | { type: "gone"; day: string; text: string };

const REFRESH_AFTER_REFUSAL_MS = 3000;
const ctl = "press touch-manipulation select-none [-webkit-touch-callout:none]";
const primary = `${ctl} min-h-12 rounded-[var(--r-md)] bg-teal-deep px-5 text-[15px] font-bold text-paper disabled:cursor-not-allowed disabled:opacity-45`;
const quiet = `${ctl} min-h-12 rounded-[var(--r-md)] bg-paper px-5 text-[15px] font-semibold text-ink ring-1 ring-sand-deep ring-inset`;
const field = "min-h-12 w-full min-w-0 rounded-[var(--r-sm)] bg-paper px-3 text-base text-ink ring-1 ring-sand-deep ring-inset placeholder:text-field focus:outline-2 focus:outline-offset-0 focus:outline-teal-deep";
const label = "text-[14px] font-semibold text-ink";
const hint = "text-[13px] text-ink-soft";
const err = "note-in text-[14px] font-semibold text-coral-ink";

const opening = (h: { opens: string; closes: string }) => `${hhmm(h.opens)}–${hhmm(h.closes) === "24:00" ? "midnight" : hhmm(h.closes)}`;

export function PlannerPanel({
  open,
  mode,
  data,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: PanelMode;
  data: PlannerData;
  onClose: () => void;
  onDone: (o: PanelOutcome) => void;
}) {
  const { today, days: week } = data;
  const editing = mode.kind === "edit" ? mode.entry : null;
  const kind = mode.kind === "edit" ? mode.entry.kind : mode.entryKind;
  const dayOf = (d: string) => week.find((w) => w.day === d);
  const sunday = week[6]!.day;
  const firstOpen = [today > week[0]!.day ? today : week[0]!.day];

  // ── initial values
  const initialDays = useMemo(() => {
    if (kind === "day") return [mode.day];
    if (editing) return entryDays(editing, week).filter((d) => d >= today);
    return week.filter((d) => d.hours && d.day >= firstOpen[0]!).map((d) => d.day);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed for the panel's life (it's keyed by mode)
  }, []);
  const initialHours = editing
    ? { from: hhmm(editing.from), until: hhmm(editing.until) }
    : defaultHours(null, dayOf(initialDays[0] ?? mode.day)?.hours ?? null);
  const initial = {
    from: initialHours.from,
    until: initialHours.until,
    plates: editing?.plates != null ? String(editing.plates) : "",
    price: editing?.price != null ? String(editing.price) : "",
    days: initialDays,
  };

  const [dish, setDish] = useState<LibraryDish | null>(null);
  const [from, setFrom] = useState(initial.from);
  const [until, setUntil] = useState(initial.until);
  const [plates, setPlates] = useState(initial.plates);
  const [price, setPrice] = useState(initial.price);
  const [days, setDays] = useState<string[]>(initial.days);
  const [errors, setErrors] = useState<Partial<Record<PlannerField, string>>>({});
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();

  const usual = editing?.usualPrice ?? dish?.price ?? null;
  const onToday = editing && editing.today !== null && runsOn(editing, today);
  const changed =
    from !== initial.from ||
    until !== initial.until ||
    plates !== initial.plates ||
    price !== initial.price ||
    [...days].sort().join() !== [...initial.days].sort().join();

  const wd = weekdayName(mode.day);
  const title = editing ? editing.name : kind === "day" ? `Add to ${wd}` : "Add for the week";
  const sub = editing
    ? kind === "day"
      ? `${wd} only`
      : "All week"
    : kind === "day"
      ? `On the menu on ${dayTitle(mode.day)} only.`
      : "On the menu on the days you tick, this week.";
  const closedTicked = [...days].sort().filter((d) => dayOf(d)?.closedNote != null);

  function fail(r: Extract<PlannerResult, { ok: false }>) {
    if (r.gone) {
      onDone({ type: "gone", day: mode.day, text: r.error });
      onClose();
      return;
    }
    setErrors({ [r.field]: r.error });
    if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
  }

  function pickDish(d: LibraryDish) {
    setDish(d);
    setErrors((e) => ({ ...e, dish: undefined }));
    const h = defaultHours(d.last ? { from: d.last.from, until: d.last.until } : null, dayOf(days[0] ?? mode.day)?.hours ?? null);
    setFrom(h.from);
    setUntil(h.until);
    setPlates(d.last?.plates != null ? String(d.last.plates) : "");
  }

  function submit() {
    const found = checkFields({ from, until, plates, price });
    if (!editing && !dish) found.dish = "Pick a dish.";
    if (kind === "week" && days.length === 0 && !editing) found.days = "Tick at least one day.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const values = {
      from,
      until,
      plates: plates.trim() ? Number(plates) : null,
      // Without Dishes and prices the price isn't theirs to change: send back what's stored.
      price: data.prices ? (price.trim() ? Number(price) : null) : (editing?.price ?? null),
    };
    start(async () => {
      if (editing) {
        const r = await updateEntry({
          entryId: editing.id,
          dishName: editing.name,
          kind: editing.kind,
          day: mode.day,
          days: editing.kind === "week" ? [...days].sort() : null,
          ...values,
        });
        if (!r.ok) return fail(r);
        if (r.undo) onDone({ type: "removed", name: editing.name, day: r.undo.day, entryKind: "week", undo: r.undo });
        onClose();
        return;
      }
      const r = await addEntry({ dishId: dish!.id, dishName: dish!.name, kind, days: [...days].sort(), ...values });
      if (!r.ok) return fail(r);
      if (r.entryId) onDone({ type: "added", entryId: r.entryId });
      onClose();
    });
  }

  function remove() {
    if (!editing) return;
    start(async () => {
      const r = await removeEntry({ entryId: editing.id, dishName: editing.name, kind: editing.kind, day: editing.kind === "day" ? editing.startsOn : null });
      if (!r.ok) return fail(r);
      if (r.undo) onDone({ type: "removed", name: editing.name, day: r.undo.day, entryKind: editing.kind, undo: r.undo });
      onClose();
    });
  }

  const footer = (
    <div className="flex flex-col gap-2">
      {errors.form && (
        <p role="alert" className={err}>
          {errors.form}
        </p>
      )}
      {editing && (
        <button type="button" onClick={remove} disabled={pending} className={`${ctl} -ml-1 min-h-11 self-start px-1 text-[15px] font-semibold text-coral-ink`}>
          {editing.kind === "day" ? `Remove from ${weekdayName(editing.startsOn)}` : "Remove from the rest of the week"}
        </button>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={`${quiet} flex-1 min-[600px]:flex-none`}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={pending || (editing !== null && !changed)} className={`${primary} flex-[2] min-[600px]:flex-1`}>
          {editing ? (pending ? "Saving…" : "Save") : pending ? "Adding…" : kind === "day" ? `Add to ${wd}` : "Add to the week"}
        </button>
      </div>
    </div>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="planner-title" footer={footer}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="planner-title" tabIndex={-1} className="font-display text-[28px] leading-tight text-ink outline-none [overflow-wrap:anywhere]">
            {title}
          </h2>
          <p className="mt-1 text-[14px] text-ink-soft">{sub}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`${ctl} -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {closedTicked.length > 0 && (
        <p className="mt-3 rounded-[var(--r-sm)] bg-sand px-3 py-2 text-[13px] font-semibold text-ink">
          {closedLine(kind, closedTicked)}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-6">
        {!editing && (
          <DishPicker
            dish={dish}
            onPick={pickDish}
            onChange={() => setDish(null)}
            kind={kind}
            day={mode.day}
            from={kind === "day" ? mode.day : firstOpen[0]!}
            until={kind === "day" ? mode.day : sunday}
            today={today}
            prices={data.prices}
            error={errors.dish}
          />
        )}

        {onToday && editing && <SoldOutSwitch entry={editing} plates={plates} />}

        {kind === "week" && (
          <fieldset className="flex flex-col gap-2">
            <legend className={`${label} mb-2`}>Days</legend>
            <div className="grid grid-cols-7 gap-1">
              {week.map((d) => {
                const past = d.day < today;
                const closed = !d.hours;
                const disabled = past || closed;
                const on = days.includes(d.day) || (past && editing !== null && runsOn(editing, d.day));
                return (
                  <div key={d.day} className="flex min-w-0 flex-col items-center gap-1">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${weekdayName(d.day)} ${d.day.slice(8).replace(/^0/, "")}${closed ? ", closed" : past ? ", past" : ""}`}
                      disabled={disabled}
                      onClick={() => setDays((s) => (s.includes(d.day) ? s.filter((x) => x !== d.day) : [...s, d.day]))}
                      className={`${ctl} flex h-11 w-full min-w-0 flex-col items-center justify-center rounded-[var(--r-sm)] text-[12px] leading-tight font-semibold ${
                        disabled
                          ? on
                            ? "bg-sand text-ink-soft ring-2 ring-teal-deep/40 ring-inset"
                            : "bg-sand text-ink-soft"
                          : on
                            ? "bg-teal-deep text-paper"
                            : "bg-paper text-ink ring-1 ring-sand-deep ring-inset"
                      }`}
                    >
                      <span>{shortWeekday(d.day)}</span>
                      <span className="tabular-nums">{d.day.slice(8).replace(/^0/, "")}</span>
                    </button>
                    {disabled && <span className="text-[11px] font-semibold text-ink-soft">{closed ? "Closed" : "Past"}</span>}
                  </div>
                );
              })}
            </div>
            {errors.days && (
              <p role="alert" className={err}>
                {errors.days}
              </p>
            )}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className={`${label} mb-2`}>Serving hours</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={hint}>Serving from</span>
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={field} aria-invalid={!!errors.hours} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={hint}>Until</span>
              <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} className={field} aria-invalid={!!errors.hours} />
            </label>
          </div>
          <HoursHint kind={kind} days={days.length ? days : [mode.day]} data={data} />
          {errors.hours && (
            <p role="alert" className={err}>
              {errors.hours}
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className={label}>{kind === "day" ? "Plates that day" : "Plates a day"}</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={plates}
            onChange={(e) => setPlates(e.target.value)}
            placeholder="No limit"
            enterKeyHint={data.prices ? "next" : "done"}
            className={field}
            aria-invalid={!!errors.plates}
          />
          {onToday && editing?.today && plates.trim() && Number(plates) < editing.today.sold && (
            <span className={hint}>{n(editing.today.sold)} already sold today, so it’ll show sold out.</span>
          )}
          {errors.plates && (
            <span role="alert" className={err}>
              {errors.plates}
            </span>
          )}
        </label>

        {usual !== null &&
          (data.prices ? (
            <label className="flex flex-col gap-1">
              <span className={label}>{kind === "day" ? `Price for ${wd} (KSh)` : "Price this week (KSh)"}</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={String(usual)}
                enterKeyHint="done"
                className={field}
                aria-invalid={!!errors.price}
              />
              <span className={hint}>Usual price {formatKes(usual)}. Leave it empty to use it.</span>
              {errors.price && (
                <span role="alert" className={err}>
                  {errors.price}
                </span>
              )}
            </label>
          ) : (
            <div className="flex flex-col gap-1">
              <span className={label}>Price</span>
              <p className="text-[15px] text-ink">
                {editing?.price != null
                  ? `${formatKes(editing.price)} ${kind === "day" ? `for ${wd}` : "this week"} (usually ${n(usual)}).`
                  : `${formatKes(usual)}, the usual price.`}
              </p>
              {errors.price && (
                <span role="alert" className={err}>
                  {errors.price}
                </span>
              )}
            </div>
          ))}

        {editing && data.prices && (
          <Link href={`/dashboard/dishes/${editing.dishId}`} className="-mt-2 inline-flex min-h-11 items-center self-start text-[15px] font-semibold text-teal-deeper underline underline-offset-4">
            Edit dish
          </Link>
        )}
      </div>
    </PlannerSheet>
  );
}

function HoursHint({ kind, days, data }: { kind: "day" | "week"; days: string[]; data: PlannerData }) {
  const hours = days.map((d) => data.days.find((w) => w.day === d)?.hours).filter((h): h is NonNullable<typeof h> => !!h);
  if (hours.length === 0) return null;
  const labels = [...new Set(hours.map(opening))];
  if (kind === "day") return <p className="text-[13px] text-ink-soft">{`${weekdayName(days[0]!)}’s hours are ${labels[0]}.`}</p>;
  if (labels.length > 1) return <p className="text-[13px] text-ink-soft">Opening hours differ by day; customers can only order while you’re open.</p>;
  return <p className="text-[13px] text-ink-soft">{`Open ${labels[0]} on these days.`}</p>;
}

function SoldOutSwitch({ entry, plates }: { entry: PlannerEntry; plates: string }) {
  const sales = entry.today!;
  const [manual, setManual] = useState(sales.manual);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const limit = entry.plates;
  const { atLimit } = soldLine(sales.sold, limit, manual);
  const typed = plates.trim() ? Number(plates) : null;
  const on = atLimit || manual;
  return (
    <div className="flex flex-col gap-1 rounded-[var(--r-md)] bg-paper px-4 py-2 ring-1 ring-sand ring-inset">
      <div className={atLimit ? "pointer-events-none" : ""} aria-disabled={atLimit || undefined}>
        <Switch
          checked={on}
          onChange={(next) => {
            if (atLimit) return;
            setManual(next);
            setError(null);
            start(async () => {
              const r = await setEntrySoldOut({ entryId: entry.id, dishName: entry.name, soldOut: next });
              if (!r.ok) {
                setManual(!next);
                setError(r.error);
              }
            });
          }}
          className="min-h-11 w-full justify-between gap-3 text-left text-[15px] font-semibold text-ink"
        >
          <span>Sold out today</span>
        </Switch>
      </div>
      {atLimit && (typed === null || typed <= sales.sold) && <span className="pb-1 text-[13px] text-ink-soft">Raise the plates to sell more.</span>}
      {error && (
        <span role="alert" className={err}>
          {error}
        </span>
      )}
    </div>
  );
}

function DishPicker({
  dish,
  onPick,
  onChange,
  kind,
  day,
  from,
  until,
  today,
  prices,
  error,
}: {
  dish: LibraryDish | null;
  onPick: (d: LibraryDish) => void;
  onChange: () => void;
  kind: "day" | "week";
  day: string;
  from: string;
  until: string;
  today: string;
  prices: boolean;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; dishes: LibraryDish[] } | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const t = setTimeout(
      async () => {
        const r = await searchDishes({ q, from, until }).catch(() => ({ ok: false as const }));
        if (ticket !== latest.current) return;
        setResult(r.ok ? { q, dishes: r.dishes } : "failed");
      },
      q ? 150 : 0,
    );
    return () => clearTimeout(t);
  }, [q, from, until, attempt]);

  const meta = (d: LibraryDish) => `${d.lastServedOn ? `Last on ${closedDateLabel(d.lastServedOn, today)}` : "Not served yet"} · ${formatKes(d.price)}`;
  const newDish = prices && (
    <Link href={`/dashboard/dishes/new?day=${day}`} className={`${ctl} inline-flex min-h-11 items-center self-start text-[15px] font-semibold text-teal-deeper`}>
      + New dish
    </Link>
  );

  if (dish) {
    return (
      <div className="flex flex-col gap-2">
        <span className={label}>Dish</span>
        <div className="flex min-h-[52px] items-center gap-3 rounded-[var(--r-sm)] bg-paper px-3 py-2 ring-2 ring-teal-deep ring-inset">
          <Plate id={dish.id} photo={dish.photo} size={30} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{dish.name}</p>
            <p className="text-[12px] font-medium text-ink-soft">{meta(dish)}</p>
          </div>
          <button type="button" onClick={onChange} className={`${ctl} min-h-11 shrink-0 px-2 text-[15px] font-semibold text-teal-deeper`}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-2">
        <span className={label}>Dish</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dishes"
          enterKeyHint="search"
          autoComplete="off"
          className={field}
          aria-invalid={!!error}
        />
      </label>
      {error && (
        <p role="alert" className={err}>
          {error}
        </p>
      )}
      {result === null ? (
        <div className="flex flex-col gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-[var(--r-sm)] bg-sand/60" />
          ))}
        </div>
      ) : result === "failed" ? (
        <div className="flex items-center gap-3">
          <p className="text-[14px] font-semibold text-coral-ink">Couldn’t load dishes. Try again.</p>
          <button type="button" onClick={() => (setResult(null), setAttempt((a) => a + 1))} className={`${ctl} min-h-11 px-2 text-[15px] font-semibold text-teal-deeper`}>
            Try again
          </button>
        </div>
      ) : result.dishes.length === 0 ? (
        <p className="text-[14px] text-ink-soft">
          {result.q.trim()
            ? `No dish called “${result.q.trim()}”. Check the spelling${prices ? ", or add a new dish." : "."}`
            : prices
              ? "No dishes yet. Add a new dish."
              : "No dishes yet."}
        </p>
      ) : (
        <ul role="radiogroup" aria-label="Dishes" className="flex flex-col gap-1">
          {result.dishes.map((d) => {
            const taken = kind === "day" && d.onDay !== null;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={false}
                  disabled={taken}
                  onClick={() => onPick(d)}
                  className={`${ctl} flex min-h-[52px] w-full items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-left ${taken ? "bg-sand/50" : "bg-paper ring-1 ring-sand ring-inset"}`}
                >
                  <Plate id={d.id} photo={d.photo} size={30} dim={taken} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] font-semibold [overflow-wrap:anywhere] ${taken ? "text-ink-soft" : "text-ink"}`}>{d.name}</span>
                    <span className="block text-[12px] font-medium text-ink-soft">
                      {d.onDay ? `On ${weekdayName(d.onDay)} already` : meta(d)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {newDish}
    </div>
  );
}
