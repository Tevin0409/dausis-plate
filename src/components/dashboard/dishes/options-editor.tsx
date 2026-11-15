"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CloseIcon, DownIcon, PlusIcon, UpIcon } from "@/components/icons";
import { OPTION_MESSAGES, OPTION_LABEL_MAX, OPTIONS_PER_KIND, optionProblem, readPrice, type OptionInput, type OptionKind } from "@/lib/dish-options";
import { OutNotes, OutTodaySwitch, useOptionOut, type SavedOption } from "./option-out";

type Row = { key: string; id?: string; kind: OptionKind; label: string; price: string; isDefault: boolean; added?: boolean };

export type OptionsEditorHandle = {
  /** Checks the rows before a save: shows the problem by its row and returns false, or true. */
  check: () => boolean;
};

const fromSaved = (o: SavedOption): Row => ({
  key: o.id,
  id: o.id,
  kind: o.kind,
  label: o.label,
  price: o.extra > 0 || o.kind === "extra" ? String(o.extra) : "",
  isDefault: o.isDefault,
});

let seq = 0;
const newKey = () => `new-${++seq}`;

const iconBtn =
  "press grid size-11 shrink-0 place-items-center rounded-[var(--r-sm)] text-ink-soft touch-manipulation select-none [-webkit-touch-callout:none] hover:bg-mist disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
const input =
  "min-h-12 rounded-xl border border-line-deep bg-paper px-3.5 text-base font-medium aria-invalid:border-coral aria-invalid:ring-2 aria-invalid:ring-coral/30";

/**
 * Comes with (choices, the customer picks one) and Extras (any number), spec-2.6 "Dish editor".
 * Saved with the dish: the rows go to the form as one hidden `options` JSON field. Out today
 * switches on saved rows save at once and aren't part of the form.
 */
export const OptionsEditor = forwardRef<OptionsEditorHandle, { dishName: string; saved: SavedOption[]; onChange: () => void }>(
  function OptionsEditor({ dishName, saved, onChange }, ref) {
    const [rows, setRows] = useState<Row[]>(() => saved.map(fromSaved));
    const [problem, setProblem] = useState<{ message: string; key: string | null; kind: OptionKind | null } | null>(null);
    const outs = useOptionOut(dishName, saved);
    const box = useRef<HTMLDivElement>(null);

    const choices = rows.filter((r) => r.kind === "choice");
    const defaultKey = (choices.find((r) => r.isDefault) ?? choices[0])?.key ?? null;
    const inputs: OptionInput[] = rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      kind: r.kind,
      label: r.label.trim(),
      extra: readPrice(r.price),
      isDefault: r.kind === "choice" && r.key === defaultKey,
    }));

    useImperativeHandle(ref, () => ({
      check() {
        const p = optionProblem(inputs);
        if (!p) {
          setProblem(null);
          return true;
        }
        const key = p.index === null ? null : rows[p.index]!.key;
        setProblem({ message: p.message, key, kind: p.kind });
        requestAnimationFrame(() => {
          const el = key ? box.current?.querySelector<HTMLElement>(`[data-row="${key}"] input`) : box.current?.querySelector<HTMLElement>(`[data-add="${p.kind}"]`);
          el?.focus();
        });
        return false;
      },
    }));

    function update(next: Row[]) {
      setRows(next);
      setProblem(null);
      onChange();
    }
    const edit = (key: string, patch: Partial<Row>) => update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    function add(kind: OptionKind) {
      const key = newKey();
      update([...rows, { key, kind, label: "", price: "", isDefault: false, added: true }]);
      requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-row="${key}"] input`)?.focus());
    }

    // Up and down move within the row's own list. A reorder is instant; the moved row keeps focus.
    function move(key: string, dir: -1 | 1) {
      const row = rows.find((r) => r.key === key)!;
      const same = rows.filter((r) => r.kind === row.kind);
      const i = same.indexOf(row);
      const j = i + dir;
      if (j < 0 || j >= same.length) return;
      [same[i], same[j]] = [same[j]!, same[i]!];
      const other = rows.filter((r) => r.kind !== row.kind);
      update(row.kind === "choice" ? [...same, ...other] : [...other, ...same]);
      requestAnimationFrame(() => {
        const at = box.current?.querySelector<HTMLElement>(`[data-row="${key}"]`);
        const btn = at?.querySelector<HTMLButtonElement>(`[data-move="${dir}"]:not(:disabled)`) ?? at?.querySelector<HTMLButtonElement>(`[data-move="${-dir}"]`);
        btn?.focus();
      });
    }

    function remove(key: string) {
      const row = rows.find((r) => r.key === key)!;
      const same = rows.filter((r) => r.kind === row.kind);
      const next = same[same.indexOf(row) + 1] ?? same[same.indexOf(row) - 1];
      update(rows.filter((r) => r.key !== key));
      requestAnimationFrame(() => {
        const el = next ? box.current?.querySelector<HTMLElement>(`[data-row="${next.key}"] input`) : box.current?.querySelector<HTMLElement>(`[data-add="${row.kind}"]`);
        el?.focus();
      });
    }

    const list = (kind: OptionKind) => {
      const these = rows.filter((r) => r.kind === kind);
      const word = kind === "choice" ? "choice" : "extra";
      const full = these.length >= OPTIONS_PER_KIND;
      const listProblem = problem && problem.kind === kind ? problem : null;
      return (
        <fieldset className="@container flex min-w-0 flex-col gap-2">
          <legend className="text-sm font-semibold">
            {kind === "choice" ? "Comes with" : "Extras"}{" "}
            <span className="font-normal text-ink-soft">{kind === "choice" ? "(customer picks one)" : "(customer adds any)"}</span>
          </legend>
          <p className="text-[13px] text-ink-soft">
            {kind === "choice"
              ? "Customers pick one. The default is picked for them unless they change it."
              : "Customers can add any of these, one of each per plate."}
          </p>
          {these.length > 0 && (
            <ul className="flex flex-col">
              {these.map((r, i) => {
                const name = r.label.trim() || `this ${word}`;
                const bad = listProblem?.key === r.key;
                const labelBad = bad && (listProblem!.message === OPTION_MESSAGES.label || listProblem!.message === OPTION_MESSAGES.labelLong || listProblem!.message === OPTION_MESSAGES.duplicate || listProblem!.message === OPTION_MESSAGES.oneChoice);
                const priceBad = bad && !labelBad;
                return (
                  <li
                    key={r.key}
                    data-row={r.key}
                    className={`${r.added ? "dish-in" : ""} flex flex-col gap-2 border-t border-sand py-2.5 first:border-t-0 @min-[44rem]:flex-row @min-[44rem]:items-center`}
                  >
                    <input
                      value={r.label}
                      onChange={(e) => edit(r.key, { label: e.target.value })}
                      maxLength={OPTION_LABEL_MAX}
                      aria-label={`${kind === "choice" ? "Choice" : "Extra"} ${i + 1} name`}
                      aria-invalid={labelBad || undefined}
                      placeholder={kind === "choice" ? "Rice" : "Avocado"}
                      enterKeyHint="done"
                      className={`${input} w-full min-w-0 @min-[44rem]:flex-1`}
                    />
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft">
                        <span>{kind === "choice" ? "Extra" : "Price"}</span>
                        <span className="relative">
                          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-soft">
                            KSh
                          </span>
                          <input
                            value={r.price}
                            onChange={(e) => edit(r.key, { price: e.target.value })}
                            inputMode="numeric"
                            enterKeyHint="done"
                            aria-label={`${kind === "choice" ? "Extra price for" : "Price of"} ${name}, KSh`}
                            aria-invalid={priceBad || undefined}
                            placeholder={kind === "choice" ? "Included" : "30"}
                            className={`${input} w-[120px] pl-11 pr-2 tabular-nums`}
                          />
                        </span>
                      </label>
                      {kind === "choice" && (
                        <label className="press flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[13px] font-semibold text-ink-soft touch-manipulation select-none">
                          <input
                            type="radio"
                            name="option-default"
                            checked={r.key === defaultKey}
                            aria-label={`Default: ${name}`}
                            onChange={() => update(rows.map((x) => (x.kind === "choice" ? { ...x, isDefault: x.key === r.key } : x)))}
                            className="size-5 accent-teal-deep"
                          />
                          Default
                        </label>
                      )}
                      <button type="button" data-move="-1" onClick={() => move(r.key, -1)} disabled={i === 0} aria-label={`Move ${name} up`} className={iconBtn}>
                        <UpIcon />
                      </button>
                      <button type="button" data-move="1" onClick={() => move(r.key, 1)} disabled={i === these.length - 1} aria-label={`Move ${name} down`} className={iconBtn}>
                        <DownIcon />
                      </button>
                      <button type="button" onClick={() => remove(r.key)} aria-label={`Remove ${name}`} className={iconBtn}>
                        <CloseIcon />
                      </button>
                      {r.id && (
                        <OutTodaySwitch
                          label={r.label.trim() || saved.find((s) => s.id === r.id)?.label || ""}
                          on={!!outs.out[r.id]}
                          busy={outs.busy === r.id}
                          onChange={(v) => outs.toggle(r.id!, saved.find((s) => s.id === r.id)?.label ?? r.label, v)}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {listProblem && (
            <p role="alert" className="note-in text-[13px] font-semibold text-coral-ink">
              {listProblem.message}
            </p>
          )}
          {full ? (
            <p className="text-[13px] text-ink-soft">{kind === "choice" ? OPTION_MESSAGES.manyChoices : OPTION_MESSAGES.manyExtras}</p>
          ) : (
            <button
              type="button"
              data-add={kind}
              onClick={() => add(kind)}
              className="press flex min-h-11 items-center gap-1.5 self-start rounded-[var(--r-sm)] px-1 text-sm font-semibold text-teal-deep touch-manipulation select-none hover:underline"
            >
              <PlusIcon size={16} /> {kind === "choice" ? "Add a choice" : "Add an extra"}
            </button>
          )}
        </fieldset>
      );
    };

    return (
      <div ref={box} className="flex flex-col gap-5">
        <input type="hidden" name="options" value={JSON.stringify(inputs)} />
        {list("choice")}
        {list("extra")}
        <OutNotes dishName={dishName} note={outs.note} allChoicesOut={outs.allChoicesOut} />
      </div>
    );
  },
);
