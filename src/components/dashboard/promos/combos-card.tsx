"use client";
import { useId, useOptimistic, useState, useTransition } from "react";
import { comboAction, saveCombo, type ComboField } from "@/app/dashboard/promos/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { Switch } from "@/components/dashboard/switch";
import { PanelHeading } from "@/components/dashboard/tables/ui";
import { ctl, danger, errorLine, field, hint, labelText, primary, quiet } from "@/components/ui-classes";
import { PageNote } from "@/components/ui-parts";
import { formatKes } from "@/lib/format";
import { COMBO_MAX_DISHES, COMBO_NAME_MAX, comboLine, comboStatus, sentenceEnd, type ComboRow } from "@/lib/promos";

export type ComboDish = { id: string; name: string; price_kes: number };
type Note = { text: string; tone: "info" | "error" };
type Open = { id: string | null; seq: number };

const STATUS_TONE = { on: "text-teal-deep", warn: "text-amber-ink", off: "text-ink-soft" } as const;

/** Combos (spec 2.11 "Your promos" 2): each combo with its dishes, price, status and switch; New combo. */
export function CombosCard({ combos, dishes }: { combos: ComboRow[]; dishes: ComboDish[] }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const show = (id: string | null) => (setOpen((o) => ({ id, seq: (o?.seq ?? 0) + 1 })), setVisible(true));
  const combo = open?.id ? combos.find((c) => c.id === open.id) ?? null : null;

  return (
    <article aria-labelledby="combos-title" className="flex flex-col gap-3 rounded-[18px] bg-paper p-4 ring-1 ring-sand min-[600px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="combos-title" className="text-[17px] font-semibold text-ink">
          Combos
        </h2>
        <button type="button" onClick={() => show(null)} className={`${quiet} min-h-11 px-4`}>
          New combo
        </button>
      </div>
      <p className={hint}>A set price for a few dishes together. It shows on the menu only while every dish in it can be ordered.</p>
      {note && <PageNote text={note.text} tone={note.tone} />}
      {combos.length === 0 ? (
        <p className="text-[15px] text-ink-soft">No combos yet.</p>
      ) : (
        <ul className="flex flex-col">
          {combos.map((c) => (
            <ComboItem key={c.id} combo={c} onOpen={() => show(c.id)} onNote={setNote} />
          ))}
        </ul>
      )}
      {open && (open.id === null || combo) && (
        <ComboSheet
          key={open.seq}
          open={visible}
          combo={combo}
          dishes={dishes}
          onClose={() => setVisible(false)}
          onDone={(text) => (setNote({ text, tone: "info" }), setVisible(false))}
        />
      )}
    </article>
  );
}

function ComboItem({ combo: c, onOpen, onNote }: { combo: ComboRow; onOpen: () => void; onNote: (n: Note) => void }) {
  const [on, setOn] = useOptimistic(c.active);
  const [, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const status = comboStatus(c);

  function toggle(next: boolean) {
    start(async () => {
      setOn(next);
      const r = await comboAction(c.id, next ? "on" : "off");
      if (r.ok) return onNote({ text: next ? `Switched on ${sentenceEnd(c.name)}` : `Switched off ${sentenceEnd(c.name)} It isn’t on the menu now.`, tone: "info" });
      onNote({ text: r.error, tone: "error" });
      if (r.stale) reportRefusal(r.error);
    });
  }

  return (
    <li className="flex items-start gap-3 border-t border-sand py-3 first:border-t-0 first:pt-1">
      <button type="button" onClick={onOpen} className={`${ctl} flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--r-sm)] text-left`}>
        <span className="text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{c.name}</span>
        <span className="text-[14px] text-ink-soft [overflow-wrap:anywhere]">{comboLine(c.parts)}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
          <span className="text-[15px] font-bold text-ink">{formatKes(c.price_kes)}</span>
          {c.everyday_kes > c.price_kes && <s className="text-[14px] text-ink-soft">{formatKes(c.everyday_kes)}</s>}
        </span>
        <span className={`text-[13px] font-semibold ${STATUS_TONE[status.tone]} [overflow-wrap:anywhere]`}>{on !== c.active ? (on ? "Switching on…" : "Switching off…") : status.text}</span>
      </button>
      <Switch checked={on} onChange={toggle} label={`Show ${c.name} on the menu`} className="min-h-11 shrink-0 px-1" />
    </li>
  );
}

type Part = { dish_id: string; quantity: number };

function ComboSheet({
  open,
  combo,
  dishes,
  onClose,
  onDone,
}: {
  open: boolean;
  combo: ComboRow | null;
  dishes: ComboDish[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const [name, setName] = useState(combo?.name ?? "");
  const [price, setPrice] = useState(combo ? String(combo.price_kes) : "");
  const [parts, setParts] = useState<Part[]>(combo?.parts.map((p) => ({ dish_id: p.dish_id, quantity: p.quantity })) ?? []);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<"archive" | null>(null);
  const [err, setErr] = useState<{ field: ComboField; text: string } | null>(null);
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const ids = { name: useId(), price: useId(), priceNote: useId(), dishes: useId() };

  const total = parts.reduce((n, p) => n + p.quantity, 0);
  // A dish archived since the combo was saved has no price here; the database refuses it on save.
  const everyday = parts.reduce((n, p) => n + (byId.get(p.dish_id)?.price_kes ?? 0) * p.quantity, 0);
  const priceKes = /^\d{1,5}$/.test(price.trim()) ? Number(price.trim()) : null;
  const noSaving = priceKes !== null && total > 0 && priceKes >= everyday;
  const errFor = (f: ComboField) => (err?.field === f ? err.text : null);

  const change = (dish: string, by: number) => {
    setErr(null);
    setParts((ps) =>
      ps.flatMap((p) => (p.dish_id !== dish ? [p] : p.quantity + by <= 0 ? [] : [{ ...p, quantity: p.quantity + by }])),
    );
  };
  const add = (dish: string) => {
    setErr(null);
    setParts((ps) => [...ps, { dish_id: dish, quantity: 1 }]);
    setAdding(false);
  };

  function submit() {
    if (pending) return;
    const trimmed = name.trim();
    if (!trimmed) return setErr({ field: "name", text: "Give the combo a name." });
    if (total < 2) return setErr({ field: "items", text: "Pick at least 2 dishes. The same dish twice counts." });
    if (priceKes === null || priceKes <= 0) return setErr({ field: "price", text: "Enter a price in shillings." });
    if (noSaving) return setErr({ field: "price", text: `Price it below ${formatKes(everyday)} so it’s a deal.` });
    setErr(null);
    start(async () => {
      const r = await saveCombo({ id: combo?.id ?? null, name: trimmed, price_kes: priceKes, items: parts });
      if (r.ok) return onDone(combo ? `Saved ${sentenceEnd(trimmed)}` : `Made ${sentenceEnd(trimmed)} It shows on the menu while every dish can be ordered.`);
      setErr({ field: r.field ?? "form", text: r.error });
      if (r.stale) reportRefusal(r.error);
    });
  }

  function archive() {
    if (pending || !combo) return;
    start(async () => {
      const r = await comboAction(combo.id, "archive");
      if (r.ok) return onDone(`Archived ${sentenceEnd(combo.name)}`);
      setAsk(null);
      setErr({ field: "form", text: r.error });
      if (r.stale) reportRefusal(r.error);
    });
  }

  const footer =
    ask === "archive" && combo ? (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">Archive {combo.name}? It leaves the menu and this list.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={archive} aria-disabled={pending || undefined} className={`${danger} flex-1 aria-disabled:opacity-60`}>
            {pending ? "Archiving…" : "Archive"}
          </button>
          <button type="button" onClick={() => setAsk(null)} className={`${quiet} flex-1`}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        {errFor("form") && (
          <p role="alert" className={errorLine}>
            {errFor("form")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={submit} aria-disabled={pending || undefined} className={`${primary} flex-1 aria-disabled:opacity-60`}>
            {pending ? "Saving…" : "Save"}
          </button>
          {combo && (
            <button type="button" onClick={() => setAsk("archive")} className={`${quiet} flex-1 text-coral-ink`}>
              Archive
            </button>
          )}
        </div>
      </div>
    );

  const left = dishes.filter((d) => !parts.some((p) => p.dish_id === d.id));

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="combo-sheet-title" footer={footer}>
      <PanelHeading id="combo-sheet-title" title={combo ? combo.name : "New combo"} sub="Set dishes at one price. Extras, and choices that cost more, are added on top as usual." onClose={onClose} />
      <form noValidate onSubmit={(e) => (e.preventDefault(), submit())} className="mt-5 flex flex-col gap-5 pb-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.name} className={labelText}>
            Name
          </label>
          <input
            id={ids.name}
            value={name}
            onChange={(e) => (setName(e.target.value), setErr(null))}
            maxLength={COMBO_NAME_MAX}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Lunch combo"
            aria-invalid={errFor("name") ? true : undefined}
            aria-describedby={errFor("name") ? `${ids.name}-note` : undefined}
            className={field}
          />
          {errFor("name") && (
            <p id={`${ids.name}-note`} role="alert" className={errorLine}>
              {errFor("name")}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2" aria-describedby={`${ids.dishes}-note`}>
          <legend className={`${labelText} mb-1`}>Dishes</legend>
          <p id={`${ids.dishes}-note`} className={`${errFor("items") ? errorLine : hint} tabular-nums`} role={errFor("items") ? "alert" : undefined}>
            {errFor("items") ?? `${total} of ${COMBO_MAX_DISHES}. 2 to 4 in total.`}
          </p>
          {parts.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-[var(--r-md)] ring-1 ring-sand">
              {parts.map((p) => {
                const d = byId.get(p.dish_id);
                const label = d?.name ?? "A dish that’s been archived";
                return (
                  <li key={p.dish_id} className="flex items-center gap-2 border-t border-sand py-1 pr-1 pl-3 first:border-t-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{label}</span>
                      {d && <span className="text-[13px] text-ink-soft tabular-nums">{formatKes(d.price_kes)} each</span>}
                    </span>
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => change(p.dish_id, -1)}
                        aria-label={p.quantity === 1 ? `Remove ${label}` : `One fewer ${label}`}
                        className={`${ctl} grid size-11 place-items-center rounded-full text-[20px] font-semibold text-teal-deep`}
                      >
                        −
                      </button>
                      <span aria-live="polite" className="w-6 text-center text-[16px] font-semibold text-ink tabular-nums">
                        {p.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => change(p.dish_id, 1)}
                        aria-disabled={total >= COMBO_MAX_DISHES || undefined}
                        disabled={total >= COMBO_MAX_DISHES}
                        aria-label={`One more ${label}`}
                        className={`${ctl} grid size-11 place-items-center rounded-full text-[20px] font-semibold text-teal-deep disabled:opacity-35`}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {total < COMBO_MAX_DISHES &&
            (adding ? (
              <DishPicker dishes={left} onPick={add} onCancel={() => setAdding(false)} />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className={`${quiet} min-h-11 self-start px-4`}>
                Add a dish
              </button>
            ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.price} className={labelText}>
            Price (KSh)
          </label>
          <input
            id={ids.price}
            value={price}
            onChange={(e) => (setPrice(e.target.value.replace(/[^\d]/g, "").slice(0, 5)), setErr(null))}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="650"
            aria-invalid={errFor("price") || noSaving ? true : undefined}
            aria-describedby={ids.priceNote}
            className={`${field} tabular-nums min-[600px]:max-w-[12rem]`}
          />
          <p id={ids.priceNote} role={errFor("price") ? "alert" : undefined} className={`${errFor("price") || noSaving ? errorLine : hint} tabular-nums`}>
            {errFor("price") ??
              (total === 0
                ? "Add dishes to see the everyday price."
                : noSaving
                  ? `Price it below ${formatKes(everyday)} so it’s a deal.`
                  : priceKes
                    ? `Everyday price ${formatKes(everyday)} · Saves ${formatKes(everyday - priceKes)}`
                    : `Everyday price ${formatKes(everyday)}`)}
          </p>
        </div>
      </form>
    </PlannerSheet>
  );
}

function DishPicker({ dishes, onPick, onCancel }: { dishes: ComboDish[]; onPick: (id: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const needle = q.trim().toLocaleLowerCase("en-KE");
  const shown = needle ? dishes.filter((d) => d.name.toLocaleLowerCase("en-KE").includes(needle)) : dishes;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--r-md)] bg-cream p-3">
      <div className="flex items-center gap-2">
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
          autoFocus
          className={field}
        />
        <button type="button" onClick={onCancel} className={`${ctl} min-h-11 shrink-0 rounded-[var(--r-sm)] px-2 text-[15px] font-semibold text-teal-deep`}>
          Cancel
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-[15px] text-ink-soft [overflow-wrap:anywhere]">{dishes.length === 0 ? "Every dish is already in this combo." : `No dish matches “${q.trim()}”.`}</p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto overscroll-contain rounded-[var(--r-sm)] bg-paper ring-1 ring-sand">
          {shown.map((d) => (
            <li key={d.id} className="border-t border-sand first:border-t-0">
              <button type="button" onClick={() => onPick(d.id)} className={`${ctl} flex min-h-12 w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-cream`}>
                <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{d.name}</span>
                <span className="shrink-0 text-[14px] text-ink-soft tabular-nums">{formatKes(d.price_kes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
