"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ActionResult, OrderRefusal } from "@/app/dashboard/action-result";
import { ActionForm } from "./action-form";

// A refused tap re-renders the board, and the ticket's form remounts in its new column (or
// leaves the board), losing its own result. So refusals are kept here, above the columns, and
// shown in one strip at the bottom of the screen (spec-0.2-stale-tap.md).

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
type Notice = { id: number; refusal: OrderRefusal; message: string };
type Board = { report: (refusal: OrderRefusal, message: string) => void; clear: () => void };

const BoardContext = createContext<Board | null>(null);
const SHOW_FOR_MS = 10_000;
const ticketId = (orderId: string) => `order-${orderId}`;

const NAME_MAX = 24;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A customer name cut to 24 graphemes for the strip (spec: Long customer names): at the last
 * word break (space or hyphen, as in "Aleksandra Wiśniewska…") if there is one, then "…".
 * The code is never cut; screen readers get the full name.
 */
export function shortName(name: string): string {
  const g = Array.from(graphemes.segment(name), (s) => s.segment);
  if (g.length <= NAME_MAX) return name;
  let head = g.slice(0, NAME_MAX);
  if (!/[\s-]/.test(g[NAME_MAX] ?? "")) {
    const lastBreak = head.findLastIndex((c) => /[\s-]/.test(c));
    if (lastBreak > 0) head = head.slice(0, lastBreak);
  }
  return `${head.join("").replace(/[\s-]+$/, "")}…`;
}

/** The strip text, with the column name (if any) set in bold. */
function describe(
  r: OrderRefusal,
  message: string,
  titles: Record<string, string>,
  name: (n: string) => string,
): [string, string?, string?] {
  if (!r.status || !r.code) return [message];
  const who = r.customerName ? `${r.code} (${name(r.customerName)})` : r.code;
  const column = titles[r.status] ?? r.status;
  if (r.status === "cancelled") return [`${who} was cancelled by someone else. It has left the board.`];
  if (r.kind === "cancel") return [`${who} moved to `, column, " first, so it wasn’t declined."];
  if (r.kind === "advance" && r.status !== r.from) return [`${who} was already moved by someone else. It’s in `, column, " now."];
  return [message];
}

export function BoardNotices({ titles, children }: { titles: Record<string, string>; children: React.ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Hover and focus pause the timer separately, so leaving with the pointer doesn't resume it
  // while a strip button still has keyboard focus (QA RQA2-01).
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const [onBoard, setOnBoard] = useState(false);
  const [height, setHeight] = useState(0);
  const seq = useRef(0);
  const remaining = useRef(SHOW_FOR_MS);
  const strip = useRef<HTMLDivElement>(null);

  const report = useCallback((refusal: OrderRefusal, message: string) => {
    seq.current += 1;
    setNotice({ id: seq.current, refusal, message });
    setLeaving(false);
    setHovered(false);
    setFocused(false);
  }, []);
  const clear = useCallback(() => setLeaving(true), []);

  // Each new refusal gets the full 10 s.
  useEffect(() => {
    remaining.current = SHOW_FOR_MS;
  }, [notice?.id]);

  // Counts down only while nobody is pointing at or focused in the strip.
  useEffect(() => {
    if (!notice || leaving || paused) return;
    const started = Date.now();
    const timer = setTimeout(clear, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [notice, leaving, paused, clear]);

  // Removes the strip once its fade-out has run; the timeout covers a missed transitionend.
  const finishLeaving = useCallback(() => {
    setNotice(null);
    setLeaving(false);
    setHovered(false);
    setFocused(false);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finishLeaving, 400);
    return () => clearTimeout(timer);
  }, [leaving, finishLeaving]);

  // Show is offered only while the ticket is on the board; the refresh may land after the result.
  useEffect(() => {
    const present = !!notice && notice.refusal.status !== "cancelled" && !!document.getElementById(ticketId(notice.refusal.orderId));
    setOnBoard(present);
  }, [notice, children]);

  // The board grows by the strip's height + 16 px, so the last ticket's buttons scroll clear of it.
  useEffect(() => {
    const el = strip.current;
    if (!el) return setHeight(0);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [notice?.id]);

  const show = () => {
    const el = notice && document.getElementById(ticketId(notice.refusal.orderId));
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.dataset.shown = "";
      el.addEventListener("blur", () => delete el.dataset.shown, { once: true });
      el.focus({ preventScroll: true });
    }
    clear();
  };

  const [lead, strong, tail] = notice ? describe(notice.refusal, notice.message, titles, shortName) : [""];
  const text = notice ? describe(notice.refusal, notice.message, titles, (n) => n).join("") : "";

  return (
    <BoardContext.Provider value={{ report, clear }}>
      <div style={notice ? { paddingBottom: height + 16 } : undefined}>{children}</div>
      <div role="status" aria-live="polite" className="sr-only">
        {notice && !leaving ? text : ""}
      </div>
      {notice && (
        <div className="pointer-events-none fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom,0px))] z-40 flex justify-center lg:left-[236px]">
          <div
            ref={strip}
            data-leaving={leaving ? "" : undefined}
            onTransitionEnd={(e) => {
              if (leaving && e.target === e.currentTarget && e.propertyName === "opacity") finishLeaving();
            }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
            }}
            className="board-notice pointer-events-auto flex w-full flex-col gap-1 rounded-[var(--r-md)] bg-ink py-1 pr-1 pl-4 text-white shadow-[var(--shadow-card)] md:max-w-[560px] md:flex-row md:items-center"
          >
            {/* The live region above reads the uncut sentence; this shortened copy is for the eye.
                Below 768 the text takes the full width and the buttons sit on a row under it. */}
            <p aria-hidden="true" className="min-w-0 flex-1 pt-2 pr-3 text-sm leading-snug font-semibold md:py-2 md:pr-0">
              {lead}
              {strong && <strong className="font-bold">{strong}</strong>}
              {tail}
            </p>
            <div className="flex shrink-0 justify-end gap-1">
              {onBoard && (
                <button
                  type="button"
                  onClick={show}
                  className="press min-h-11 min-w-11 shrink-0 touch-manipulation rounded-[var(--r-md)] px-3 text-sm font-bold text-white select-none focus-visible:outline-2 focus-visible:outline-white"
                >
                  Show
                </button>
              )}
              <button
                type="button"
                aria-label="Close message"
                onClick={clear}
                className="press flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-[var(--r-md)] text-white select-none focus-visible:outline-2 focus-visible:outline-white"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </BoardContext.Provider>
  );
}

/**
 * ActionForm for a ticket's buttons. Any tap clears the strip; a refusal goes to the strip
 * instead of under the button. Other failures still show under the button.
 */
export function BoardActionForm({ action, className, children }: { action: Action; className?: string; children: React.ReactNode }) {
  const board = useContext(BoardContext);
  const run = useCallback<Action>(
    async (prev, formData) => {
      board?.clear();
      const result = await action(prev, formData);
      if (result?.refused && board) {
        board.report(result.refused, result.error);
        return null;
      }
      return result;
    },
    [action, board],
  );
  return (
    <ActionForm action={run} className={className}>
      {children}
    </ActionForm>
  );
}
