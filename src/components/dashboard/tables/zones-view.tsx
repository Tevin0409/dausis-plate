"use client";
import { useState, useTransition } from "react";
import { addZone, updateZone } from "@/app/dashboard/tables/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { Switch } from "@/components/dashboard/switch";
import { readKes, zoneLine, zoneProblem, type ZoneField } from "@/lib/tables";
import { PageNote, PanelHeading, errorLine, field, hint, labelText, primary } from "./ui";

export type Zone = { id: string; name: string; fee_kes: number; min_order_kes: number; active: boolean };

const REFRESH_AFTER_REFUSAL_MS = 3000;
const EMPTY = "No delivery zones yet. Customers can’t choose delivery until you add one.";

/** Delivery zones (spec-2.6 "Tables & delivery"): the list, and the zone panel for Add and edit. */
export function ZonesView({ zones, edits }: { zones: Zone[]; edits: boolean }) {
  const [panel, setPanel] = useState<{ zone: Zone | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  function show(zone: Zone | null) {
    setPanel({ zone });
    setSeq((n) => n + 1);
    setOpen(true);
  }

  return (
    <section aria-label="Delivery zones" className="flex w-full max-w-[720px] flex-col gap-4">
      <p className="text-[15px] text-ink-soft">Customers choose their area at checkout. Paused zones don’t show.</p>
      {edits && (
        <button type="button" onClick={() => show(null)} className={`${primary} w-full min-[600px]:w-auto min-[600px]:self-start`}>
          Add a zone
        </button>
      )}
      {note && <PageNote text={note} />}
      {zones.length === 0 ? (
        <p className="rounded-[18px] bg-paper p-5 text-[15px] text-ink-soft ring-1 ring-sand">{EMPTY}</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-[18px] bg-paper ring-1 ring-sand">
          {zones.map((z) => (
            <li key={z.id} className="border-t border-sand first:border-t-0">
              <Row z={z} onOpen={edits ? () => show(z) : undefined} />
            </li>
          ))}
        </ul>
      )}
      {panel && (
        <ZonePanel
          key={seq}
          open={open}
          zone={panel.zone}
          onClose={() => setOpen(false)}
          onSaved={(text) => {
            setNote(text);
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function Row({ z, onOpen }: { z: Zone; onOpen?: () => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{z.name}</span>
        <span className="text-[13px] text-ink-soft tabular-nums">{zoneLine(z.fee_kes, z.min_order_kes)}</span>
      </span>
      {!z.active && <span className="shrink-0 rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold text-ink">Paused</span>}
    </>
  );
  const box = "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left";
  if (!onOpen) return <div className={box}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${box} press touch-manipulation select-none [-webkit-touch-callout:none] hover:bg-cream focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-deep`}
    >
      {body}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-ink-soft">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

function ZonePanel({ open, zone, onClose, onSaved }: { open: boolean; zone: Zone | null; onClose: () => void; onSaved: (note: string) => void }) {
  const [name, setName] = useState(zone?.name ?? "");
  const [fee, setFee] = useState(zone ? String(zone.fee_kes) : "");
  const [minimum, setMinimum] = useState(zone && zone.min_order_kes > 0 ? String(zone.min_order_kes) : "");
  const [active, setActive] = useState(zone?.active ?? true);
  const [problem, setProblem] = useState<{ field: ZoneField | null; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();

  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => (set(e.target.value), setProblem(null));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const input = { name: name.trim(), fee: readKes(fee), minimum: readKes(minimum), active };
    const p = zoneProblem(input);
    if (p) {
      setProblem(p);
      document.getElementById(`zone-${p.field}`)?.focus();
      return;
    }
    startTransition(async () => {
      const r = zone ? await updateZone(zone.id, input) : await addZone(input);
      if (r) {
        const nameTaken = r.error.startsWith("There’s already a zone called ");
        setProblem({ field: nameTaken ? "name" : null, message: r.error });
        if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
        return;
      }
      onSaved(zone ? `${input.name} saved.` : `${input.name} added.`);
    });
  }

  const err = (f: ZoneField) => (problem?.field === f ? problem.message : null);
  const described = (f: ZoneField, extra?: string) => [err(f) ? `zone-${f}-err` : null, extra].filter(Boolean).join(" ") || undefined;
  const fieldError = (f: ZoneField) =>
    err(f) && (
      <p id={`zone-${f}-err`} role="alert" className={errorLine}>
        {err(f)}
      </p>
    );

  const footer = (
    <button type="submit" form="zone-form" disabled={pending} className={`${primary} w-full`}>
      {pending ? "Saving…" : "Save zone"}
    </button>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="zone-panel-title" footer={footer}>
      <PanelHeading id="zone-panel-title" title={zone ? zone.name : "Add a zone"} onClose={onClose} />
      <form id="zone-form" onSubmit={submit} noValidate className="mt-5 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="zone-name" className={labelText}>
            Name
          </label>
          <input
            id="zone-name"
            value={name}
            onChange={edit(setName)}
            maxLength={40}
            placeholder="e.g. Kilimani"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={described("name")}
            className={field}
          />
          {fieldError("name")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="zone-fee" className={labelText}>
            Delivery fee (KSh)
          </label>
          <input
            id="zone-fee"
            value={fee}
            onChange={edit(setFee)}
            inputMode="numeric"
            placeholder="150"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={err("fee") ? true : undefined}
            aria-describedby={described("fee")}
            className={`${field} tabular-nums`}
          />
          {fieldError("fee")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="zone-minimum" className={labelText}>
            Minimum order (KSh)
          </label>
          <input
            id="zone-minimum"
            value={minimum}
            onChange={edit(setMinimum)}
            inputMode="numeric"
            placeholder="No minimum"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={err("minimum") ? true : undefined}
            aria-describedby={described("minimum", "zone-minimum-hint")}
            className={`${field} tabular-nums`}
          />
          <p id="zone-minimum-hint" className={hint}>
            Food only, before the delivery fee. Leave empty for no minimum.
          </p>
          {fieldError("minimum")}
        </div>
        <div className="border-t border-sand pt-5">
          <Switch checked={active} onChange={(v) => (setActive(v), setProblem(null))} className="min-h-12 w-full justify-between gap-3 text-left">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">Delivering</span>
              <span className={hint}>{active ? "Customers can choose it at checkout." : "Paused: customers don’t see it at checkout."}</span>
            </span>
          </Switch>
        </div>
        {problem && problem.field === null && (
          <p role="alert" className={errorLine}>
            {problem.message}
          </p>
        )}
      </form>
    </PlannerSheet>
  );
}
