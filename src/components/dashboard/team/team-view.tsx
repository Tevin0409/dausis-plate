"use client";
import { useRef, useState } from "react";
import { PageNote, primary } from "@/components/dashboard/tables/ui";
import { signInLine, type Person } from "@/lib/team";
import { AddPanel } from "./add-panel";
import { PersonPanel } from "./person-panel";

type Panel = { kind: "add" } | { kind: "person"; id: string };

/** The Team list, the Add someone panel and each person's panel (spec-2.6 "Team"). */
export function TeamView({ people }: { people: Person[] }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  function show(p: Panel) {
    setPanel(p);
    setSeq((n) => n + 1);
    setOpen(true);
  }
  const close = () => setOpen(false);
  const closeWith = (text: string) => (setNote(text), setOpen(false));

  // The person panel reads the person from the refreshed list, so a save shows at once.
  // After Remove or Cancel invite the person leaves the list while the panel is still sliding out,
  // so the last copy stays on screen until it's gone.
  const last = useRef<Person | null>(null);
  const found = panel?.kind === "person" ? people.find((p) => p.id === panel.id) ?? null : null;
  if (found) last.current = found;
  const person = panel?.kind === "person" ? found ?? (last.current?.id === panel.id ? last.current : null) : null;
  const owners = people.filter((p) => p.role === "owner").length;

  return (
    <section aria-label="People" className="flex flex-col gap-4">
      <button type="button" onClick={() => show({ kind: "add" })} className={`${primary} w-full min-[600px]:w-auto min-[600px]:self-start`}>
        Add someone
      </button>
      {note && <PageNote text={note} />}
      <ul className="flex flex-col overflow-hidden rounded-[18px] bg-paper ring-1 ring-sand">
        {people.map((p) => (
          <li key={p.id} className="border-t border-sand first:border-t-0">
            <Row p={p} onOpen={() => show({ kind: "person", id: p.id })} />
          </li>
        ))}
      </ul>
      {panel?.kind === "add" && <AddPanel key={seq} open={open} onClose={close} onDone={closeWith} />}
      {panel?.kind === "person" && person && (
        <PersonPanel key={seq} open={open} person={person} soleOwner={person.role === "owner" && owners === 1} onClose={close} onDone={closeWith} />
      )}
    </section>
  );
}

function Row({ p, onOpen }: { p: Person; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left touch-manipulation select-none [-webkit-touch-callout:none] hover:bg-cream focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-deep"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
            {p.name}
            {p.you && <span className="font-normal text-ink-soft"> (you)</span>}
          </span>
          <RolePill role={p.role} />
        </span>
        <span className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">
          {p.email}
          {p.email && " · "}
          {signInLine(p)}
        </span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-ink-soft">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

export function RolePill({ role }: { role: Person["role"] }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
        role === "owner" ? "bg-teal-tint text-teal-deeper" : "bg-sand text-ink"
      }`}
    >
      {role === "owner" ? "Owner" : "Staff"}
    </span>
  );
}
