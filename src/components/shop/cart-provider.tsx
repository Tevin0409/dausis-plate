"use client";
import { usePathname } from "next/navigation";
import { checkCode, forgetTable, recheckCart } from "@/app/(shop)/cart-actions";
import {
  applyCheck,
  checkPayload,
  inOrder as entryInOrder,
  isCounted,
  lineCap,
  type LineCheck,
  MAX_PER_LINE,
} from "@/lib/cart-check";
import { type CartExtra, type ComboPart, cartLineKey, comboLineKey, readStoredLine } from "@/lib/cart-lines";
import { CODE_UNREACHABLE, type CodeCheck, codeError } from "@/lib/discount-words";
import type { OrderMode } from "@/lib/promos";
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
  /**
   * 2.11 B: a combo line. `dishId` holds the combo's id too, so older code that reads it stays
   * safe; `unitPriceKes` is the combo price plus its dishes' choices and extras.
   */
  kind?: "combo";
  comboId?: string;
  parts?: ComboPart[];
  /** A combo line's second plate photo. */
  photo2?: string | null;
};

export type DineInTable = { token: string; label: string; at?: string };

type NewLine = Omit<CartLine, "key" | "quantity" | "extras"> & {
  quantity?: number;
  extras?: CartExtra[];
  /** Plates left for this entry, from the menu (null: no limit). Caps the add. */
  platesLeft?: number | null;
  /** A combo's dishes' plates left, by entry. */
  partsLeft?: Record<string, number | null>;
};

/** The code in the order (2.11 C) and what its last check said. */
export type CodeState = {
  code: string;
  check: CodeCheck;
  /** The last check couldn't reach the server: the previous answer stands, with a note. */
  unreachable: boolean;
};

/** What checkout knows that the cart doesn't: the order type and the phone. */
export type CodeContext = { mode: OrderMode | null; phone: string | null };

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
  /** 2.11 C: food in the total, the part a code covers (no combos), and the code's saving. */
  foodKes: number;
  coveredKes: number;
  discountKes: number;
  code: CodeState | null;
  /** Checks a code and keeps it if it works. Returns the message to show when it doesn't. */
  applyCode: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeCode: () => void;
  /** True for a moment after a code is applied here, so its chip and Discount line enter once (spec Motion: "Code applied"). */
  codeFresh: boolean;
  /** Checkout passes the order type and phone, so the check covers them (null: the cart). */
  setCodeContext: (ctx: CodeContext | null) => void;
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
// v2 (2.11): { lines, code }. A v1 cart (an array of lines) is read once and moved over.
const STORAGE_KEY = "dp-cart-v2";
const STORAGE_V1 = "dp-cart-v1";
const CODE_DEBOUNCE_MS = 300;
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
  const [code, setCodeState] = useState<CodeState | null>(null);
  const [codeCtx, setCodeCtx] = useState<CodeContext | null>(null);

  // Refs hold the latest state so callbacks chained in one tap see each other's writes.
  const linesRef = useRef(lines);
  const checksRef = useRef(checks);
  const leftRef = useRef(left);
  const removedRef = useRef<Held | null>(null);
  const codeRef = useRef<CodeState | null>(null);
  const codeSeq = useRef(0);
  /** What the code was last checked against, so an Apply isn't checked twice. */
  const codeCheckedFor = useRef<string | null>(null);
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
  const setCode = useCallback((next: CodeState | null) => {
    codeRef.current = next;
    setCodeState(next);
  }, []);
  const setLeft = useCallback((next: Record<string, number | null>) => {
    leftRef.current = next;
    setLeftState(next);
  }, []);

  useEffect(() => {
    const readLines = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => readStoredLine<CartLine>(x)).filter((l): l is CartLine => l !== null) : [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lines?: unknown; code?: unknown } | null;
        setLines(readLines(parsed?.lines));
        // Only the code text is kept: its check runs again on load.
        const saved = parsed?.code;
        if (typeof saved === "string" && /^[A-Z0-9]{3,20}$/.test(saved))
          setCode({ code: saved, check: { ok: false, code: saved, discountKes: 0, reason: null, label: null, startsOn: null, minOrderKes: null, modes: null }, unreachable: false });
      } else {
        const old = localStorage.getItem(STORAGE_V1);
        if (old) {
          setLines(readLines(JSON.parse(old)));
          localStorage.removeItem(STORAGE_V1);
        }
      }
    } catch {
      // Storage unavailable (private mode): the cart just lives in memory.
    }
    setLoaded(true);
  }, [setLines, setCode]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, code: code?.code ?? null }));
    } catch {
      // ignore
    }
  }, [lines, code?.code, loaded]);

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
    ({ platesLeft, partsLeft, ...line }) => {
      const extras = line.extras ?? [];
      const combo = line.kind === "combo" && line.comboId && line.parts ? { id: line.comboId, parts: line.parts } : null;
      const key = combo ? comboLineKey(combo.id, combo.parts) : cartLineKey({ ...line, extras });
      const want = line.quantity ?? 1;
      if (line.menuEntryId && platesLeft !== undefined) setLeft({ ...leftRef.current, [line.menuEntryId]: platesLeft });
      if (partsLeft) setLeft({ ...leftRef.current, ...partsLeft });
      const prev = linesRef.current;
      const found = prev.find((l) => l.key === key);
      let room = MAX_PER_LINE;
      if (found) room = lineCap(prev, checksRef.current, leftRef.current, key) - found.quantity;
      else {
        // A new line: the plates left for each entry it uses, less what the order already holds.
        const uses = combo ? combo.parts.map((p) => ({ entry: p.menuEntryId, per: p.per })) : [{ entry: line.menuEntryId, per: 1 }];
        for (const u of uses) {
          const left = u.entry ? leftRef.current[u.entry] : null;
          if (u.entry && left != null) room = Math.min(room, Math.floor((left - entryInOrder(prev, checksRef.current, u.entry)) / u.per));
        }
      }
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
    setCode(null);
  }, [setLines, setChecks, setCode]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const counted = useMemo(() => lines.filter((l) => isCounted(checks[l.key])), [lines, checks]);
  const foodKes = counted.reduce((n, l) => n + l.quantity * l.unitPriceKes, 0);
  const coveredKes = counted.filter((l) => l.kind !== "combo").reduce((n, l) => n + l.quantity * l.unitPriceKes, 0);
  const discountKes = code?.check.ok ? Math.min(code.check.discountKes, coveredKes) : 0;
  const mode = codeCtx?.mode ?? null;
  const phone = codeCtx?.phone ?? null;

  const runCodeCheck = useCallback(
    async (text: string, food: number, covered: number) => {
      const id = ++codeSeq.current;
      const check = await checkCode({ code: text, foodKes: food, coveredKes: covered, mode, phone }).catch(() => null);
      if (id !== codeSeq.current) return { stale: true as const };
      return { stale: false as const, check };
    },
    [mode, phone],
  );

  // A code in the order is checked again (300 ms after the last change) whenever the food, the
  // order type, the phone or the kitchen changes. It stays when it stops working: the chip says why.
  const forKey = code ? [code.code, foodKes, coveredKes, mode ?? "-", phone ?? "-", status.state].join("|") : null;
  useEffect(() => {
    if (!loaded || !code || forKey === null || codeCheckedFor.current === forKey) return;
    const text = code.code;
    const t = setTimeout(() => {
      void runCodeCheck(text, foodKes, coveredKes).then((r) => {
        const cur = codeRef.current;
        if (r.stale || !cur || cur.code !== text) return;
        codeCheckedFor.current = forKey;
        setCode(r.check ? { code: text, check: r.check, unreachable: false } : { ...cur, unreachable: true });
      });
    }, CODE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [loaded, code, forKey, foodKes, coveredKes, runCodeCheck, setCode]);

  const [codeFresh, setCodeFresh] = useState(false);
  const freshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(freshTimer.current), []);

  const applyCode = useCallback<CartContext["applyCode"]>(
    async (raw) => {
      const text = raw.replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(text)) return { ok: false, error: "We don’t know that code. Check the spelling." };
      const r = await runCodeCheck(text, foodKes, coveredKes);
      if (r.stale) return { ok: false, error: CODE_UNREACHABLE };
      if (!r.check) return { ok: false, error: CODE_UNREACHABLE };
      if (!r.check.ok) return { ok: false, error: codeError(r.check, foodKes) };
      codeCheckedFor.current = [r.check.code, foodKes, coveredKes, mode ?? "-", phone ?? "-", status.state].join("|");
      setCode({ code: r.check.code, check: r.check, unreachable: false });
      setCodeFresh(true);
      clearTimeout(freshTimer.current);
      // Long enough for the entry to play; a later mount (checkout, a reload) doesn't animate.
      freshTimer.current = setTimeout(() => setCodeFresh(false), 1000);
      return { ok: true };
    },
    [runCodeCheck, foodKes, coveredKes, mode, phone, status.state, setCode],
  );

  const removeCode = useCallback(() => {
    clearTimeout(freshTimer.current);
    setCodeFresh(false);
    codeSeq.current++;
    codeCheckedFor.current = null;
    setCode(null);
  }, [setCode]);

  const value = useMemo<CartContext>(() => {
    return {
      lines,
      checks,
      table,
      count: counted.reduce((n, l) => n + l.quantity, 0),
      subtotalKes: foodKes,
      foodKes,
      coveredKes,
      discountKes,
      code,
      applyCode,
      removeCode,
      codeFresh,
      setCodeContext: setCodeCtx,
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
  }, [lines, checks, counted, foodKes, coveredKes, discountKes, code, applyCode, removeCode, codeFresh, left, table, add, setQuantity, remove, removed, undoRemove, lastAdded, recheck, announcement, announce, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
