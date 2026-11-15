"use client";
// Shared pieces of the table and zone panels (spec-2.6 "Tables & delivery"): the heading row,
// buttons, fields and notes, from the planner panel's look (DESIGN.md "Sheet", "Fields").

import { ctl } from "@/components/ui-classes";
export { danger, errorLine, field, hint, labelText, linkBtn, primary, quiet } from "@/components/ui-classes";
export { PageNote, Segments } from "@/components/ui-parts";

export function PanelHeading({ id, title, sub, onClose }: { id: string; title: string; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 id={id} tabIndex={-1} className="font-display text-[28px] leading-tight text-ink outline-none [overflow-wrap:anywhere]">
          {title}
        </h2>
        {sub && <p className="mt-1 text-[14px] text-ink-soft">{sub}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className={`${ctl} -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
