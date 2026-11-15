"use client";
import { MinusIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Plate } from "@/components/plate";
import { extrasLine, partLine } from "@/lib/cart-lines";
import { isCounted, MAX_PER_LINE } from "@/lib/cart-check";
import { formatKes, weekdayName } from "@/lib/format";
import { menuDayOf } from "@/lib/kitchen";
import { capNote, loweredNote, notOnMenuNote, notOnMenuPill, soldOutNote } from "@/lib/menu-words";
import { type CartLine, useCart } from "./cart-provider";
import { useKitchen } from "./kitchen-provider";
import { Pill } from "./menu/pills";

/**
 * The order's quantity control (spec-2.8 panel "Lines", DESIGN.md "stepper"): 44 px buttons,
 * − turns into the bin at 1, + is off at the cap, and the count is a polite live output.
 */
export function QtyStepper({ line, cap }: { line: CartLine; cap: number }) {
  const { setQuantity } = useCart();
  const one = line.quantity <= 1;
  const btn =
    "press flex size-11 select-none items-center justify-center rounded-full text-teal-deep touch-manipulation disabled:text-ink-soft/50";
  return (
    <div className="flex flex-none items-center rounded-full bg-paper ring-1 ring-sand-deep">
      <button
        type="button"
        aria-label={one ? `Remove ${line.name}` : `One fewer ${line.name}`}
        onClick={() => setQuantity(line.key, line.quantity - 1)}
        className={btn}
      >
        {one ? <TrashIcon size={17} /> : <MinusIcon size={16} />}
      </button>
      <output aria-live="polite" className="min-w-5 text-center text-[15px] font-bold tabular-nums">
        {line.quantity}
      </output>
      <button
        type="button"
        aria-label={`One more ${line.name}`}
        disabled={line.quantity >= cap}
        onClick={() => setQuantity(line.key, line.quantity + 1)}
        className={btn}
      >
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

// Not in the spec yet: provisional words, flagged for dev.designer in the 2.8 report.
const OUT_WORDS = {
  option_out: { pill: "Choice sold out", note: "Not in your total. Remove it, then choose again." },
  not_now: { pill: "Not served now", note: "Not in your total. Keep it for later, or remove it." },
  // 2.11 B (spec "States": the combo line goes amber with Remove).
  combo_off: { pill: "Not available", note: "This combo isn’t available any more. Remove it." },
  combo_parts: { pill: "Combo changed", note: "This combo has changed. Remove it and add it again." },
} as const;

/**
 * One line of the order: the panel beside the menu (plate 44) and the phone cart (plate 60).
 * Lines out of the total (sold out, not on that day's menu) stay, greyed, with Remove instead of
 * the stepper (spec-2.8 "A dish sells out while it's in an open order"; DESIGN.md recheck).
 */
export function CartLineItem({ line, plate, fresh = false }: { line: CartLine; plate: 44 | 60; fresh?: boolean }) {
  const { checks, capFor, leftFor, remove } = useCart();
  const { status, open } = useKitchen();
  const check = checks[line.key];
  const counted = isCounted(check);
  const day = weekdayName(menuDayOf(status));
  const cap = capFor(line.key);
  const entries = line.kind === "combo" ? (line.parts ?? []).map((p) => p.menuEntryId) : [line.menuEntryId];
  const limited = entries.some((e) => e !== null && leftFor(e) != null) && cap < MAX_PER_LINE;
  const choice = extrasLine(line.optionLabel, line.extras);

  let out: { pill: string; tone: "sand" | "amber"; note: string; noteClass: string } | null = null;
  if (check?.state === "sold_out") out = { pill: "Sold out today", tone: "sand", note: soldOutNote, noteClass: "text-ink-soft" };
  else if (check?.state === "not_on_menu")
    out = { pill: notOnMenuPill(day), tone: "amber", note: notOnMenuNote, noteClass: "text-amber-ink" };
  else if (check?.state === "option_out" || check?.state === "not_now" || check?.state === "combo_off" || check?.state === "combo_parts")
    out = { pill: OUT_WORDS[check.state].pill, tone: "amber", note: OUT_WORDS[check.state].note, noteClass: "text-amber-ink" };

  const note = counted
    ? check?.lowered
      ? loweredNote(check.lowered)
      : limited && line.quantity >= cap
        ? capNote({ open, cap, day })
        : null
    : null;

  return (
    <li className={`flex gap-3 py-3.5 ${fresh ? "line-in" : ""}`}>
      <Plate id={line.parts?.[0]?.dishId ?? line.dishId} photo={line.photo ?? null} size={plate} dim={!counted} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <span title={line.name} className={`line-clamp-3 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere] ${counted ? "" : "text-ink-soft"}`}>
            {line.name}
          </span>
          <span className={`flex-none whitespace-nowrap text-[15px] font-bold tabular-nums ${counted ? "" : "text-ink-soft line-through"}`}>
            {formatKes(line.unitPriceKes * line.quantity)}
          </span>
        </div>
        {choice && <span className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">{choice}</span>}
        {line.parts && (
          <ul aria-label={`In ${line.name}`} className="flex flex-col gap-0.5 border-l-2 border-sand-deep pl-2.5 text-[13px] text-ink-soft">
            {line.parts.map((p) => (
              <li key={p.dishId} className="[overflow-wrap:anywhere]">
                {partLine(p)}
              </li>
            ))}
          </ul>
        )}
        {line.note && <span className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">Note: {line.note}</span>}
        {out ? (
          <>
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <Pill text={out.pill} tone={out.tone} />
              <button
                type="button"
                onClick={() => remove(line.key)}
                className="press -mr-2 min-h-11 select-none rounded-full px-3 text-sm font-semibold text-teal-deep touch-manipulation"
              >
                Remove<span className="sr-only"> {line.name}</span>
              </button>
            </div>
            <p className={`text-[12.5px] leading-snug ${out.noteClass}`}>{out.note}</p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink-soft tabular-nums">{formatKes(line.unitPriceKes)} each</span>
              <QtyStepper line={line} cap={cap} />
            </div>
            {note && <p className="text-[12.5px] font-semibold leading-snug text-amber-ink">{note}</p>}
          </>
        )}
      </div>
    </li>
  );
}

/** Ink strip after a removal, with Undo for 6 s (spec-2.8 panel footer). */
export function UndoStrip({ className = "" }: { className?: string }) {
  const { removed, undoRemove } = useCart();
  if (!removed) return null;
  return (
    <div role="status" key={removed.key} className={`line-in flex items-center justify-between gap-3 rounded-[var(--r-md)] bg-ink py-1 pl-4 pr-1 text-sm text-white ${className}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">Removed {removed.name}.</span>
      <button
        type="button"
        onClick={undoRemove}
        className="press min-h-10 flex-none select-none rounded-full px-4 font-bold text-white touch-manipulation"
      >
        Undo
      </button>
    </div>
  );
}

/** The one polite live region for the order: adds, sell-outs and lowered amounts. */
export function OrderAnnouncer() {
  const { announcement } = useCart();
  return (
    <div aria-live="polite" className="sr-only">
      {announcement && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}

/** The order's main button: checkout, closed (disabled with the total), or nothing left. */
export function useOrderButton() {
  const { lines, count, subtotalKes: food, discountKes } = useCart();
  const { open } = useKitchen();
  // The button shows what the food comes to after the code (delivery is added at checkout).
  const subtotalKes = food - discountKes;
  if (lines.length > 0 && count === 0) return { kind: "nothing" as const, subtotalKes };
  return { kind: open ? ("checkout" as const) : ("closed" as const), subtotalKes };
}
