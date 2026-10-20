"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { placeOrder } from "@/app/(shop)/checkout/actions";
import { formatKes, timeLabel } from "@/lib/format";
import { useCart } from "./cart-provider";
import { BottomBar } from "./ui";

type Zone = { id: string; name: string; fee_kes: number };
type Mode = "dine_in" | "pickup" | "delivery";
type Pay = "mpesa" | "card" | "on_handover";

const input = "min-h-[50px] w-full rounded-[14px] border border-sand-deep bg-white px-3.5 text-[15px]";

/** Next three half-hour slots at least 30 minutes away. */
function pickupSlots(now = new Date()): string[] {
  const start = new Date(now.getTime() + 30 * 60000);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
  return [0, 1, 2].map((i) => new Date(start.getTime() + i * 30 * 60000).toISOString());
}

export function CheckoutForm({ zones }: { zones: Zone[] }) {
  const { lines, subtotalKes, table, clear } = useCart();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(table ? "dine_in" : "pickup");
  const [pay, setPay] = useState<Pay>("mpesa");
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [riderNotes, setRiderNotes] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const slots = useMemo(() => pickupSlots(), []);
  const zone = zones.find((z) => z.id === zoneId);
  const fee = mode === "delivery" ? (zone?.fee_kes ?? 0) : 0;
  const total = subtotalKes + fee;

  const handover = mode === "dine_in" ? "Pay at your table" : mode === "pickup" ? "Pay at the counter" : "Pay the rider on arrival";
  const payOptions: { id: Pay; label: string; hint: string }[] = [
    { id: "mpesa", label: "M-Pesa", hint: phone ? `We’ll send a prompt to ${phone}` : "We’ll send a prompt to your phone" },
    { id: "card", label: "Card", hint: "Visa or Mastercard" },
    { id: "on_handover", label: handover, hint: "Cash or M-Pesa when your food arrives" },
  ];
  const cta = pay === "mpesa" ? "Pay with M-Pesa" : pay === "card" ? "Pay by card" : "Place order";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await placeOrder({
        mode,
        tableToken: table?.token,
        pickupAt: mode === "pickup" ? pickupAt : null,
        zoneId: mode === "delivery" ? zoneId : undefined,
        address: mode === "delivery" ? address : undefined,
        riderNotes: mode === "delivery" ? riderNotes : undefined,
        name,
        phone,
        payment: pay,
        items: lines.map((l) => ({ dishId: l.dishId, menuEntryId: l.menuEntryId, optionId: l.optionId, quantity: l.quantity, note: l.note })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clear();
      if (res.payment.kind === "redirect") window.location.assign(res.payment.url);
      else router.push(`/order/${res.token}`);
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
            disabled={id === "dine_in" && !table}
            onClick={() => setMode(id)}
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

      <fieldset className="mx-5 mt-5 flex flex-col gap-2">
        <legend className="mb-2 font-display text-xl">Pay with</legend>
        {payOptions.map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer items-center gap-3 rounded-[14px] bg-white px-4 py-3 ${pay === p.id ? "border-2 border-teal-deep" : "border border-sand-deep"}`}
          >
            <input type="radio" name="pay" checked={pay === p.id} onChange={() => setPay(p.id)} className="size-[18px] accent-teal-deep" />
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">{p.label}</span>
              <span className="text-[13px] text-ink-soft">{p.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <section className="mx-5 mt-[18px] flex flex-col gap-2 text-[15px]">
        <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span className="font-semibold">{formatKes(subtotalKes)}</span></div>
        {mode === "delivery" && zone && (
          <div className="flex justify-between"><span className="text-ink-soft">Delivery · {zone.name}</span><span className="font-semibold">{formatKes(fee)}</span></div>
        )}
      </section>

      {error && (
        <p role="alert" className="mx-5 mt-4 rounded-xl bg-blush px-4 py-3 text-[15px] text-coral-ink">{error}</p>
      )}

      <BottomBar>
        <button type="submit" disabled={pending} className="flex min-h-14 flex-1 items-center justify-between rounded-[18px] bg-teal-deep px-5 font-semibold text-white disabled:opacity-60">
          <span>{pending ? "Placing order…" : cta}</span>
          <span>{formatKes(total)}</span>
        </button>
      </BottomBar>
    </form>
  );
}
