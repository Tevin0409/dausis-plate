// "Back to the menu" (spec-2.8 dish page): back in history when the menu is the previous entry,
// otherwise to "/"; either way the dish's own row link gets focus, scrolled into view if needed.
// Module state survives client navigation, which is all this needs.

let menuLeft = false;
let focusKey: string | null = null;

/** The menu view unmounted: the next page was opened from it. */
export const leftMenu = () => {
  menuLeft = true;
};

/** The dish page reads (and clears) whether it was opened from the menu. */
export const takeFromMenu = () => {
  const v = menuLeft;
  menuLeft = false;
  return v;
};

export const returnTo = (key: string) => {
  focusKey = key;
};

/** The menu view, on mount: focus the row the customer came back from. */
export function focusReturnedRow() {
  const key = focusKey;
  focusKey = null;
  if (!key) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(`dish-${key}`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  });
}
