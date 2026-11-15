"use client";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { addNamedTable, addTables, renameTable, resetTableCode, setTableActive } from "@/app/dashboard/tables/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { Switch } from "@/components/dashboard/switch";
import { TABLE_MESSAGES, addsLine, nextTableLabels } from "@/lib/tables";
import { PageNote, PanelHeading, Segments, danger, errorLine, field, hint, labelText, linkBtn, primary, quiet } from "./ui";

export type TableCard = { id: string; label: string; url: string; svg: string; active: boolean };

const OFF_LINE = "Off · customers can’t order from this QR";
const REFRESH_AFTER_REFUSAL_MS = 3000;

type Panel = { kind: "table"; id: string } | { kind: "add" };

/**
 * Tables (spec-2.6 "Tables & delivery"): the card grid, Print, the table and Add tables panels,
 * and the print sheet. Print this card prints the same sheet with `?only=<id>`.
 */
export function TablesView({ tables, edits, only: initialOnly }: { tables: TableCard[]; edits: boolean; only: string | null }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(initialOnly);
  const active = tables.filter((t) => t.active);

  useEffect(() => {
    // After printing one card, the sheet and the address go back to all cards.
    const after = () => {
      setOnly(null);
      const url = new URL(window.location.href);
      if (!url.searchParams.has("only")) return;
      url.searchParams.delete("only");
      window.history.replaceState(window.history.state, "", url);
    };
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, []);

  function print(id: string | null) {
    flushSync(() => setOnly(id));
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("only", id);
    else url.searchParams.delete("only");
    window.history.replaceState(window.history.state, "", url);
    window.print();
  }

  function show(p: Panel) {
    setPanel(p);
    setSeq((n) => n + 1);
    setOpen(true);
  }

  const current = panel?.kind === "table" ? tables.find((t) => t.id === panel.id) : undefined;
  const printed = only ? tables.filter((t) => t.id === only) : active;

  return (
    <>
      <section aria-label="Tables" className="flex flex-col gap-4 print:hidden">
        <p className="text-[15px] text-ink-soft">Each table has its own QR code. Scanning it opens the menu for that table.</p>
        {(active.length > 0 || edits) && (
          <div className="flex flex-col gap-2 min-[600px]:flex-row">
            {active.length > 0 && (
              <button type="button" onClick={() => print(null)} className={`${primary} w-full min-[600px]:w-auto`}>
                Print QR cards · {active.length}
              </button>
            )}
            {edits && (
              <button type="button" onClick={() => show({ kind: "add" })} className={`${quiet} w-full min-[600px]:w-auto`}>
                Add tables
              </button>
            )}
          </div>
        )}
        {note && <PageNote text={note} />}

        {tables.length === 0 ? (
          <p className="rounded-[18px] bg-paper p-5 text-[15px] text-ink-soft ring-1 ring-sand">
            {edits ? "No tables yet. Add them to get their QR codes." : "No tables yet."}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 min-[1280px]:grid-cols-4">
            {tables.map((t) => (
              <li key={t.id} className="min-w-0">
                <Card t={t} onOpen={edits ? () => show({ kind: "table", id: t.id }) : undefined} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <PrintSheet tables={printed} />

      {panel?.kind === "table" && current && (
        <TablePanel key={seq} open={open} t={current} onClose={() => setOpen(false)} onPrint={() => print(current.id)} />
      )}
      {panel?.kind === "add" && (
        <AddTablesPanel
          key={seq}
          open={open}
          labels={tables.map((t) => t.label)}
          onClose={() => setOpen(false)}
          onAdded={(text) => {
            setNote(text);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function Card({ t, onOpen }: { t: TableCard; onOpen?: () => void }) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`block size-[120px] min-[600px]:size-[84px] [&>svg]:size-full ${t.active ? "" : "opacity-40"}`}
        dangerouslySetInnerHTML={{ __html: t.svg }}
      />
      <span className="max-w-full text-[15px] font-bold [overflow-wrap:anywhere]">{t.label}</span>
      <span className={`text-[13px] ${t.active ? "text-ink-soft" : "font-semibold text-amber-ink"}`}>{t.active ? "On" : OFF_LINE}</span>
    </>
  );
  const box = "flex h-full w-full flex-col items-center gap-2 rounded-[18px] bg-paper p-4 text-center ring-1 ring-sand";
  if (!onOpen) return <div className={box}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t.label}, ${t.active ? "on" : "off"}. Open its settings`}
      className={`${box} press touch-manipulation select-none [-webkit-touch-callout:none] hover:ring-sand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep`}
    >
      {body}
    </button>
  );
}

/** The printed cards: 2 across on A4 with dashed cut lines, no navigation (spec-2.2). */
function PrintSheet({ tables }: { tables: TableCard[] }) {
  return (
    <section aria-hidden="true" className="hidden print:grid print:grid-cols-2 print:gap-6">
      {tables.map((t) => (
        <article key={t.id} className="flex flex-col items-center gap-3 border-2 border-dashed border-line p-8 text-center break-inside-avoid">
          <div className="flex items-center gap-2">
            <Image src="/brand/dausis-plate-icon.svg" alt="" width={28} height={28} />
            <span className="font-display text-lg">Dausis Plate</span>
          </div>
          <span className="font-display text-3xl">{t.label}</span>
          <div className="w-56 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: t.svg }} />
          <span className="text-[15px] font-semibold">Scan to see the menu &amp; order</span>
          <span className="font-script text-xl text-coral-text">Mama’s Flavour.</span>
        </article>
      ))}
    </section>
  );
}

// ───────── the table's panel ─────────

function TablePanel({ open, t, onClose, onPrint }: { open: boolean; t: TableCard; onClose: () => void; onPrint: () => void }) {
  const [name, setName] = useState(t.label);
  const [on, setOn] = useState(t.active);
  const [errors, setErrors] = useState<{ name?: string; on?: string; code?: string }>({});
  const [named, setNamed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [newCode, setNewCode] = useState(false);
  const [busy, setBusy] = useState<"name" | "on" | "code" | null>(null);
  const [, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();
  useEffect(() => setOn(t.active), [t.active]);

  const refused = (r: { error: string; stale?: boolean }, key: "name" | "on" | "code") => {
    setErrors((e) => ({ ...e, [key]: r.error }));
    if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
  };

  function rename(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v || v.length > 40) return setErrors((x) => ({ ...x, name: TABLE_MESSAGES.name }));
    if (v === t.label || busy) return;
    setBusy("name");
    startTransition(async () => {
      const r = await renameTable(t.id, v);
      setBusy(null);
      if (r) return refused(r, "name");
      setNamed(true);
    });
  }

  function toggle(v: boolean) {
    if (busy === "on") return;
    setOn(v);
    setErrors((x) => ({ ...x, on: undefined }));
    setBusy("on");
    startTransition(async () => {
      const r = await setTableActive(t.id, v);
      setBusy(null);
      if (r) {
        setOn(!v);
        refused(r, "on");
      }
    });
  }

  function makeCode() {
    setBusy("code");
    startTransition(async () => {
      const r = await resetTableCode(t.id);
      setBusy(null);
      setAsking(false);
      if (r) return refused(r, "code");
      setNewCode(true);
    });
  }

  const changed = name.trim() !== t.label;
  const footer = (
    <button type="button" onClick={onPrint} className={`${primary} w-full`}>
      Print this card
    </button>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="table-panel-title" footer={footer}>
      <PanelHeading id="table-panel-title" title={t.label} sub={on ? "On · customers can order from this QR" : OFF_LINE} onClose={onClose} />

      <div className="mt-5 flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <span
            role="img"
            aria-label={`QR code for ${t.label}`}
            className={`block size-[120px] shrink-0 [&>svg]:size-full ${on ? "" : "opacity-40"}`}
            dangerouslySetInnerHTML={{ __html: t.svg }}
          />
          <a href={t.url} target="_blank" rel="noreferrer" className={`${linkBtn} min-w-0`}>
            Open this table’s menu
          </a>
        </div>

        <form onSubmit={rename} className="flex flex-col gap-1.5">
          <label htmlFor="table-name" className={labelText}>
            Name
          </label>
          <div className="flex gap-2">
            <input
              id="table-name"
              value={name}
              maxLength={40}
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => (setName(e.target.value), setNamed(false), setErrors((x) => ({ ...x, name: undefined })))}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "table-name-err" : undefined}
              className={field}
            />
            <button type="submit" disabled={!changed || busy === "name"} className={`${quiet} shrink-0`}>
              {busy === "name" ? "Saving…" : "Rename"}
            </button>
          </div>
          {errors.name && (
            <p id="table-name-err" role="alert" className={errorLine}>
              {errors.name}
            </p>
          )}
          <div aria-live="polite">{named && !changed && <p className="note-in text-[14px] text-teal-deeper">Name saved.</p>}</div>
        </form>

        <div className="flex flex-col gap-1.5 border-t border-sand pt-5">
          <Switch checked={on} onChange={toggle} className="min-h-12 w-full justify-between gap-3 text-left">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">On</span>
              <span className={hint}>Off stops orders from this QR. Turning it on again brings it back.</span>
            </span>
          </Switch>
          {errors.on && (
            <p role="alert" className={errorLine}>
              {errors.on}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-sand pt-5">
          {!asking && (
            <button type="button" onClick={() => (setAsking(true), setNewCode(false), setErrors((x) => ({ ...x, code: undefined })))} className={`${quiet} self-start`}>
              New code
            </button>
          )}
          {asking && (
            <div role="group" aria-labelledby="new-code-q" className="note-in flex flex-col gap-3 rounded-[var(--r-md)] bg-paper p-4 ring-1 ring-sand">
              <p id="new-code-q" className="text-[15px] leading-snug">
                Make a new code for {t.label}? The printed card stops working at once. Print the new card before putting it on the table.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAsking(false)} disabled={busy === "code"} className={quiet}>
                  Keep this code
                </button>
                <button type="button" onClick={makeCode} disabled={busy === "code"} className={danger}>
                  {busy === "code" ? "Making…" : "Make new code"}
                </button>
              </div>
            </div>
          )}
          {errors.code && (
            <p role="alert" className={errorLine}>
              {errors.code}
            </p>
          )}
          <div aria-live="polite">
            {newCode && (
              <p className="note-in flex flex-wrap items-baseline gap-x-3 rounded-[var(--r-sm)] bg-amber-tint px-3 py-2 text-[15px] font-semibold text-amber-ink">
                <span className="[overflow-wrap:anywhere]">New code made. Print {t.label}’s card.</span>
                <button type="button" onClick={onPrint} className={`${linkBtn} text-amber-ink`}>
                  Print this card
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </PlannerSheet>
  );
}

// ───────── Add tables ─────────

function AddTablesPanel({ open, labels, onClose, onAdded }: { open: boolean; labels: string[]; onClose: () => void; onAdded: (note: string) => void }) {
  const [mode, setMode] = useState<"numbered" | "named">("numbered");
  const [count, setCount] = useState(labels.length ? "1" : "10");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();

  const n = Number(count);
  const countOk = /^\d{1,2}$/.test(count) && n >= 1 && n <= 50;
  const step = (d: number) => (setCount(String(Math.min(50, Math.max(1, (countOk ? n : 1) + d)))), setError(null));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (mode === "numbered" && !countOk) return setError(TABLE_MESSAGES.count);
    const v = name.trim();
    if (mode === "named" && (!v || v.length > 40)) return setError(TABLE_MESSAGES.name);
    startTransition(async () => {
      const r = mode === "numbered" ? await addTables(n) : await addNamedTable(v);
      if (r) {
        setError(r.error);
        if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
        return;
      }
      if (mode === "named") return onAdded(`Added ${v}.`);
      const added = nextTableLabels(labels, n);
      onAdded(added.length === 1 ? `Added ${added[0]}.` : `Added ${added[0]} to ${added[added.length - 1]}.`);
    });
  }

  const footer = (
    <button type="submit" form="add-tables-form" disabled={pending} className={`${primary} w-full`}>
      {pending ? "Adding…" : mode === "named" ? "Add spot" : countOk && n > 1 ? `Add ${n} tables` : "Add 1 table"}
    </button>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="add-tables-title" footer={footer}>
      <PanelHeading id="add-tables-title" title="Add tables" onClose={onClose} />
      <form id="add-tables-form" onSubmit={submit} noValidate className="mt-5 flex flex-col gap-5">
        <Segments
          label="What to add"
          value={mode}
          options={[
            ["numbered", "Numbered"],
            ["named", "Named spot"],
          ]}
          onChange={(v) => (setMode(v), setError(null))}
        />
        {mode === "numbered" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-count" className={labelText}>
              How many?
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={countOk && n <= 1} aria-label="One fewer" className={`${quiet} w-12 px-0 text-xl`}>
                −
              </button>
              <input
                id="add-count"
                value={count}
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                maxLength={2}
                onChange={(e) => (setCount(e.target.value.replace(/\D/g, "")), setError(null))}
                aria-invalid={error ? true : undefined}
                aria-describedby="add-count-line"
                className={`${field} w-20 text-center tabular-nums`}
              />
              <button type="button" onClick={() => step(1)} disabled={countOk && n >= 50} aria-label="One more" className={`${quiet} w-12 px-0 text-xl`}>
                +
              </button>
            </div>
            <p id="add-count-line" className={hint}>
              {countOk ? addsLine(labels, n) : "Between 1 and 50 at a time."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-name" className={labelText}>
              Name
            </label>
            <input
              id="add-name"
              value={name}
              maxLength={40}
              placeholder="e.g. Garden bench"
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => (setName(e.target.value), setError(null))}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "add-err" : undefined}
              className={field}
            />
          </div>
        )}
        {error && (
          <p id="add-err" role="alert" className={errorLine}>
            {error}
          </p>
        )}
      </form>
    </PlannerSheet>
  );
}
