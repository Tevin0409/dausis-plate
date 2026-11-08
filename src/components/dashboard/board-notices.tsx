"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult, BoardResult, OrderRefusal } from "@/app/dashboard/action-result";
import { undoOrderMove } from "@/app/dashboard/actions";
import { TITLES, UNDO_MS, type Status } from "@/lib/board";
import { ActionForm } from "./action-form";

// The board's single bottom strip (spec-0.2-stale-tap.md, spec-2.4 "The bottom strip"). A refused
// tap re-renders the board and the ticket's form remounts in its new column (or leaves the board),
// losing its own result, so refusals and moves are kept here, above the columns. It shows one of two
// kinds, and a newer one replaces the older:
// - Moved: "DP-0107 (Amina) moved to Cooking." with Undo, for 5 s, no pause.
// - Refused: 0.2's sentences with Show, for 10 s, pausing on hover and focus.

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
type BoardAction = (prev: ActionResult, formData: FormData) => Promise<BoardResult>;
/** A move this tablet made; `version` is the order's version after it, which its Undo sends back. */
export type Moved = { orderId: string; code: string; name: string; from: Status; to: Status; version: number };
type Notice =
  | { id: number; kind: "refused"; refusal: OrderRefusal; message: string }
  | { id: number; kind: "moved"; moved: Moved };
type Board = {
  report: (refusal: OrderRefusal, message: string) => void;
  moved: (m: Moved) => void;
  clear: () => void;
  /** The one open Decline or Cancel form on this tablet (an order id), or null. */
  openForm: string | null;
  setOpenForm: (orderId: string | null) => void;
  /** A polite line for screen readers. */
  say: (line: string) => void;
  /**
   * Mark paid's live Undos, by order id: the version it needs and when it ends. Kept here, not in
   * the row, so a row that re-sorts or unmounts (Done's first 8, a refresh) keeps its Undo (RQA24-03).
   */
  paidUndos: ReadonlyMap<string, PaidUndo>;
  startPaidUndo: (orderId: string, version: number) => void;
  endPaidUndo: (orderId: string) => void;
};
export type PaidUndo = { version: number; until: number };

const BoardContext = createContext<Board | null>(null);
export const useBoard = () => useContext(BoardContext);

const REFUSED_FOR_MS = 10_000;
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

const title = (s: string) => TITLES[s as Status] ?? s;

/** The strip text, with the column name (if any) set in bold. */
function describe(n: Notice, name: (n: string) => string): [string, string?, string?] {
  if (n.kind === "moved") {
    const who = n.moved.name ? `${n.moved.code} (${name(n.moved.name)})` : n.moved.code;
    return [`${who} moved to `, title(n.moved.to), "."];
  }
  const { refusal: r, message } = n;
  if (!r.status || !r.code) return [message];
  const who = r.customerName ? `${r.code} (${name(r.customerName)})` : r.code;
  const column = title(r.status);
  if (r.kind === "unpaid") return [`Too late to undo. ${who} stays marked paid.`];
  if (r.status === "cancelled") return [`${who} was cancelled by someone else. It has left the board.`];
  if (r.kind === "undo") return [`Too late to undo. ${who} is in `, column, " now."];
  if (r.kind === "cancel") return [`${who} moved to `, column, ` first, so it wasn’t ${r.from === "new" ? "declined" : "cancelled"}.`];
  if (r.kind === "advance" && r.status !== r.from) return [`${who} was already moved by someone else. It’s in `, column, " now."];
  return [message];
}

export function BoardNotices({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Hover and focus pause a refusal's timer separately, so leaving with the pointer doesn't resume
  // it while a strip button still has keyboard focus (QA RQA2-01). A move's 5 s never pauses.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = notice?.kind === "refused" && (hovered || focused);
  const [onBoard, setOnBoard] = useState(false);
  const [height, setHeight] = useState(0);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [spoken, setSpoken] = useState("");
  const [undoing, startUndo] = useTransition();
  const [paidUndos, setPaidUndos] = useState<ReadonlyMap<string, PaidUndo>>(() => new Map());
  const startPaidUndo = useCallback(
    (orderId: string, version: number) => setPaidUndos((m) => new Map(m).set(orderId, { version, until: Date.now() + UNDO_MS })),
    [],
  );
  const endPaidUndo = useCallback(
    (orderId: string) =>
      setPaidUndos((m) => {
        if (!m.has(orderId)) return m;
        const next = new Map(m);
        next.delete(orderId);
        return next;
      }),
    [],
  );
  // Each Undo goes when its 5 s are up: one timer, for the earliest.
  useEffect(() => {
    if (paidUndos.size === 0) return;
    const first = Math.min(...Array.from(paidUndos.values(), (u) => u.until));
    const t = setTimeout(() => {
      const now = Date.now();
      setPaidUndos((m) => new Map(Array.from(m).filter(([, u]) => u.until > now)));
    }, Math.max(0, first - Date.now()));
    return () => clearTimeout(t);
  }, [paidUndos]);
  const seq = useRef(0);
  const remaining = useRef(REFUSED_FOR_MS);
  const strip = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    seq.current += 1;
    setLeaving(false);
    setHovered(false);
    setFocused(false);
    setSpoken("");
    return seq.current;
  }, []);
  const report = useCallback(
    (refusal: OrderRefusal, message: string) => setNotice({ id: reset(), kind: "refused", refusal, message }),
    [reset],
  );
  const moved = useCallback((m: Moved) => setNotice({ id: reset(), kind: "moved", moved: m }), [reset]);
  const clear = useCallback(() => setLeaving(true), []);
  const say = useCallback((line: string) => setSpoken(line), []);

  // Each new notice gets its full time: 10 s for a refusal, 5 s for a move.
  useEffect(() => {
    remaining.current = notice?.kind === "moved" ? UNDO_MS : REFUSED_FOR_MS;
  }, [notice?.id, notice?.kind]);

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
    const present =
      notice?.kind === "refused" && notice.refusal.status !== "cancelled" && !!document.getElementById(ticketId(notice.refusal.orderId));
    setOnBoard(present);
  }, [notice, children]);

  // The strip's height + 16 px, as --strip-h, so the last ticket's buttons scroll clear of it.
  useEffect(() => {
    const el = strip.current;
    if (!el) return setHeight(0);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [notice?.id]);

  // Show reveals the ticket in the column the refusal says it is in now. If that column is hidden
  // (a phone or tablet showing another view), it switches the view the way the view buttons do.
  // The refreshed board may land after the tap, so it waits (up to 3 s) for the ticket to be laid out
  // in that column, then scrolls to and focuses it (QA RQA24-02).
  const showTicket = () => {
    if (notice?.kind !== "refused") return clear();
    const id = ticketId(notice.refusal.orderId);
    const status = notice.refusal.status;
    const visible = (e: Element | null) => !!e && e.getClientRects().length > 0;
    const column = status ? document.querySelector(`section[data-status="${status}"]`) : null;
    if (column && !visible(column)) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", status!);
      window.history.replaceState(null, "", url);
    }
    const until = Date.now() + 3000;
    const reveal = () => {
      const inColumn = status ? document.querySelector<HTMLElement>(`section[data-status="${status}"] [id="${id}"]`) : null;
      const late = Date.now() > until;
      const target = visible(inColumn) ? inColumn : late ? document.getElementById(id) : null;
      if (!target) return late ? undefined : void requestAnimationFrame(reveal);
      if (!visible(target)) return;
      target.scrollIntoView({ block: "center" });
      target.dataset.shown = "";
      target.addEventListener("blur", () => delete target.dataset.shown, { once: true });
      target.focus({ preventScroll: true });
    };
    reveal();
    clear();
  };

  // Undo moves the order back one step. The server allows it for 10 s, and only if nothing else
  // moved it since; otherwise the refusal replaces this strip.
  const undo = () => {
    if (notice?.kind !== "moved") return;
    const m = notice.moved;
    startUndo(async () => {
      const result = await undoOrderMove(m.orderId, m.to, m.version);
      if (result?.refused) return report(result.refused, result.error);
      if (result) {
        const none = { orderId: m.orderId, kind: "undo", from: m.to, code: null, customerName: null, status: null, paymentStatus: null } as const;
        return report(none, result.error);
      }
      setLeaving(true);
      setSpoken(`${m.code} back in ${title(m.from)}.`);
      router.refresh();
    });
  };

  const [lead, strong, tail] = notice ? describe(notice, shortName) : [""];
  const text = notice ? describe(notice, (n) => n).join("") : "";

  return (
    <BoardContext.Provider value={{ report, moved, clear, openForm, setOpenForm, say, paidUndos, startPaidUndo, endPaidUndo }}>
      <div className="contents" style={{ "--strip-h": notice ? `${height + 16}px` : "0px" } as React.CSSProperties}>
        {children}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {notice && !leaving ? text : spoken}
      </div>
      {notice && (
        <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--tabbar-h,0px)+16px)] z-40 flex justify-center lg:bottom-[calc(16px+env(safe-area-inset-bottom,0px))] lg:left-[calc(96px+28px)]">
          <div
            ref={strip}
            key={notice.id}
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
              {notice.kind === "moved" && (
                <button
                  type="button"
                  onClick={undo}
                  disabled={undoing}
                  className="press min-h-11 min-w-16 shrink-0 touch-manipulation rounded-[var(--r-md)] px-3 text-sm font-bold text-white select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
                >
                  {undoing ? "Undoing…" : "Undo"}
                </button>
              )}
              {onBoard && (
                <button
                  type="button"
                  onClick={showTicket}
                  className="press min-h-11 min-w-11 shrink-0 touch-manipulation rounded-[var(--r-md)] px-3 text-sm font-bold text-white select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-white"
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
 * instead of under the button. Other failures still show under the button. `onDone` runs after a
 * success or a refusal, so the ticket can show its move or close its form; on success it gets the
 * order's version after the change, if the action returns one (for its Undo).
 */
export function BoardActionForm({
  action,
  className,
  onDone,
  children,
}: {
  action: BoardAction;
  className?: string;
  onDone?: (outcome: "ok" | "refused", version?: number | null) => void;
  children: React.ReactNode;
}) {
  const board = useContext(BoardContext);
  const run = useCallback<Action>(
    async (prev, formData) => {
      board?.clear();
      const result = await action(prev, formData);
      if (result && "version" in result) {
        onDone?.("ok", result.version);
        return null;
      }
      if (result?.refused && board) {
        board.report(result.refused, result.error);
        onDone?.("refused");
        return null;
      }
      if (!result) onDone?.("ok");
      return result;
    },
    [action, board, onDone],
  );
  return (
    <ActionForm action={run} className={className}>
      {children}
    </ActionForm>
  );
}
