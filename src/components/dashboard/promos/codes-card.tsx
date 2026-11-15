"use client";
import { useEffect, useId, useOptimistic, useState, useTransition } from "react";
import { codeAction, codeIsFree, saveCode, type CodeField } from "@/app/dashboard/promos/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { Switch } from "@/components/dashboard/switch";
import { PanelHeading } from "@/components/dashboard/tables/ui";
import { ctl, errorLine, field, hint, labelText, primary, quiet } from "@/components/ui-classes";
import { PageNote } from "@/components/ui-parts";
import { addDays, formatKes } from "@/lib/format";
import {
  CODE_CAP_DEFAULT,
  CODE_MAX,
  MODE_LABEL,
  ORDER_MODES,
  cleanCode,
  codeEnded,
  codeGives,
  codeLimits,
  codeSummary,
  codeUsed,
  count,
  shortDate,
  type CodeKind,
  type CodeRow,
  type OrderMode,
} from "@/lib/promos";

type Note = { text: string; tone: "info" | "error" };
type Open = { id: string | null; seq: number };

/** Discount codes (spec 2.11 "Your promos" 3): a table from 1024 px, cards below; ended codes behind a toggle. */
export function CodesCard({ codes, today }: { codes: CodeRow[]; today: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const show = (id: string | null) => (setOpen((o) => ({ id, seq: (o?.seq ?? 0) + 1 })), setVisible(true));
  const code = open?.id ? codes.find((c) => c.id === open.id) ?? null : null;
  const current = codes.filter((c) => !codeEnded(c, today));
  const ended = codes.filter((c) => codeEnded(c, today));
  const shown = showEnded ? [...current, ...ended] : current;

  return (
    <article aria-labelledby="codes-title" className="flex flex-col gap-3 rounded-[18px] bg-paper p-4 ring-1 ring-sand min-[600px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="codes-title" className="text-[17px] font-semibold text-ink">
          Discount codes
        </h2>
        <button type="button" onClick={() => show(null)} className={`${quiet} min-h-11 px-4`}>
          New code
        </button>
      </div>
      <p className={hint}>Customers type a code in the cart. It takes money off dishes, never combos or the delivery fee.</p>
      {note && <PageNote text={note.text} tone={note.tone} />}
      {codes.length === 0 ? (
        <p className="text-[15px] text-ink-soft">No codes yet.</p>
      ) : (
        <>
          {current.length === 0 && !showEnded && <p className="text-[15px] text-ink-soft">No codes running. Ended codes are below.</p>}
          {shown.length > 0 && (
            <>
              <table className="hidden w-full border-collapse text-left text-[14px] lg:table">
                <thead>
                  <tr className="text-[13px] font-semibold text-ink-soft">
                    <th scope="col" className="py-2 pr-3 font-semibold">Code</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Gives</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Limits</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Used</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Given</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Ends</th>
                    <th scope="col" className="py-2 font-semibold">
                      <span className="sr-only">On</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <CodeLine key={c.id} code={c} today={today} layout="row" onOpen={() => show(c.id)} onNote={setNote} />
                  ))}
                </tbody>
              </table>
              <ul className="flex flex-col lg:hidden">
                {shown.map((c) => (
                  <CodeLine key={c.id} code={c} today={today} layout="card" onOpen={() => show(c.id)} onNote={setNote} />
                ))}
              </ul>
            </>
          )}
          {ended.length > 0 && (
            <button type="button" onClick={() => setShowEnded((s) => !s)} aria-expanded={showEnded} className={`${quiet} min-h-11 self-start px-4`}>
              {showEnded ? "Hide ended codes" : `Show ended codes (${count(ended.length)})`}
            </button>
          )}
        </>
      )}
      {open && (open.id === null || code) && (
        <CodeSheet
          key={open.seq}
          open={visible}
          code={code}
          today={today}
          onClose={() => setVisible(false)}
          onDone={(text) => (setNote({ text, tone: "info" }), setVisible(false))}
        />
      )}
    </article>
  );
}

function CodeLine({ code: c, today, layout, onOpen, onNote }: { code: CodeRow; today: string; layout: "row" | "card"; onOpen: () => void; onNote: (n: Note) => void }) {
  const [on, setOn] = useOptimistic(c.active);
  const [, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const isEnded = codeEnded(c, today);
  const ends = isEnded ? `Ended ${shortDate(c.ends_on)}` : c.starts_on > today ? `Starts ${shortDate(c.starts_on)} · ends ${shortDate(c.ends_on)}` : shortDate(c.ends_on);

  function toggle(next: boolean) {
    start(async () => {
      setOn(next);
      const r = await codeAction(c.id, next ? "on" : "off");
      if (r.ok) return onNote({ text: next ? `Switched on ${c.code}.` : `Switched off ${c.code}. Customers can’t use it now.`, tone: "info" });
      onNote({ text: r.error, tone: "error" });
      if (r.stale) reportRefusal(r.error);
    });
  }
  const sw = <Switch checked={on} onChange={toggle} label={`${c.code} on`} className="min-h-11 shrink-0 px-1" />;
  const codeText = <span className="font-mono text-[15px] font-bold tracking-wide text-ink [overflow-wrap:anywhere]">{c.code}</span>;

  if (layout === "row") {
    return (
      <tr className={`border-t border-sand align-middle ${isEnded ? "text-ink-soft" : "text-ink"}`}>
        <td className="py-2 pr-3">
          <button type="button" onClick={onOpen} aria-label={`Edit ${c.code}`} className={`${ctl} -ml-1 inline-flex min-h-11 items-center rounded-[var(--r-sm)] px-1 hover:underline`}>
            {codeText}
          </button>
        </td>
        <td className="py-2 pr-3">{codeGives(c)}</td>
        <td className="py-2 pr-3 text-ink-soft">{codeLimits(c)}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{codeUsed(c)}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{formatKes(c.discount_given)}</td>
        <td className="py-2 pr-3 whitespace-nowrap">{ends}</td>
        <td className="py-2 text-right">{sw}</td>
      </tr>
    );
  }
  return (
    <li className="flex items-start gap-3 border-t border-sand py-3 first:border-t-0 first:pt-1">
      <button type="button" onClick={onOpen} className={`${ctl} flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--r-sm)] text-left`}>
        {codeText}
        <span className="text-[15px] text-ink">{codeGives(c)}</span>
        <span className="text-[14px] text-ink-soft [overflow-wrap:anywhere]">{codeLimits(c)}</span>
        <span className="flex flex-wrap gap-x-1.5 text-[14px] text-ink-soft tabular-nums">
          <span className="whitespace-nowrap">Used {codeUsed(c)} ·</span>
          <span className="whitespace-nowrap">Given {formatKes(c.discount_given)} ·</span>
          <span className="whitespace-nowrap">{isEnded ? ends : `Ends ${ends}`}</span>
        </span>
      </button>
      {sw}
    </li>
  );
}

type Form = {
  code: string;
  kind: CodeKind;
  value: string;
  cap: string;
  starts_on: string;
  ends_on: string;
  max_uses: string;
  once_per_phone: boolean;
  min_order: string;
  modes: OrderMode[];
};
const digits = (s: string, n: number) => s.replace(/[^\d]/g, "").slice(0, n);
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

function CodeSheet({ open, code, today, onClose, onDone }: { open: boolean; code: CodeRow | null; today: string; onClose: () => void; onDone: (text: string) => void }) {
  const [v, setV] = useState<Form>(() =>
    code
      ? {
          code: code.code,
          kind: code.kind,
          value: String(code.value),
          cap: code.cap_kes ? String(code.cap_kes) : String(CODE_CAP_DEFAULT),
          starts_on: code.starts_on,
          ends_on: code.ends_on,
          max_uses: code.max_uses ? String(code.max_uses) : "",
          once_per_phone: code.once_per_phone,
          min_order: code.min_order_kes ? String(code.min_order_kes) : "",
          modes: code.modes,
        }
      : { code: "", kind: "percent", value: "", cap: String(CODE_CAP_DEFAULT), starts_on: today, ends_on: addDays(today, 30), max_uses: "", once_per_phone: true, min_order: "", modes: [...ORDER_MODES] },
  );
  const [err, setErr] = useState<{ field: CodeField; text: string } | null>(null);
  const [free, setFree] = useState<{ code: string; free: boolean } | null>(null);
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const ids = { code: useId(), value: useId(), cap: useId(), starts: useId(), ends: useId(), uses: useId(), min: useId(), used: useId() };
  const locked = (code?.uses ?? 0) > 0;
  const set = <K extends keyof Form>(k: K, x: Form[K]) => (setV((f) => ({ ...f, [k]: x })), setErr(null));
  const errFor = (f: CodeField) => (err?.field === f ? err.text : null);

  // The live "is free / is taken" check, a moment after typing stops.
  useEffect(() => {
    if (locked || v.code.length < 3 || v.code === code?.code) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await codeIsFree(v.code, code?.id ?? null);
      if (live && r !== null) setFree({ code: v.code, free: r });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [v.code, code?.code, code?.id, locked]);
  const freeNow = free && free.code === v.code && v.code !== code?.code ? free.free : null;

  const value = toNum(v.value);
  const cap = toNum(v.cap);
  const summary = codeSummary(
    { kind: v.kind, value, cap_kes: v.kind === "percent" ? cap : null, starts_on: v.starts_on, ends_on: v.ends_on, once_per_phone: v.once_per_phone, min_order_kes: toNum(v.min_order), max_uses: toNum(v.max_uses), modes: v.modes },
    today,
  );

  function check(): { field: CodeField; text: string } | null {
    if (!/^[A-Z0-9]{3,20}$/.test(v.code)) return { field: "code", text: "A code is 3 to 20 letters and numbers." };
    if (freeNow === false) return { field: "code", text: `${v.code} is taken. Pick another code.` };
    if (v.kind === "percent" && (value === null || value < 1 || value > 90)) return { field: "value", text: "A percentage is 1 to 90." };
    if (v.kind === "amount" && (value === null || value < 10 || value > 5000)) return { field: "value", text: "A fixed amount is KSh 10 to 5,000." };
    if (v.kind === "percent" && (cap === null || cap < 1)) return { field: "cap", text: "Enter the most one order can save, in shillings." };
    if (!v.starts_on || !v.ends_on) return { field: "dates", text: "Pick a start and an end date." };
    if (v.ends_on < v.starts_on) return { field: "dates", text: "The end date is before the start." };
    if (!code && v.ends_on < today) return { field: "dates", text: "Pick an end date from today on." };
    if (v.max_uses !== "" && Number(v.max_uses) < 1) return { field: "max_uses", text: "Total uses is a number from 1." };
    if (v.min_order !== "" && Number(v.min_order) < 1) return { field: "min_order", text: "Enter the minimum in shillings." };
    if (v.modes.length === 0) return { field: "modes", text: "Pick at least one order type." };
    return null;
  }

  function submit() {
    if (pending) return;
    const bad = check();
    if (bad) return setErr(bad);
    start(async () => {
      const r = await saveCode({
        id: code?.id ?? null,
        code: v.code,
        kind: v.kind,
        value: value!,
        cap_kes: v.kind === "percent" ? cap : null,
        starts_on: v.starts_on,
        ends_on: v.ends_on,
        max_uses: toNum(v.max_uses),
        once_per_phone: v.once_per_phone,
        min_order_kes: toNum(v.min_order),
        modes: ORDER_MODES.filter((m) => v.modes.includes(m)),
      });
      if (r.ok) return onDone(code ? `Saved ${v.code}.` : `Made ${v.code}. Customers can use it from ${v.starts_on > today ? shortDate(v.starts_on) : "now"}.`);
      setErr({ field: r.field, text: r.error });
      if (r.stale) reportRefusal(r.error);
    });
  }

  const footer = (
    <div className="flex flex-col gap-2">
      {summary && <p className="text-[14px] text-ink [overflow-wrap:anywhere]">{summary}</p>}
      {errFor("form") && (
        <p role="alert" className={errorLine}>
          {errFor("form")}
        </p>
      )}
      <button type="button" onClick={submit} aria-disabled={pending || undefined} className={`${primary} w-full aria-disabled:opacity-60`}>
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );

  const numberField = (id: string, label: string, val: string, onChange: (s: string) => void, opts: { max: number; placeholder?: string; describedBy?: string; bad?: boolean; readOnly?: boolean; className?: string }) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelText}>
        {label}
      </label>
      <input
        id={id}
        value={val}
        onChange={(e) => onChange(digits(e.target.value, opts.max))}
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="next"
        placeholder={opts.placeholder}
        readOnly={opts.readOnly}
        aria-readonly={opts.readOnly || undefined}
        aria-invalid={opts.bad || undefined}
        aria-describedby={opts.describedBy}
        className={`${field} tabular-nums read-only:bg-cream read-only:text-ink-soft ${opts.className ?? ""}`}
      />
    </div>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="code-sheet-title" footer={footer}>
      <PanelHeading id="code-sheet-title" title={code ? code.code : "New code"} sub="Money off dishes for customers who type the code." onClose={onClose} />
      <form noValidate onSubmit={(e) => (e.preventDefault(), submit())} className="mt-5 flex flex-col gap-5 pb-2">
        {locked && (
          <p id={ids.used} className="rounded-[var(--r-md)] bg-cream px-3 py-2 text-[14px] text-ink">
            Used {count(code!.uses)} {code!.uses === 1 ? "time" : "times"}, so what it gives can’t change. Make a new code instead.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.code} className={labelText}>
            Code
          </label>
          <input
            id={ids.code}
            value={v.code}
            onChange={(e) => set("code", cleanCode(e.target.value))}
            maxLength={CODE_MAX}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="next"
            placeholder="KARIBU10"
            readOnly={locked}
            aria-readonly={locked || undefined}
            aria-invalid={errFor("code") || freeNow === false ? true : undefined}
            aria-describedby={`${ids.code}-note${locked ? ` ${ids.used}` : ""}`}
            className={`${field} font-mono tracking-wide read-only:bg-cream read-only:text-ink-soft min-[600px]:max-w-[16rem]`}
          />
          <p id={`${ids.code}-note`} role={errFor("code") ? "alert" : undefined} aria-live="polite" className={errFor("code") || freeNow === false ? errorLine : freeNow ? "text-[13px] font-semibold text-teal-deep" : hint}>
            {errFor("code") ?? (freeNow === false ? `${v.code} is taken` : freeNow ? `${v.code} is free` : "3 to 20 letters and numbers. Customers can type it in any case.")}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={locked} aria-describedby={locked ? ids.used : undefined}>
          <legend className={`${labelText} mb-2`}>Gives</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["percent", "Percentage"],
                ["amount", "Fixed amount"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className={`${ctl} flex min-h-14 cursor-pointer items-center gap-2 rounded-[var(--r-md)] bg-paper px-3 text-[15px] font-semibold ring-inset has-[:disabled]:cursor-default has-[:disabled]:opacity-60 ${v.kind === k ? "ring-2 ring-teal-deep" : "ring-1 ring-field"}`}
              >
                <input type="radio" name="kind" value={k} checked={v.kind === k} onChange={() => (set("kind", k), set("value", ""))} className="size-5 accent-teal-deep" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            {numberField(ids.value, v.kind === "percent" ? "Amount (%)" : "Amount (KSh)", v.value, (s) => set("value", s), {
              max: v.kind === "percent" ? 2 : 4,
              placeholder: v.kind === "percent" ? "10" : "100",
              bad: Boolean(errFor("value")),
              readOnly: locked,
              describedBy: errFor("value") ? `${ids.value}-note` : locked ? ids.used : undefined,
            })}
            {v.kind === "percent" &&
              numberField(ids.cap, "Cap (KSh)", v.cap, (s) => set("cap", s), {
                max: 5,
                bad: Boolean(errFor("cap")),
                readOnly: locked,
                describedBy: `${ids.cap}-note`,
              })}
          </div>
          {errFor("value") ? (
            <p id={`${ids.value}-note`} role="alert" className={errorLine}>
              {errFor("value")}
            </p>
          ) : errFor("cap") ? (
            <p id={`${ids.cap}-note`} role="alert" className={errorLine}>
              {errFor("cap")}
            </p>
          ) : (
            v.kind === "percent" && (
              <p id={`${ids.cap}-note`} className={hint}>
                The cap is the most one order can save.
              </p>
            )
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            <DateField id={ids.starts} label="Starts" value={v.starts_on} bad={Boolean(errFor("dates"))} onChange={(s) => set("starts_on", s)} />
            <DateField id={ids.ends} label="Ends" value={v.ends_on} min={v.starts_on} bad={Boolean(errFor("dates"))} onChange={(s) => set("ends_on", s)} />
          </div>
          {errFor("dates") ? (
            <p role="alert" className={errorLine}>
              {errFor("dates")}
            </p>
          ) : (
            <p className={hint}>It works until midnight at the end of the last day.</p>
          )}
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[15px] font-semibold text-ink">Limits</legend>
          <div className="grid grid-cols-2 gap-3">
            {numberField(ids.uses, "Total uses", v.max_uses, (s) => set("max_uses", s), { max: 6, placeholder: "No limit", bad: Boolean(errFor("max_uses")) })}
            {numberField(ids.min, "Minimum order (KSh)", v.min_order, (s) => set("min_order", s), { max: 6, placeholder: "None", bad: Boolean(errFor("min_order")) })}
          </div>
          {(errFor("max_uses") || errFor("min_order")) && (
            <p role="alert" className={errorLine}>
              {errFor("max_uses") ?? errFor("min_order")}
            </p>
          )}
          <Switch checked={v.once_per_phone} onChange={(on) => set("once_per_phone", on)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
            <span className="text-[15px] font-semibold text-ink">Once per phone number</span>
          </Switch>
          <fieldset className="flex flex-col gap-1">
            <legend className={`${labelText} mb-1`}>Order types</legend>
            <div className="flex flex-wrap gap-x-5">
              {ORDER_MODES.map((m) => (
                <label key={m} className={`${ctl} flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--r-sm)] text-[15px] text-ink`}>
                  <input
                    type="checkbox"
                    checked={v.modes.includes(m)}
                    onChange={(e) => set("modes", e.target.checked ? [...v.modes, m] : v.modes.filter((x) => x !== m))}
                    className="size-5 accent-teal-deep"
                  />
                  {MODE_LABEL[m]}
                </label>
              ))}
            </div>
            {errFor("modes") && (
              <p role="alert" className={errorLine}>
                {errFor("modes")}
              </p>
            )}
          </fieldset>
        </fieldset>
      </form>
    </PlannerSheet>
  );
}

function DateField({ id, label, value, min, bad, onChange }: { id: string; label: string; value: string; min?: string; bad: boolean; onChange: (s: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelText}>
        {label}
      </label>
      <input id={id} type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} aria-invalid={bad || undefined} className={field} />
    </div>
  );
}
