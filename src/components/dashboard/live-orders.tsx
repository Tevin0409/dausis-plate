"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { newIds } from "@/lib/board";
import { getBrowserClient } from "@/lib/supabase/client";
import { Switch } from "./switch";

/**
 * Keeps the board current and chimes for new orders (spec-2.4 "When it chimes"). Realtime and a
 * 30 s poll both only refresh the page; the chime comes from the ids the page rendered in New, all
 * of them, not the filtered list. Orders already on the board when it opens are seen, so opening or
 * reloading is silent; an order back in New by Undo is already seen; two at once chime once.
 */
export function LiveOrders({ newOrderIds }: { newOrderIds: string[] }) {
  const router = useRouter();
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const idList = newOrderIds.join(",");
  useEffect(() => {
    const ids = idList ? idList.split(",") : [];
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = newIds(seen.current, ids);
    if (fresh.length === 0) return;
    if (process.env.NEXT_PUBLIC_BOARD_DEBUG) console.debug("[board] chime", fresh, soundRef.current ? "sound on" : "sound off");
    if (soundRef.current) chime();
  }, [idList]);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("orders-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => router.refresh())
      .subscribe();
    // Without Realtime (a dropped socket, or the local stack) this is what brings new orders in.
    const poll = setInterval(() => router.refresh(), 30_000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <Switch
      checked={sound}
      onChange={setSound}
      className="min-h-11 gap-2.5 bg-paper py-1 pr-1.5 pl-4 text-sm font-semibold ring-1 ring-line-deep ring-inset"
    >
      New-order sound
    </Switch>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.32);
    }
  } catch {
    // Browser blocked audio until the first tap; ignore.
  }
}
