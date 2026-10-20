"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatKes } from "@/lib/format";
import { useCart } from "./cart-provider";
import { BottomBar, Stepper } from "./ui";

type Option = { id: string; label: string; price_delta_kes: number; is_default: boolean };

type Props = {
  dishId: string;
  menuEntryId: string | null;
  name: string;
  basePriceKes: number;
  options: Option[];
  unavailable: string | null;
  rotating: boolean;
};

export function DishForm({ dishId, menuEntryId, name, basePriceKes, options, unavailable, rotating }: Props) {
  const { add } = useCart();
  const router = useRouter();
  const [optionId, setOptionId] = useState<string | null>(options.find((o) => o.is_default)?.id ?? options[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  const option = options.find((o) => o.id === optionId) ?? null;
  const unit = basePriceKes + (option?.price_delta_kes ?? 0);

  return (
    <form
      className="flex flex-col gap-[18px] pb-32"
      onSubmit={(e) => {
        e.preventDefault();
        if (unavailable) return;
        add({ dishId, menuEntryId, optionId, optionLabel: option?.label ?? null, name, unitPriceKes: unit, note, quantity: qty, rotating });
        router.push("/cart");
      }}
    >
      {options.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">
            Choose your side <span className="text-[13px] font-medium text-ink-soft">· pick one</span>
          </legend>
          {options.map((o) => (
            <label
              key={o.id}
              className={`flex min-h-[52px] items-center gap-3 rounded-[14px] bg-white px-4 text-[15px] ${
                o.id === optionId ? "border-2 border-teal-deep font-semibold" : "border border-sand-deep"
              }`}
            >
              <input type="radio" name="option" checked={o.id === optionId} onChange={() => setOptionId(o.id)} className="size-[18px] accent-teal-deep" />
              {o.label}
              <span className="ml-auto font-normal text-ink-soft">
                {o.price_delta_kes === 0 ? "Included" : `+ ${formatKes(o.price_delta_kes)}`}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="note" className="text-base font-bold">Note for the kitchen</label>
        <textarea
          id="note"
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. no onions, extra pili pili"
          className="w-full resize-none rounded-[14px] border border-sand-deep bg-white px-3.5 py-3 text-[15px]"
        />
      </div>

      <BottomBar>
        {unavailable ? (
          <p className="flex min-h-14 flex-1 items-center justify-center rounded-2xl bg-sand font-semibold text-ink-soft">{unavailable}</p>
        ) : (
          <>
            <Stepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(20, n)))} label="plates" />
            <button type="submit" className="flex min-h-14 flex-1 items-center justify-between rounded-2xl bg-teal-deep px-[18px] font-semibold text-white">
              <span>Add to order</span>
              <span>{formatKes(unit * qty)}</span>
            </button>
          </>
        )}
      </BottomBar>
    </form>
  );
}
