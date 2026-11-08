// Buttons, fields and lines shared by the owner panels and the sign-in pages (DESIGN.md "Buttons",
// "Fields"). Every control gets press feedback and the mobile tap settings (spec-2.6 mobile-native).

export const ctl = "press touch-manipulation select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
export const primary = `${ctl} inline-flex min-h-12 items-center justify-center rounded-[var(--r-md)] bg-teal-deep px-5 text-[15px] font-bold text-paper disabled:cursor-not-allowed disabled:opacity-45`;
export const quiet = `${ctl} inline-flex min-h-12 items-center justify-center rounded-[var(--r-md)] bg-paper px-5 text-[15px] font-semibold text-ink ring-1 ring-sand-deep ring-inset disabled:opacity-45`;
export const danger = `${ctl} inline-flex min-h-12 items-center justify-center rounded-[var(--r-md)] bg-coral-ink px-5 text-[15px] font-bold text-paper disabled:opacity-60`;
export const linkBtn = `${ctl} inline-flex min-h-11 items-center rounded-[var(--r-sm)] font-semibold text-teal-deep underline underline-offset-2`;
export const field =
  "min-h-12 w-full min-w-0 rounded-[var(--r-sm)] bg-paper px-3 text-base text-ink ring-1 ring-sand-deep ring-inset placeholder:text-field focus:outline-2 focus:outline-offset-0 focus:outline-teal-deep aria-invalid:ring-2 aria-invalid:ring-coral-ink";
export const labelText = "text-[14px] font-semibold text-ink";
export const hint = "text-[13px] text-ink-soft";
export const errorLine = "note-in text-[14px] font-semibold text-coral-ink";
