"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { placeOrder } from "@/app/(shop)/checkout/actions";
import { formatKes, timeLabel } from "@/lib/format";
import { useCart } from "./cart-provider";
import { BottomBar } from "./ui";

type Zone = { id: string; name: string; fee_kes: number };
type Mode = "dine_in" | "pickup" | "delivery";
type Pay = "on_handover" | "at_counter";

/** Launch takes no online payment (spec-2.1-payments.md). Dine-in may also pay at the counter. */
const defaultPay = (mode: Mode): Pay => (mode === "dine_in" ? "at_counter" : "on_handover");
const PAY_LINE = {
  at_counter: "Pay cash or M-Pesa to our till when you’re done.",
  dine_in: "Pay cash or M-Pesa to our till when your food arrives.",
  pickup: "Pay cash or M-Pesa to our till when you collect.",
  delivery: "Pay cash or M-Pesa to our till when the rider arrives.",
} as const;

const input = "min-h-[50px] w-full rounded-[14px] border border-sand-deep bg-white px-3.5 text-[15px]";

/** Next three half-hour slots at least 30 minutes away. */
function pickupSlots(now = new Date()): string[] {
  const start = new Date(now.getTime() + 30 * 60000);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
  return [0, 1, 2].map((i) => new Date(start.getTime() + i * 30 * 60000).toISOString());
}

type Attempt = { key: string; cart: string };
const ATTEMPT_STORAGE = "dp-checkout-attempt";

/** The key for this cart: kept across a refresh, so a retry after a lost response finds the same order. */
function attemptFor(cart: string): Attempt {
  try {
    const stored: Attempt | null = JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE) ?? "null");
    if (stored?.cart === cart) return stored;
  } catch {
    // Storage can be blocked or hold junk: fall through to a new key, kept in memory by the caller.
  }
  const attempt = { key: crypto.randomUUID(), cart };
  try {
    sessionStorage.setItem(ATTEMPT_STORAGE, JSON.stringify(attempt));
  } catch {}
  return attempt;
}

export function CheckoutForm({ zones }: { zones: Zone[] }) {
  const { lines, subtotalKes, table, clear } = useCart();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(table ? "dine_in" : "pickup");
  const [pay, setPay] = useState<Pay>(defaultPay(table ? "dine_in" : "pickup"));
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [riderNotes, setRiderNotes] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Recomputed after a failed attempt, so a page left open stops offering times that have passed.
  const slots = useMemo(() => pickupSlots(), [error]); // eslint-disable-line react-hooks/exhaustive-deps
  // One key per attempt at this cart: a retry after an error or a lost response reuses it.
  const attempt = useRef<Attempt | null>(null);
  // The message sits below the fold on a phone, behind the bottom bar: bring it into view.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  const zone = zones.find((z) => z.id === zoneId);
  const fee = mode === "delivery" ? (zone?.fee_kes ?? 0) : 0;
  const total = subtotalKes + fee;

  const payOptions: { id: Pay; label: string; line: string }[] =
    mode === "dine_in"
      ? [
          { id: "at_counter", label: "Pay at the counter", line: PAY_LINE.at_counter },
          { id: "on_handover", label: "Pay on handover", line: PAY_LINE.dine_in },
        ]
      : [{ id: "on_handover", label: "Pay on handover", line: PAY_LINE[mode] }];
  // Changing the order type resets the choice, so a pickup order can never go as "at the counter".
  const chooseMode = (m: Mode) => {
    setMode(m);
    setPay(defaultPay(m));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = lines.map((l) => ({ dishId: l.dishId, menuEntryId: l.menuEntryId, optionId: l.optionId, quantity: l.quantity, note: l.note }));
    const cart = JSON.stringify(items);
    if (attempt.current?.cart !== cart) attempt.current = attemptFor(cart);
    const idempotencyKey = attempt.current.key;
    startTransition(async () => {
      const res = await placeOrder({
        idempotencyKey,
        mode,
        tableToken: table?.token,
        pickupAt: mode === "pickup" ? pickupAt : null,
        zoneId: mode === "delivery" ? zoneId : undefined,
        address: mode === "delivery" ? address : undefined,
        riderNotes: mode === "delivery" ? riderNotes : undefined,
        name,
        phone,
        payment: pay,
        items,
      }).catch(() => ({ ok: false as const, error: "We couldn’t confirm your order. Check your connection and try again." }));
      if (!res.ok) {
        setError(res.error);
        if (pickupAt && new Date(pickupAt) < new Date()) setPickupAt(null);
        return;
      }
      attempt.current = null;
      try {
        sessionStorage.removeItem(ATTEMPT_STORAGE);
      } catch {}
      clear();
      router.push(`/order/${res.token}`);
    });
  }

  if (lines.length === 0) {
    return <p className="mx-5 mt-6 text-ink-soft">Your order is empty.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col pb-8">
      <div role="radiogroup" aria-label="How you’ll get your food" className="mx-5 mt-2.5 grid grid-cols-3 gap-1 rounded-2xl bg-[#efe8dd] p-1">
        {(
          [
            ["dine_in", "Dine-in"],
            ["pickup", "Pickup"],
            ["delivery", "Delivery"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            // Delivery needs an area that's on (the server refuses it too, in place_order).
            disabled={(id === "dine_in" && !table) || (id === "delivery" && zones.length === 0)}
            onClick={() => chooseMode(id)}
            className={`min-h-11 rounded-xl text-sm font-semibold disabled:opacity-50 ${
              mode === id ? "bg-white text-teal-deep shadow-sm" : "text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="mx-5 mt-4 flex flex-col gap-3">
        {mode === "dine_in" && table && (
          <p className="rounded-[14px] bg-teal-tint px-4 py-3 text-[15px]">
            <b>{table.label}</b>. We’ll bring it to your table.
          </p>
        )}
        {mode === "dine_in" && !table && <p className="text-sm text-ink-soft">To order at a table, scan the QR code on it.</p>}

        {mode === "pickup" && (
          <>
            <span className="text-sm font-semibold">When will you collect?</span>
            <div className="flex flex-wrap gap-2">
              {[null, ...slots].map((s) => (
                <button
                  key={s ?? "asap"}
                  type="button"
                  onClick={() => setPickupAt(s)}
                  aria-pressed={pickupAt === s}
                  className={`min-h-11 rounded-xl px-3.5 text-sm ${
                    pickupAt === s ? "border-2 border-teal-deep bg-teal-tint font-semibold text-teal-deeper" : "border border-sand-deep bg-white"
                  }`}
                >
                  {s ? timeLabel(s) : "As soon as it’s ready"}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "delivery" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Delivery area
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={input} required>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} · {formatKes(z.fee_kes)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Delivery address
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, house number" className={input} required autoComplete="street-address" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Directions for the rider
              <input value={riderNotes} onChange={(e) => setRiderNotes(e.target.value)} placeholder="e.g. blue gate, call on arrival" className={input} />
            </label>
          </>
        )}
      </section>

      <section className="mx-5 mt-[18px] grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} required autoComplete="given-name" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="0712 345 678" className={input} required autoComplete="tel" />
        </label>
      </section>

      {payOptions.length > 1 ? (
        <fieldset className="mx-5 mt-5 flex flex-col rounded-[24px] bg-white p-[18px] shadow-[var(--shadow-card)]">
          <legend className="float-left font-display text-[21px] leading-tight">How you’ll pay</legend>
          <p className="clear-left mt-1 text-[13px] text-ink-soft">Nothing is charged now.</p>
          {payOptions.map((p) => (
            <label
              key={p.id}
              className="mt-2.5 flex min-h-11 cursor-pointer touch-manipulation items-start gap-3 rounded-[var(--r-md)] p-3.5 shadow-[inset_0_0_0_1.5px_var(--color-sand-deep)] select-none [-webkit-tap-highlight-color:transparent] active:bg-teal-tint has-checked:bg-teal-tint has-checked:shadow-[inset_0_0_0_2px_var(--color-teal-deep)]"
            >
              <input
                type="radio"
                name="pay"
                value={p.id}
                checked={pay === p.id}
                onChange={() => setPay(p.id)}
                className="mt-[3px] size-5 shrink-0 accent-teal-deep"
              />
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold">{p.label}</span>
                <span className="text-sm text-ink-soft">{p.line}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <section aria-labelledby="pay-heading" className="mx-5 mt-5 flex flex-col rounded-[24px] bg-white p-[18px] shadow-[var(--shadow-card)]">
          <h2 id="pay-heading" className="font-display text-[21px] leading-tight">How you’ll pay</h2>
          <p className="mt-1 text-[13px] text-ink-soft">Nothing is charged now.</p>
          {/* One way to pay: plain text, no ring or radio, so it can't read as a selected option. */}
          <p className="flex flex-col pt-1.5">
            <span className="text-[15px] font-semibold">{payOptions[0]!.label}</span>
            <span className="text-sm text-ink-soft">{payOptions[0]!.line}</span>
          </p>
        </section>
      )}

      <section aria-label="Summary" className="mx-5 mt-[18px] flex flex-col gap-2 text-[15px]">
        <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span className="font-semibold">{formatKes(subtotalKes)}</span></div>
        {mode === "delivery" && zone && (
          <div className="flex justify-between"><span className="text-ink-soft">Delivery · {zone.name}</span><span className="font-semibold">{formatKes(fee)}</span></div>
        )}
        <div className="flex justify-between border-t border-sand-deep pt-2 text-lg font-bold">
          <span>{pay === "at_counter" ? "To pay at the counter" : "To pay on handover"}</span>
          <span>{formatKes(total)}</span>
        </div>
      </section>

      {error && (
        <p ref={errorRef} role="alert" className="note-in mx-5 mt-4 rounded-xl bg-blush px-4 py-3 text-[15px] [overflow-wrap:anywhere] text-coral-ink">{error}</p>
      )}

      <BottomBar inlineOnDesktop="padded">
        <button
          type="submit"
          disabled={pending}
          className="press flex min-h-14 flex-1 touch-manipulation items-center justify-center rounded-[18px] bg-teal-deep px-5 font-semibold text-white select-none disabled:opacity-60"
        >
          {pending ? "Sending to Mama…" : `Place order · ${formatKes(total)}`}
        </button>
      </BottomBar>
    </form>
  );
}
