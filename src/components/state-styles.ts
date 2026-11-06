// Button styles for the error and not-found states. A plain module (not "use client")
// so server components get real strings, not client references.
const tap = "touch-manipulation select-none";
export const shopPrimary = `${tap} flex min-h-14 items-center justify-center rounded-[18px] bg-teal-deep px-6 font-semibold text-white disabled:opacity-60`;
export const shopSecondary = `${tap} flex min-h-14 items-center justify-center rounded-[18px] border-[1.5px] border-teal-deep bg-white px-6 font-semibold text-teal-deep`;
export const dashPrimary = `${tap} inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-deep px-5 text-[15px] font-bold text-white disabled:opacity-60`;
