"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { clearTableRequest, markAllPaid, undoClearTableRequest, unmarkAllPaid } from "@/app/dashboard/actions";
import { BellIcon, ReceiptIcon } from "@/components/icons";
import { formatKes, timeLabel } from "@/lib/format";
import { newIds } from "@/lib/board";
import { requestAge, REQUESTS_SHOWN, REQUESTS_SHOWN_PHONE, type BillOrder, type OpenRequest } from "@/lib/table-requests";
import { useBoard } from "./board-notices";
import { PaidButton } from "./paid-control";
import { useTableRequests } from "./table-requests-provider";

// spec-2.9 "Board: the request area". Between 2.4's header and columns: one strip per open request,
// oldest first, from the shared 10 s poll (TableRequestsProvider). A request the board hasn't seen
// before chimes once (Sound on) and enters from 8 px above; Done sends it back up and offers Undo
// in 2.4's bottom strip. Below 600 px a pill under the view buttons points to a request scrolled away.

/** Dine-in order statuses as the bill list says them. */
const STATUS: Record<BillOrder["status"], string> = {
  new: "New",
  preparing: "Cooking",
  ready: "Ready",
  on_the_way: "On the way",
  completed: "Served",
  cancelled: "Cancelled",
};
const LEAVE_MS = 260;
/** --dur-exit (220 ms) plus a frame, for the pill's fade out. */
const PILL_EXIT_MS = 240;

export function TableRequests({ initial }: { initial: OpenRequest[] | null }) {
  const ctx = useTableRequests();
  const board = useBoard();
  const attach = ctx?.attachBoard;
  useEffect(() => attach?.(initial), [attach]); // eslint-disable-line react-hooks/exhaustive-deps -- the first render's data only

  const list = ctx?.requests ?? initial ?? [];
  const sound = ctx?.sound ?? true;
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // The seen set: seeded from the first data, so opening the board is silent and nothing animates.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [pillFor, setPillFor] = useState<string[]>([]);
  const [viewsH, setViewsH] = useState(60);
  const area = useRef<HTMLDivElement>(null);
  const inView = useRef(true);
  const ids = list.map((r) => r.id).join(",");
  useEffect(() => {
    const now = ids ? ids.split(",") : [];
    if (!seen.current) {
      seen.current = new Set(now);
      return;
    }
    const arrived = newIds(seen.current, now);
    if (arrived.length === 0) return;
    setFresh((s) => new Set([...s, ...arrived]));
    if (soundRef.current) requestChime();
    // Below 600 the area can be scrolled away; above it the area is always in view.
    if (!inView.current && window.matchMedia("(max-width: 599px)").matches) {
      // The pill sits under 2.4's sticky view buttons, so it needs their height.
      setViewsH(document.querySelector<HTMLElement>("[data-board-views]")?.offsetHeight ?? 60);
      setPillFor((p) => [...p, ...arrived]);
    }
  }, [ids]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      inView.current = e.isIntersecting;
      if (e.isIntersecting) setPillFor([]);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- re-observe when the area appears

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 599px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (list.length === 0) setOpen(false);
  }, [list.length]);

  // Ticks the ages once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const done = useCallback(
    async (r: OpenRequest) => {
      board?.clear();
      setLeaving((s) => new Set(s).add(r.id));
      await new Promise((ok) => setTimeout(ok, LEAVE_MS));
      ctx?.hide(r.id);
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
      const result = await clearTableRequest(r.id).catch(() => ({ ok: false as const, error: "Couldn’t save. Try again." }));
      if (!result.ok) {
        ctx?.unhide(r.id);
        board?.notify(result.error);
        return;
      }
      const what = r.kind === "waiter" ? "call" : "bill request";
      board?.notify(`${r.table_label}’s ${what} done.`, {
        undone: `${r.table_label}’s ${what} is back on the board.`,
        run: async () => {
          const u = await undoClearTableRequest(r.id, r.table_label);
          if (!u.ok) {
            ctx?.refetch();
            return u.error;
          }
          seen.current?.add(r.id);
          ctx?.unhide(r.id);
          ctx?.refetch();
          return null;
        },
      });
      ctx?.refetch();
    },
    [board, ctx],
  );

  const limit = phone ? REQUESTS_SHOWN_PHONE : REQUESTS_SHOWN;
  const folded = !open && list.length > limit + 0 ? list.length - limit : 0;
  const shown = folded ? list.slice(0, limit) : list;
  const pill = pillFor.filter((id) => list.some((r) => r.id === id));
  const pillText =
    pill.length === 1
      ? (() => {
          const r = list.find((x) => x.id === pill[0])!;
          return `${r.table_label} ${r.kind === "waiter" ? "called a waiter" : "wants the bill"}`;
        })()
      : `${new Set(list.filter((r) => pill.includes(r.id)).map((r) => r.table_id)).size} tables are asking`;

  // The pill fades out (spec-2.9 Motion): keep its last content on screen for --dur-exit after it goes.
  const pillNow = pill.length > 0 ? { text: pillText, bill: list.find((r) => r.id === pill[0])?.kind === "bill" && pill.length === 1 } : null;
  const [pillGone, setPillGone] = useState<{ text: string; bill: boolean } | null>(null);
  const lastPill = useRef<{ text: string; bill: boolean } | null>(null);
  const pillKey = pillNow ? `${pillNow.bill}|${pillNow.text}` : "";
  useEffect(() => {
    if (pillNow) {
      lastPill.current = pillNow;
      setPillGone(null);
      return;
    }
    if (!lastPill.current) return;
    setPillGone(lastPill.current);
    lastPill.current = null;
    const t = setTimeout(() => setPillGone(null), PILL_EXIT_MS);
    return () => clearTimeout(t);
  }, [pillKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on what the pill shows
  // lastPill covers the one render between the pill going and the effect: no unmount, so the fade runs.
  const pillShown = pillNow ?? pillGone ?? lastPill.current;

  if (list.length === 0) return null;
  return (
    <>
      {pillShown && (
        <button
          type="button"
          data-leaving={pillNow ? undefined : ""}
          aria-hidden={pillNow ? undefined : true}
          tabIndex={pillNow ? undefined : -1}
          onClick={() => {
            area.current?.scrollIntoView({ block: "start" });
            setPillFor([]);
          }}
          style={{ "--views-h": `${viewsH}px` } as React.CSSProperties}
          className="request-pill press fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+var(--views-h)+8px)] z-30 mx-auto flex min-h-11 w-max max-w-[calc(100%-32px)] touch-manipulation items-center gap-2 rounded-full bg-teal-deeper px-4 text-sm font-bold text-white shadow-[var(--shadow-card)] select-none min-[600px]:hidden"
        >
          {pillShown.bill ? <ReceiptIcon size={18} /> : <BellIcon size={18} />}
          <span className="truncate">{pillShown.text}</span>
        </button>
      )}
      <div
        ref={area}
        role="region"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        aria-label="Table requests"
        className="grid scroll-mt-4 items-start gap-2 min-[600px]:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] min-[600px]:gap-3 min-[1280px]:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
      >
        {shown.map((r) => (
          <Strip
            key={r.id}
            r={r}
            now={now}
            enter={fresh.has(r.id)}
            leaving={leaving.has(r.id)}
            onDone={() => void done(r)}
            refetch={() => ctx?.refetch()}
          />
        ))}
        {folded > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="press min-h-11 touch-manipulation rounded-[var(--r-md)] bg-teal-deeper px-4 text-left text-sm font-bold text-white select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
          >
            {folded === 1 ? "1 more request" : `${folded} more requests`}
          </button>
        )}
      </div>
    </>
  );
}

function Strip({
  r,
  now,
  enter,
  leaving,
  onDone,
  refetch,
}: {
  r: OpenRequest;
  now: number;
  enter: boolean;
  leaving: boolean;
  onDone: () => void;
  refetch: () => void;
}) {
  const age = requestAge(r.created_at, now);
  const Icon = r.kind === "waiter" ? BellIcon : ReceiptIcon;
  return (
    <article
      data-leaving={leaving ? "" : undefined}
      aria-label={`${r.table_label} ${r.kind === "waiter" ? "called a waiter" : "wants the bill"}`}
      className={`request-strip ${enter ? "request-in" : ""} flex flex-col gap-2.5 rounded-[var(--r-md)] bg-teal-deep p-2 pl-3.5 text-white`}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blush text-coral-ink">
          <Icon size={17} />
        </span>
        <p className="min-w-0 flex-1 text-[15px] leading-snug [overflow-wrap:anywhere]">
          <strong className="font-bold">{r.table_label}</strong> {r.kind === "waiter" ? "called a waiter" : "wants the bill"}
          <span className="whitespace-nowrap">
            {" "}
            <span aria-hidden="true" className="text-on-teal-soft">·</span>{" "}
            {age.amber ? (
              <span className="inline-flex rounded-full bg-amber-tint px-2 py-0.5 text-[13px] font-bold text-amber-ink">{age.text}</span>
            ) : (
              <span className="text-on-teal-soft">{age.text}</span>
            )}
          </span>
        </p>
        <button
          type="button"
          onClick={onDone}
          disabled={leaving}
          aria-label={`Done: ${r.table_label} ${r.kind === "waiter" ? "waiter call" : "bill request"}`}
          className="press min-h-11 min-w-[72px] shrink-0 touch-manipulation rounded-full bg-teal-deeper px-4 text-sm font-bold text-white ring-1 ring-white/40 ring-inset select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Done
        </button>
      </div>
      {r.kind === "bill" && <BillList r={r} refetch={refetch} />}
    </article>
  );
}

function BillList({ r, refetch }: { r: OpenRequest; refetch: () => void }) {
  const board = useBoard();
  const [pending, start] = useTransition();
  const orders = r.orders ?? [];
  const unpaid = orders.filter((o) => !o.paid);
  const total = r.unpaid_kes ?? unpaid.reduce((n, o) => n + o.total_kes, 0);

  // Which of the two "all paid" buttons was tapped, so only that one says "Marking paid…".
  const [paying, setPaying] = useState<"cash" | "mpesa" | null>(null);
  const payAll = (paidWith: "cash" | "mpesa") =>
    start(async () => {
      setPaying(paidWith);
      board?.clear();
      const res = await markAllPaid(unpaid.map((o) => o.id), paidWith).catch(() => ({ ok: false as const, error: "Couldn’t mark them paid. Nothing has changed. Try again." }));
      setPaying(null);
      refetch();
      if (!res.ok) return board?.notify(res.error);
      if (res.items.length === 0) return;
      const n = res.items.length;
      const how = paidWith === "cash" ? "cash" : "M-Pesa";
      board?.notify(n === 1 ? `1 order marked paid, ${how}.` : `${n} orders marked paid, ${how}.`, {
        undone: n === 1 ? "1 order not paid yet." : `${n} orders not paid yet.`,
        run: async () => {
          const u = await unmarkAllPaid(res.items);
          refetch();
          return u.ok ? null : u.error;
        },
      });
    });

  if (orders.length === 0) {
    return <p className="rounded-[var(--r-sm)] bg-paper p-3 text-[15px] text-ink">Nothing unpaid at {r.table_label} today.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--r-sm)] bg-paper p-3 text-ink">
      <ul className="flex flex-col divide-y divide-sand">
        {orders.map((o) => (
          <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 first:pt-0">
            <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
              <span className="whitespace-nowrap"><span className="tabular-nums">{o.code}</span> ·</span> {o.customer_name}
              {o.asked && (
                <span className="ml-1.5 inline-flex rounded-full bg-teal-tint px-2 py-0.5 align-[1px] text-[12px] font-bold text-teal-deeper">Asked</span>
              )}
            </span>
            <span className="justify-self-end text-[15px] font-bold tabular-nums">{formatKes(o.total_kes)}</span>
            {/* 2.12's two pay buttons are wider than 2.9's one, so they share a full-width line with
                the time and wrap under it on a phone, leaving the name its column (wave 2 merge). */}
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <span className="text-[13px] text-ink-soft">
                {timeLabel(o.created_at)} · {STATUS[o.status]}
                {o.paid && <span className="font-semibold text-teal-deeper"> · Paid</span>}
              </span>
              <span className="ml-auto">
                <PaidButton orderId={o.id} code={o.code} paid={o.paid} onSettled={refetch} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {unpaid.length === 0 ? (
        <p className="text-[15px] font-semibold text-teal-deeper">All paid.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between border-t border-sand pt-2.5">
            <span className="text-[15px] font-semibold">Total unpaid</span>
            <span className="text-[17px] font-bold tabular-nums">{formatKes(total)}</span>
          </div>
          {unpaid.length >= 2 && (
            // RW2B-02: the board's Cash / M-Pesa choice, for the whole bill. Paid partly each way?
            // Use the buttons on each order above.
            <div role="group" aria-label={`Mark all ${unpaid.length} paid, ${formatKes(total)}`} className="flex flex-col gap-1.5">
              <span aria-hidden="true" className="text-[13px] font-semibold text-ink-soft">
                Mark all {unpaid.length} paid
              </span>
              {/* Side by side when both labels fit, stacked on the narrowest phones (320 px). */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
                {(["cash", "mpesa"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => payAll(w)}
                    disabled={pending}
                    aria-busy={paying === w || undefined}
                    aria-label={`All ${unpaid.length} paid ${w === "cash" ? "cash" : "M-Pesa"}, ${formatKes(total)}`}
                    className="press min-h-11 min-w-0 touch-manipulation rounded-full bg-teal-deep px-3 text-sm font-bold whitespace-nowrap text-white select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep disabled:cursor-wait disabled:opacity-70"
                  >
                    {paying === w ? "Marking paid…" : `All paid ${w === "cash" ? "cash" : "M-Pesa"}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">Every unpaid order from {r.table_label} today. Check they’re all this group.</p>
        </>
      )}
    </div>
  );
}

/** One lower tone than the new-order chime (spec-2.9 Build notes): 660 Hz, 0.35 s, same envelope. */
function requestChime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.37);
  } catch {
    // Browser blocked audio until the first tap; the strip still shows.
  }
}
