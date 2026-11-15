// Settings' controls, from DESIGN.md's component tokens: pill buttons 48 px, fields 48 px on --r-sm.
const TAP = "press touch-manipulation select-none [-webkit-tap-highlight-color:transparent] disabled:cursor-wait disabled:opacity-60";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";

export const btnPrimary = `${TAP} ${FOCUS} inline-flex min-h-12 items-center justify-center rounded-full bg-teal-deep px-5 font-semibold text-paper hover:bg-teal-deeper`;
export const btnQuiet = `${TAP} ${FOCUS} inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-5 font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--color-sand-deep)] hover:bg-cream`;
export const btnDanger = `${TAP} ${FOCUS} inline-flex min-h-12 items-center justify-center rounded-full bg-coral-ink px-5 font-semibold text-paper`;
/** A text-style button for secondary actions (Copy hours, Undo, Remove). 44 px tall target. */
export const btnLink = `${TAP} ${FOCUS} inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-teal-deep underline-offset-4 hover:underline`;

export const field =
  "min-h-12 w-full min-w-0 rounded-[var(--r-sm)] border-[1.5px] border-field bg-paper px-3 text-base text-ink focus:border-teal-deep focus:outline-none focus:ring-3 focus:ring-teal/25 aria-invalid:border-coral-ink";

export const tile = "rounded-[var(--r-lg)] bg-paper p-5 shadow-[var(--shadow-card)]";
export const tileHeading = "font-display text-2xl leading-tight";
export const hint = "text-[13px] text-ink-soft";
/** Errors: 14/600 coral ink, naming the problem and the fix (DESIGN.md "Fields"). */
export const errorText = "note-in text-sm font-semibold text-coral-ink";
