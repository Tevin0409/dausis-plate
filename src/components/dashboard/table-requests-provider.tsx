"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { nairobiToday } from "@/lib/format";
import { getBrowserClient } from "@/lib/supabase/client";
import { openRequests, REQUEST_POLL_MS, type OpenRequest } from "@/lib/table-requests";

// spec-2.9 "How fast staff see it" and "Other dashboard pages". One poll for the whole dashboard:
// - on the board (a TableRequests is mounted) it fetches the full list, open_table_requests;
// - on any other page only the open count, for the Orders badge.
// Every 10 s, at once on returning to the tab, and on any Realtime change. A reply that comes back
// after a newer one is dropped. Reads use the browser client, not a server action: server actions
// run one at a time per client, so a poll would queue behind (or hold up) a tap's action.
// It also holds the board's one Sound switch (new orders and table requests).

type Requests = {
  /** The board's list; null until the board mounts and gives its first render's data. */
  requests: OpenRequest[] | null;
  /** Open requests today, for the badge; null if it hasn't been read. */
  count: number | null;
  /** When the last poll succeeded (Date.now()), for 2.4's freshness line; null before any. */
  lastOk: number | null;
  refetch: () => void;
  /** The board says it is open, with its server-rendered list. Returns the cleanup. */
  attachBoard: (initial: OpenRequest[] | null) => () => void;
  /** Hides a request at once after Done, until the next fetch agrees (or Undo brings it back). */
  hide: (id: string) => void;
  unhide: (id: string) => void;
  sound: boolean;
  setSound: (on: boolean) => void;
};

const Ctx = createContext<Requests | null>(null);
export const useTableRequests = () => useContext(Ctx);

const startOfToday = () => new Date(`${nairobiToday(new Date())}T00:00:00+03:00`).toISOString();

export function TableRequestsProvider({ initialCount, children }: { initialCount: number | null; children: React.ReactNode }) {
  const [list, setList] = useState<OpenRequest[] | null>(null);
  const [count, setCount] = useState<number | null>(initialCount);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [boards, setBoards] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [sound, setSound] = useState(true);
  const latest = useRef(0);
  const boardRef = useRef(false);
  boardRef.current = boards > 0;

  const fetchNow = useCallback(async () => {
    const asked = ++latest.current;
    const supabase = getBrowserClient();
    try {
      if (boardRef.current) {
        const { data, error } = await supabase.rpc("open_table_requests");
        if (error) throw error;
        const parsed = openRequests.safeParse(data ?? []);
        if (!parsed.success) throw new Error(`open_table_requests had an unexpected shape: ${parsed.error.message}`);
        if (asked !== latest.current) return;
        setList(parsed.data);
        setCount(parsed.data.length);
      } else {
        const { count: n, error } = await supabase
          .from("table_requests")
          .select("id", { count: "exact", head: true })
          .is("cleared_at", null)
          .gte("created_at", startOfToday());
        if (error) throw error;
        if (asked !== latest.current) return;
        setCount(n ?? 0);
      }
      setLastOk(Date.now());
    } catch (e) {
      // Fails quietly here: the freshness line turns amber after 75 s without a good poll.
      console.error("[requests] poll failed:", e instanceof Error ? e.message : e);
    }
  }, []);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("table-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "table_requests" }, () => void fetchNow())
      .subscribe();
    const poll = setInterval(() => void fetchNow(), REQUEST_POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void fetchNow();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onShow);
      void supabase.removeChannel(channel);
    };
  }, [fetchNow]);

  const attachBoard = useCallback(
    (initial: OpenRequest[] | null) => {
      setBoards((n) => n + 1);
      boardRef.current = true;
      if (initial) {
        // The server render is as good as a poll: it counts for freshness and drops older replies.
        latest.current++;
        setList(initial);
        setCount(initial.length);
        setLastOk(Date.now());
      } else void fetchNow();
      return () => {
        setBoards((n) => n - 1);
        setList(null);
      };
    },
    [fetchNow],
  );

  const hide = useCallback((id: string) => setHidden((s) => new Set(s).add(id)), []);
  const unhide = useCallback(
    (id: string) =>
      setHidden((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      }),
    [],
  );

  // A hidden id the server no longer lists has served its purpose.
  useEffect(() => {
    if (!list || hidden.size === 0) return;
    const ids = new Set(list.map((r) => r.id));
    if ([...hidden].some((id) => !ids.has(id))) setHidden((s) => new Set([...s].filter((id) => ids.has(id))));
  }, [list, hidden]);

  const value = useMemo<Requests>(() => {
    const requests = list ? list.filter((r) => !hidden.has(r.id)) : null;
    const shownCount = requests ? requests.length : count === null ? null : Math.max(0, count - hidden.size);
    return { requests, count: shownCount, lastOk, refetch: () => void fetchNow(), attachBoard, hide, unhide, sound, setSound };
  }, [list, hidden, count, lastOk, fetchNow, attachBoard, hide, unhide, sound]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
