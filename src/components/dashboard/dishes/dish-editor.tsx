"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteDish, dishHasOrders, saveDish, setEveryday } from "@/app/dashboard/actions";
import { PhotoUpload } from "@/components/dashboard/photo-upload";
import { Switch } from "@/components/dashboard/switch";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { dayLabel } from "@/lib/format";
import { newDishPlanProblem } from "@/lib/planner";
import { OptionsEditor, type OptionsEditorHandle } from "./options-editor";
import type { SavedOption } from "./option-out";

export type EditorDish = {
  id: string;
  name: string;
  description: string;
  price_kes: number;
  category: "mains" | "sides" | "breakfast" | "drinks";
  photo_url: string | null;
  is_regular: boolean;
};

const field = "min-h-12 w-full min-w-0 rounded-xl border border-line-deep bg-paper px-3.5 text-base font-medium";
const label = "flex min-w-0 flex-col gap-1.5 text-sm font-semibold";
const card = "flex min-w-0 flex-col gap-[18px] rounded-[18px] bg-paper p-5 ring-1 ring-sand min-[600px]:p-6";
const btnQuiet =
  "press min-h-11 rounded-[var(--r-sm)] border-[1.5px] border-paper/40 px-4 text-sm font-semibold text-paper touch-manipulation select-none disabled:opacity-50";
const btnPrimary = "press min-h-11 whitespace-nowrap rounded-[var(--r-sm)] bg-teal-deep px-5 text-sm font-bold text-paper touch-manipulation select-none disabled:opacity-60";

const clock = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(new Date());

/** The On the everyday menu switch row: saved at once on an existing dish, with the form on a new one. */
export function EverydaySwitch({ dishId, initial, onFormChange }: { dishId: string | null; initial: boolean; onFormChange?: () => void }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();
  useEffect(() => setOn(initial), [initial]);

  function change(v: boolean) {
    if (!dishId) {
      setOn(v);
      onFormChange?.();
      return;
    }
    if (pending) return;
    setOn(v);
    setError(null);
    startTransition(async () => {
      const r = await setEveryday(dishId, v);
      if (r?.error) {
        setOn(!v);
        setError(r.error);
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {!dishId && on && <input type="hidden" name="is_regular" value="on" />}
      <Switch checked={on} onChange={change} className="min-h-14 w-full justify-between gap-4 text-left">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">On the everyday menu</span>
          <span className="text-[13px] text-ink-soft">On sale every day the kitchen is open.</span>
        </span>
      </Switch>
      {error && (
        <p role="alert" className="note-in text-[13px] font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The editor for someone with Dishes and prices (spec-2.6 "Dish editor"). One Save for the fields,
 * choices and extras; the sticky save bar says what's live. Cancel puts back what was saved
 * by remounting the form from the page's props (they are the saved dish after a save).
 */
export function DishEditor(props: {
  dish: EditorDish | null;
  options: SavedOption[];
  everyday: boolean;
  regularDefault: boolean;
  planDay: string | null;
  newId: string;
  backHref: string;
}) {
  const [epoch, setEpoch] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The page makes a new id on every render, and a save that fails after the dish part (the menu
  // step) refreshes the page. Keep the first one, so Save again finds that dish instead of
  // creating a second copy (Tevin 2026-11-15).
  const [newId] = useState(props.newId);
  // After a save the form is rebuilt from the page's props, which are the saved dish (new options
  // now have ids). The refreshed props can land a render after the action returns, so the key also
  // carries what was saved: when they arrive the form rebuilds again. Out today and the everyday
  // switch save at once and aren't in it, so they never throw away unsaved typing.
  const d = props.dish;
  const saved = JSON.stringify([
    d && [d.name, d.description, d.price_kes, d.category, d.photo_url],
    props.options.map((o) => [o.id, o.kind, o.label, o.extra, o.isDefault]),
  ]);
  return (
    <EditorForm
      key={`${epoch}:${saved}`}
      {...props}
      newId={newId}
      savedAt={savedAt}
      onSaved={() => {
        setSavedAt(clock());
        setEpoch((n) => n + 1);
      }}
      onCancel={() => setEpoch((n) => n + 1)}
    />
  );
}

function EditorForm({
  dish,
  options,
  everyday,
  regularDefault,
  planDay,
  newId,
  backHref,
  savedAt,
  onSaved,
  onCancel,
}: Parameters<typeof DishEditor>[0] & { savedAt: string | null; onSaved: () => void; onCancel: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The field a refused save's line belongs to ("show_until"), shown there too.
  const [errorField, setErrorField] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const opts = useRef<OptionsEditorHandle>(null);
  const reportRefusal = useReportRefusal();
  const changed = () => {
    setDirty(true);
    setError(null);
    setErrorField(null);
  };
  function fieldError(form: HTMLFormElement, field: string | undefined, text: string) {
    setError(text);
    setErrorField(field ?? null);
    if (field !== "show_until") return;
    form.querySelector<HTMLElement>('[name="show_until"]')?.focus();
    // The line under the field renders next frame; bring it above the save bar too (html.savebar-pad).
    requestAnimationFrame(() => document.getElementById("hours-error")?.scrollIntoView({ block: "nearest" }));
  }

  // While the bar shows, focus and scrollIntoView stop above it (globals.css html.savebar-pad).
  useEffect(() => {
    document.documentElement.classList.add("savebar-pad");
    return () => document.documentElement.classList.remove("savebar-pad");
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!e.currentTarget.reportValidity()) return;
    if (opts.current && !opts.current.check()) {
      setError("Check the choices and extras, then save again.");
      return;
    }
    const form = e.currentTarget;
    const data = new FormData(form);
    if (isNew && planDay) {
      const problem = newDishPlanProblem({
        everyday: data.get("is_regular") === "on",
        from: String(data.get("show_from") ?? ""),
        until: String(data.get("show_until") ?? ""),
      });
      if (problem) return fieldError(form, problem.field, problem.error);
    }
    setError(null);
    setErrorField(null);
    startTransition(async () => {
      const r = await saveDish(null, data);
      if (r?.error) {
        fieldError(form, r.field, r.error);
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
        return;
      }
      onSaved();
    });
  }

  const isNew = !dish;
  const barText = pending
    ? "Saving…"
    : error
      ? error
      : savedAt && !dirty
        ? `Saved at ${savedAt}.${dish?.is_regular ? " Live on the menu." : ""}`
        : "Changes aren’t live until you save.";

  return (
    <form onSubmit={submit} onInput={changed} onChange={changed} className="flex min-w-0 flex-col gap-5">
      <input type="hidden" name="id" value={dish?.id ?? ""} />
      {/* New dishes get their id up front, so a repeated submit can't create a second copy. */}
      {isNew && <input type="hidden" name="new_id" value={newId} />}

      <div className="grid min-w-0 gap-5 min-[1280px]:grid-cols-[minmax(0,1fr)_340px] min-[1280px]:items-start">
        <section aria-label="The dish" className={`${card} min-[1280px]:col-start-1 min-[1280px]:row-start-1`}>
          <label className={label}>
            Name
            <input name="name" required maxLength={80} defaultValue={dish?.name} enterKeyHint="done" className={field} />
          </label>
          <div className="grid gap-3.5 min-[600px]:grid-cols-2">
            <label className={label}>
              Usual price (KSh)
              <input name="price_kes" type="number" inputMode="numeric" min={0} max={100000} step={1} required defaultValue={dish?.price_kes} enterKeyHint="done" className={`${field} tabular-nums`} />
            </label>
            <label className={label}>
              Type
              <select name="category" defaultValue={dish?.category ?? "mains"} className={field}>
                <option value="mains">Mains</option>
                <option value="sides">Sides</option>
                <option value="breakfast">Breakfast</option>
                <option value="drinks">Drinks</option>
              </select>
            </label>
          </div>
          <OptionsEditor ref={opts} dishName={dish?.name ?? "this dish"} saved={options} onChange={changed} />
          <label className={label}>
            Description
            <textarea name="description" rows={3} maxLength={300} defaultValue={dish?.description} className="w-full min-w-0 rounded-xl border border-line-deep bg-paper px-3.5 py-3 text-base font-normal" />
          </label>
        </section>

        <section aria-label="Photo" className={`${card} min-[1280px]:col-start-2 min-[1280px]:row-span-2 min-[1280px]:row-start-1`}>
          <PhotoUpload initialUrl={dish?.photo_url ?? null} />
        </section>

        {(everyday || planDay) && (
          <section aria-label="Where it's sold" className={`${card} min-[1280px]:col-start-1 min-[1280px]:row-start-2`}>
            {/* A new dish from the planner is for planned days; the everyday menu is set from Dishes
                (Tevin 2026-11-15, A), so the switch isn't offered there. */}
            {everyday && !planDay && <EverydaySwitch dishId={dish?.id ?? null} initial={dish?.is_regular ?? regularDefault} onFormChange={changed} />}
            {planDay && <PlanDayFields day={planDay} hoursError={errorField === "show_until" ? error : null} />}
          </section>
        )}
      </div>

      <div
        role="status"
        className="sticky bottom-[calc(var(--tabbar-h,0px)+8px)] z-20 flex flex-col gap-3 rounded-[var(--r-md)] bg-ink px-4 py-3 text-paper shadow-[var(--shadow-card)] min-[480px]:flex-row min-[480px]:items-center lg:bottom-[calc(12px+env(safe-area-inset-bottom,0px))]"
      >
        <p className={`min-w-0 flex-1 text-[15px] ${error && !pending ? "font-semibold text-blush" : savedAt && !dirty ? "font-semibold" : ""}`}>{barText}</p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 min-[480px]:flex">
          {isNew ? (
            <Link href={backHref} className={`${btnQuiet} inline-flex items-center justify-center`}>
              Cancel
            </Link>
          ) : (
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={onCancel}
              className={btnQuiet}
            >
              Cancel
            </button>
          )}
          <button type="submit" disabled={pending} aria-busy={pending || undefined} className={btnPrimary}>
            {pending ? "Saving…" : planDay ? "Save and add to menu" : "Save dish"}
          </button>
        </div>
      </div>
    </form>
  );
}

function PlanDayFields({ day, hoursError }: { day: string; hoursError: string | null }) {
  return (
    <fieldset className="flex flex-col gap-3.5">
      <legend className="mb-2 text-sm font-semibold">Add to {dayLabel(day, "long")}</legend>
      <input type="hidden" name="add_day" value={day} />
      <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-sand p-1">
        {(
          [
            ["day", `${dayLabel(day)} only`],
            ["week", "Rest of the week"],
          ] as const
        ).map(([v, text]) => (
          <label key={v} className="press flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] text-center text-sm font-semibold touch-manipulation select-none has-[:checked]:bg-paper has-[:checked]:text-teal-deep">
            <input type="radio" name="add_kind" value={v} defaultChecked={v === "day"} className="sr-only" /> {text}
          </label>
        ))}
      </div>
      <div className="grid gap-3 min-[600px]:grid-cols-3">
        <label className={label}>
          Plates a day
          <input name="plates_per_day" type="number" inputMode="numeric" min={0} max={1000} step={1} placeholder="No limit" className={field} />
        </label>
        <label className={label}>
          Show from
          <input name="show_from" type="time" defaultValue="11:00" className={field} />
        </label>
        <label className={label}>
          Until
          <input
            name="show_until"
            type="time"
            defaultValue="20:00"
            aria-invalid={hoursError ? true : undefined}
            aria-describedby={hoursError ? "hours-error" : undefined}
            className={field}
          />
        </label>
      </div>
      {hoursError && (
        // No role="alert": the save bar (role="status") announces it, and focus lands on Until, which reads it.
        <p id="hours-error" className="note-in text-[13px] font-semibold text-coral-ink">
          {hoursError}
        </p>
      )}
    </fieldset>
  );
}

/** Delete, owner only: a quiet coral button that turns into the question in place (not confirm()). */
export function DeleteDish({ dish }: { dish: { id: string; name: string; is_regular: boolean } }) {
  const [ask, setAsk] = useState<null | { hasOrders: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const question = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reportRefusal = useReportRefusal();

  function open() {
    setError(null);
    startTransition(async () => {
      const r = await dishHasOrders(dish.id);
      if ("error" in r) {
        setError(r.error);
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
        return;
      }
      setAsk({ hasOrders: r.hasOrders });
      requestAnimationFrame(() => question.current?.focus());
    });
  }
  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await deleteDish(dish.id, dish.name, dish.is_regular);
      if (r?.error) {
        setError(r.error);
        if (r.stale) setTimeout(() => reportRefusal(r.error), 3000);
      }
    });
  }
  function close() {
    setAsk(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  return (
    <section aria-label="Delete" className="flex flex-col gap-2 pt-1">
      {ask ? (
        <div className="note-in flex flex-col gap-3 rounded-[18px] bg-blush p-4 min-[600px]:p-5">
          <p ref={question} tabIndex={-1} className="text-[15px] text-coral-ink [overflow-wrap:anywhere] focus:outline-none">
            {ask.hasOrders
              ? `${dish.name} has past orders, so it will be archived: it leaves every menu, and its orders keep their record. You can restore it from Archived.`
              : `Delete ${dish.name}? It’s never been ordered, so it’s removed for good, with its photo.`}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={confirm} disabled={pending} aria-busy={pending || undefined} className="press min-h-11 rounded-[var(--r-sm)] bg-coral-ink px-4 text-sm font-bold text-paper touch-manipulation select-none disabled:opacity-60">
              {pending ? (ask.hasOrders ? "Archiving…" : "Deleting…") : ask.hasOrders ? "Archive dish" : "Delete dish"}
            </button>
            <button type="button" onClick={close} disabled={pending} className="press min-h-11 rounded-[var(--r-sm)] border-[1.5px] border-line-deep bg-paper px-4 text-sm font-semibold text-ink touch-manipulation select-none">
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={opener}
          type="button"
          onClick={open}
          disabled={pending}
          className="press min-h-11 self-start rounded-[var(--r-sm)] px-1 text-sm font-semibold text-coral-text touch-manipulation select-none hover:underline disabled:opacity-60"
        >
          {pending ? "Checking…" : "Delete dish"}
        </button>
      )}
      {error && (
        <p role="alert" className="note-in text-[13px] font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </section>
  );
}
