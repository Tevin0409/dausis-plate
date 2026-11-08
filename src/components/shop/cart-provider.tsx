"use client";
import { type CartExtra, cartLineKey, readStoredLine } from "@/lib/cart-lines";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
};

export type DineInTable = { token: string; label: string };

type CartContext = {
  lines: CartLine[];
  count: number;
  subtotalKes: number;
  table: DineInTable | null;
  add: (line: Omit<CartLine, "key" | "quantity" | "extras"> & { quantity?: number; extras?: CartExtra[] }) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartContext | null>(null);
const STORAGE_KEY = "dp-cart-v1";


export function CartProvider({ children, table }: { children: React.ReactNode; table: DineInTable | null }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) setLines(parsed.map((v) => readStoredLine<CartLine>(v)).filter((l): l is CartLine => l !== null));
    } catch {
      // Storage unavailable (private mode): the cart just lives in memory.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // ignore
    }
  }, [lines]);

  const add = useCallback<CartContext["add"]>((line) => {
    const extras = line.extras ?? [];
    const key = cartLineKey({ ...line, extras });
    const qty = line.quantity ?? 1;
    setLines((prev) => {
      const found = prev.find((l) => l.key === key);
      if (found) return prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, l.quantity + qty) } : l));
      return [...prev, { ...line, extras, key, quantity: qty }];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, quantity) } : l)),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContext>(
    () => ({
      lines,
      table,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalKes: lines.reduce((n, l) => n + l.quantity * l.unitPriceKes, 0),
      add,
      setQuantity,
      clear,
    }),
    [lines, table, add, setQuantity, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
