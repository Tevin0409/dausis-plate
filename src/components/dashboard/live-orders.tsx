"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/** Listens for order changes over Supabase Realtime, refreshes the board, and chimes on new orders. */
export function LiveOrders() {
  const router = useRouter();
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("orders-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        if (payload.eventType === "INSERT" && soundRef.current) chime();
        router.refresh();
      })
      .subscribe();
    // Fallback in case the socket drops on a flaky connection.
    const poll = setInterval(() => router.refresh(), 30000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <button
      type="button"
      aria-pressed={sound}
      onClick={() => setSound((s) => !s)}
      className="flex min-h-10 items-center gap-2 rounded-full border border-line-deep bg-white px-3.5 text-sm font-medium"
    >
      {sound ? "Sound on" : "Sound off"}
    </button>
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
