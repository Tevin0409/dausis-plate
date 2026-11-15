"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

// spec-2.3 "Build follow-ups" 3: after a stale refusal the page refreshes and the control that was
// refused may be gone. The refusal line moves to one note under the page heading, which stays until
// the person goes to another screen, and focus goes to the heading only if it was lost.

type Note = { line: string; path: string };
const Ctx = createContext<{ note: Note | null; report: (line: string) => void } | null>(null);

export function RefusalNoteProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [pending, startTransition] = useTransition();
  const hadFocus = useRef<Element | null>(null);
  const refreshing = useRef(false);

  // Another screen clears the note (reset while rendering, not in an effect).
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setNote(null);
  }

  const report = useCallback(
    (line: string) => {
      setNote({ line, path: pathname });
      hadFocus.current = document.activeElement;
      refreshing.current = true;
      startTransition(() => router.refresh());
    },
    [pathname, router],
  );

  // The transition ends when the refreshed page is on screen.
  useEffect(() => {
    if (pending || !refreshing.current) return;
    refreshing.current = false;
    const had = hadFocus.current;
    hadFocus.current = null;
    const now = document.activeElement;
    if ((had && !had.isConnected) || !now || now === document.body) {
      const heading = document.querySelector<HTMLElement>("#main h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  }, [pending]);

  const value = useMemo(() => ({ note, report }), [note, report]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hands a stale refusal to the note and refreshes the page. Without the provider, just refreshes. */
export function useReportRefusal() {
  const ctx = useContext(Ctx);
  const router = useRouter();
  return useCallback((line: string) => (ctx ? ctx.report(line) : router.refresh()), [ctx, router]);
}

/** The slot, placed directly under a page's h1. No live region: the alert was already read. No motion. */
export function RefusalNote({ className = "" }: { className?: string }) {
  const ctx = useContext(Ctx);
  const pathname = usePathname();
  if (!ctx?.note || ctx.note.path !== pathname) return null;
  return <p className={`text-[14px] text-ink ${className}`}>{ctx.note.line}</p>;
}
