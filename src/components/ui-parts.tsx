"use client";
// Notes and segmented controls shared by the owner panels, the board and the sign-in pages.
import { ctl } from "@/components/ui-classes";

/** A page note after a panel's action: fades in with 6 px (`.note-in`), keyed so a repeat replays. */
export function PageNote({ text, tone = "info", children }: { text: string; tone?: "info" | "error"; children?: React.ReactNode }) {
  return (
    <p
      key={text}
      role={tone === "error" ? "alert" : "status"}
      className={`note-in flex flex-wrap items-baseline gap-x-3 rounded-[var(--r-sm)] px-4 py-3 text-[15px] ${
        tone === "error" ? "bg-blush font-semibold text-coral-ink" : "bg-teal-tint text-teal-deeper"
      }`}
    >
      <span className="[overflow-wrap:anywhere]">{text}</span>
      {children}
    </p>
  );
}

/** Two or three segments that switch a panel's mode; the pressed one changes at once. */
export function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-[14px] bg-sand p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`${ctl} flex min-h-11 items-center justify-center rounded-[10px] px-2 text-sm font-semibold ${
            value === v ? "bg-paper text-teal-deep shadow-[0_1px_2px_rgb(26_32_44/0.08)]" : "text-ink-soft hover:text-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
