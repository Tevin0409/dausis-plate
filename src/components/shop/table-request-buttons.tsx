"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askTableHelp } from "@/app/(shop)/table-actions";
import { BellIcon, ReceiptIcon } from "@/components/icons";
import { buttonState, type CustomerRequest, type RequestKind } from "@/lib/table-requests";

/**
 * Call waiter and Request bill on a dine-in order's page (spec-2.9 "Customer: order status page").
 * The state comes from the table's latest request of each kind (get_order_status `requests`), so
 * every phone at the table sees the same thing; the page refreshes every 10 s while one is open.
 * A tap shows Sent at once from the action's answer, until the refreshed page catches up.
 */
export function TableRequestButtons({
  token,
  tableLabel,
  requests,
}: {
  token: string;
  tableLabel: string;
  requests: { waiter: CustomerRequest; bill: CustomerRequest };
}) {
  const [spoken, setSpoken] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Ask at your table" className="mx-5 mt-5">
      <div className="flex gap-2.5 max-[339px]:flex-col">
        <RequestButton kind="waiter" token={token} tableLabel={tableLabel} request={requests.waiter} onSpoken={setSpoken} onError={setError} />
        <RequestButton kind="bill" token={token} tableLabel={tableLabel} request={requests.bill} onSpoken={setSpoken} onError={setError} />
      </div>
      {error && <p role="alert" className="note-in mt-2 text-[14px] font-semibold text-coral-ink">{error}</p>}
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </section>
  );
}

type Local = { askedAt: string; mine: boolean };

function RequestButton({
  kind,
  token,
  tableLabel,
  request,
  onSpoken,
  onError,
}: {
  kind: RequestKind;
  token: string;
  tableLabel: string;
  request: CustomerRequest;
  onSpoken: (line: string) => void;
  onError: (line: string | null) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState<Local | null>(null);

  // The tap's own answer, until the page has a request at least as new (or an answer to it).
  const caughtUp = !!local && !!request && Date.parse(request.asked_at) >= Date.parse(local.askedAt);
  const shown: CustomerRequest = local && !caughtUp ? { asked_at: local.askedAt, answered_at: null, by_this_order: local.mine } : request;
  const state = buttonState(kind, shown);
  const ready = kind === "waiter" ? `We’ll come to ${tableLabel}` : "Brought to your table";
  const line = state.line || ready;

  // Says the change once: "Waiter called." / "Bill asked for." / "Answered.".
  const was = useRef<"open" | "answered" | "none" | null>(null);
  const now = state.open ? "open" : shown?.answered_at ? "answered" : "none";
  useEffect(() => {
    if (was.current !== null && was.current !== now) {
      if (now === "open") onSpoken(kind === "waiter" ? "Waiter called." : "Bill asked for.");
      if (now === "answered") onSpoken("Answered.");
    }
    was.current = now;
  }, [now, kind, onSpoken]);

  const tap = () => {
    // Already asked and not answered: nothing new is sent, and the line still says when.
    if (state.open || pending) return;
    onError(null);
    start(async () => {
      try {
        const r = await askTableHelp(token, kind);
        if (!r.ok) {
          onError(r.line);
          if (r.refresh) router.refresh();
          return;
        }
        setLocal({ askedAt: r.askedAt, mine: r.created });
        router.refresh();
      } catch {
        onError("Couldn’t send. Try again, or wave to a waiter.");
      }
    });
  };

  const Icon = kind === "waiter" ? BellIcon : ReceiptIcon;
  return (
    <button
      type="button"
      onClick={tap}
      aria-pressed={state.open}
      aria-busy={pending || undefined}
      className={`press flex min-h-14 min-w-0 flex-1 touch-manipulation items-start gap-2.5 rounded-2xl px-3.5 py-3 text-left select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${
        state.open ? "bg-teal-tint text-teal-deeper ring-[1.5px] ring-teal-deep/30 ring-inset" : "bg-white text-teal-deep ring-[1.5px] ring-teal-deep ring-inset"
      } ${pending ? "cursor-wait" : ""}`}
    >
      <Icon size={20} className="mt-px shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] leading-tight font-bold whitespace-nowrap">{state.label}</span>
        <span className="text-[13px] leading-snug font-medium text-ink-soft [overflow-wrap:anywhere]">{line}</span>
      </span>
    </button>
  );
}
