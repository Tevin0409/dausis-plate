"use client";
import { usePathname } from "next/navigation";
import { forgetTable, recheckCart } from "@/app/(shop)/cart-actions";
import {
  applyCheck,
  checkPayload,
  inOrder as entryInOrder,
  isCounted,
  lineCap,
  type LineCheck,
  MAX_PER_LINE,
} from "@/lib/cart-check";
import { type CartExtra, cartLineKey, readStoredLine } from "@/lib/cart-lines";
import { tableExpired } from "@/lib/table-cookie";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useKitchen } from "./kitchen-provider";

export type CartLine = {
  key: string;
  dishId: string;
  menuEntryId: string | null;
  optionId: string | null;
  name: string;
  optionLabel: string | null;
  /** Ticked extras, in the dish's order (spec-2.6). Carts saved before 2.6 load with []. */
  extras: CartExtra[];
  /** Display only, extras included. The database reprices every order. */
  unitPriceKes: number;
  quantity: number;
  note: string;
  rotating: boolean;
  /** The dish's thumbnail for the order's plates; carts saved before 2.8 have none. */
  photo?: string | null;
};

export type DineInTable = { token: string; label: string; at?: string };

type NewLine = Omit<CartLine, "key" | "quantity" | "extras"> & {
  quantity?: number;
  extras?: CartExtra[];
  /** Plates left for this entry, from the menu (null: no limit). Caps the add. */
  platesLeft?: number | null;
};

/** The last line removed, for its 6 s Undo. */
export type Removed = { key: string; name: string };

/** What a recheck found. `changed`: a line left the total or was lowered. Null: it could not run. */
export type RecheckResult = { changed: boolean } | null;

type CartContext = {
  lines: CartLine[];
  /** The last check's word on each line, by key. A line with none counts. */
  checks: Record<string, LineCheck>;
  /** Plates in the total (lines still on the menu). */
  count: number;
  subtotalKes: number;
  table: DineInTable | null;
  /** Adds and returns how many went in (fewer when the plates left run out). */
  add: (line: NewLine) => number;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  removed: Removed | null;
  undoRemove: () => void;
  /** The most a line can hold right now. */
  capFor: (key: string) => number;
  /** Plates of a menu entry already counted in the order. */
  inOrder: (menuEntryId: string) => number;
  /** Plates left for a menu entry as last seen (undefined: not seen yet; null: no limit). */
  leftFor: (menuEntryId: string) => number | null | undefined;
  /** The key of the line most recently created by an add, so only it fades in. */
  lastAdded: string | null;
  recheck: () => Promise<RecheckResult>;
  /** The polite live region's text; `id` changes on every announcement. */
  announcement: { text: string; id: number } | null;
  announce: (text: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartContext | null>(null);
const STORAGE_KEY = "dp-cart-v1";
const UNDO_MS = 6000;

type Held = Removed & { line: CartLine; index: number; check?: LineCheck };

export function CartProvider({ children, table: cookieTable }: { children: React.ReactNode; table: DineInTable | null }) {
  const { status } = useKitchen();
  const [lines, setLinesState] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [checks, setChecksState] = useState<Record<string, LineCheck>>({});
  const [left, setLeftState] = useState<Record<string, number | null>>({});
  const [removed, setRemoved] = useState<Held | null>(null);
  const [announcement, setAnnouncement] = useState<CartContext["announcement"]>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Refs hold the latest state so callbacks chained in one tap see each other's writes.
  const linesRef = useRef(lines);
  const checksRef = useRef(checks);
  const leftRef = useRef(left);
  const removedRef = useRef<Held | null>(null);
  const seq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLines = useCallback((next: CartLine[]) => {
    linesRef.current = next;
    setLinesState(next);
  }, []);
  const setChecks = useCallback((next: Record<string, LineCheck>) => {
    checksRef.current = next;
    setChecksState(next);
  }, []);
  const setLeft = useCallback((next: Record<string, number | null>) => {
    leftRef.current = next;
    setLeftState(next);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setLines(parsed.map((v) => readStoredLine<CartLine>(v)).filter((l): l is CartLine => l !== null));
      }
    } catch {
      // Storage unavailable (private mode): the cart just lives in memory.
    }
    setLoaded(true);
  }, [setLines]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // ignore
    }
  }, [lines, loaded]);

  // The table goes at closing; the items stay (DESIGN.md "Saved cart, closed kitchen").
  const expired = cookieTable !== null && tableExpired(cookieTable.at, status);
  const table = expired ? null : cookieTable;
  const forgot = useRef(false);
  useEffect(() => {
    if (!expired || forgot.current) return;
    forgot.current = true;
    forgetTable().catch(() => {
      forgot.current = false;
    });
  }, [expired]);

  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, id: (a?.id ?? 0) + 1 })), []);
  // The live region only holds an announcement while it is news: it empties after 7 s (time to be
  // read out) and on any page change, so it isn't left in the reading order of later pages
  // (RQA28-05). Emptying a live region isn't announced.
  const pathname = usePathname();
  useEffect(() => setAnnouncement(null), [pathname]);
  useEffect(() => {
    if (!announcement) return;
    const id = announcement.id;
    const t = setTimeout(() => setAnnouncement((a) => (a?.id === id ? null : a)), 7000);
    return () => clearTimeout(t);
  }, [announcement]);

  const recheck = useCallback(async (): Promise<RecheckResult> => {
    const sent = linesRef.current;
    if (sent.length === 0) return { changed: false };
    const id = ++seq.current;
    const results = await recheckCart(checkPayload(sent)).catch(() => null);
    if (results === null) return null;
    // A newer check is on its way: it decides.
    if (id !== seq.current) return { changed: false };
    const applied = applyCheck(linesRef.current, checksRef.current, results);
    setLines(applied.lines);
    setChecks(applied.checks);
    setLeft({ ...leftRef.current, ...applied.entryLeft });
    if (applied.announce.length > 0) announce(applied.announce.join(" "));
    return { changed: applied.changed };
  }, [announce, setLines, setChecks, setLeft]);

  // On load and whenever the kitchen status is read again (focus, tab return, opening and
  // closing times): the menu or the plates may have changed since the dish was added.
  useEffect(() => {
    if (loaded) void recheck();
  }, [loaded, status, recheck]);

  const add = useCallback<CartContext["add"]>(
    ({ platesLeft, ...line }) => {
      const extras = line.extras ?? [];
      const key = cartLineKey({ ...line, extras });
      const want = line.quantity ?? 1;
      if (line.menuEntryId && platesLeft !== undefined) setLeft({ ...leftRef.current, [line.menuEntryId]: platesLeft });
      const prev = linesRef.current;
      const found = prev.find((l) => l.key === key);
      let room = MAX_PER_LINE;
      if (found) room = lineCap(prev, checksRef.current, leftRef.current, key) - found.quantity;
      else if (line.menuEntryId && leftRef.current[line.menuEntryId] != null)
        room = Math.min(MAX_PER_LINE, (leftRef.current[line.menuEntryId] ?? 0) - entryInOrder(prev, checksRef.current, line.menuEntryId));
      const n = Math.max(0, Math.min(want, room));
      if (n === 0) return 0;
      if (!found) setLastAdded(key);
      setLines(
        found
          ? prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + n } : l))
          : [...prev, { ...line, extras, key, quantity: n }],
      );
      return n;
    },
    [setLines, setLeft],
  );

  const remove = useCallback(
    (key: string) => {
      const prev = linesRef.current;
      const index = prev.findIndex((l) => l.key === key);
      const line = prev[index];
      if (!line) return;
      setLines(prev.filter((l) => l.key !== key));
      const held: Held = { key, name: line.name, line, index, check: checksRef.current[key] };
      removedRef.current = held;
      setRemoved(held);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => {
        removedRef.current = null;
        setRemoved(null);
      }, UNDO_MS);
    },
    [setLines],
  );

  const undoRemove = useCallback(() => {
    const r = removedRef.current;
    if (!r) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    removedRef.current = null;
    setRemoved(null);
    const prev = linesRef.current.filter((l) => l.key !== r.key);
    setLines([...prev.slice(0, r.index), r.line, ...prev.slice(r.index)]);
    if (r.check) setChecks({ ...checksRef.current, [r.key]: r.check });
  }, [setLines, setChecks]);

  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      if (quantity <= 0) return remove(key);
      const q = Math.min(quantity, lineCap(linesRef.current, checksRef.current, leftRef.current, key));
      setLines(linesRef.current.map((l) => (l.key === key ? { ...l, quantity: q } : l)));
      // The "changed this to n" note stays until the customer changes that line.
      const c = checksRef.current[key];
      if (c?.lowered) setChecks({ ...checksRef.current, [key]: { ...c, lowered: null } });
    },
    [remove, setLines, setChecks],
  );

  const clear = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    removedRef.current = null;
    setRemoved(null);
    setLines([]);
    setChecks({});
  }, [setLines, setChecks]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const value = useMemo<CartContext>(() => {
    const counted = lines.filter((l) => isCounted(checks[l.key]));
    return {
      lines,
      checks,
      table,
      count: counted.reduce((n, l) => n + l.quantity, 0),
      subtotalKes: counted.reduce((n, l) => n + l.quantity * l.unitPriceKes, 0),
      add,
      setQuantity,
      remove,
      removed: removed ? { key: removed.key, name: removed.name } : null,
      undoRemove,
      capFor: (key) => lineCap(lines, checks, left, key),
      inOrder: (entry) => entryInOrder(lines, checks, entry),
      leftFor: (entry) => left[entry],
      lastAdded,
      recheck,
      announcement,
      announce,
      clear,
    };
  }, [lines, checks, left, table, add, setQuantity, remove, removed, undoRemove, lastAdded, recheck, announcement, announce, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
