// Slice 2.11 C: the customer's words for discount codes (cart, checkout), in one place. Plain module.
import { formatKes } from "./format";
import { type OrderMode, shortDate } from "./promos";

export const CODE_REASONS = ["unknown", "off", "not_started", "ended", "used_up", "min_order", "combos_only", "mode", "phone_used"] as const;
export type CodeReason = (typeof CODE_REASONS)[number];

/** check_discount_code's answer. `discountKes` is the cart's estimate; place_order works it out for real. */
export type CodeCheck = {
  ok: boolean;
  code: string;
  discountKes: number;
  reason: CodeReason | null;
  /** "10% off, up to KSh 300". Null for an unknown code. */
  label: string | null;
  startsOn: string | null;
  minOrderKes: number | null;
  modes: OrderMode[] | null;
};

export const codeReason = (v: unknown): CodeReason | null => CODE_REASONS.find((r) => r === v) ?? null;

const MODE_WORD: Record<OrderMode, string> = { dine_in: "dine-in", pickup: "pickup", delivery: "delivery" };

function modesWords(modes: OrderMode[]): string {
  const w = modes.map((m) => MODE_WORD[m]);
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`;
}

/** Under the field after Apply, and under the checkout summary (spec-2.11 "Customer: cart — code"). */
export function codeError(c: CodeCheck, foodKes: number): string {
  switch (c.reason) {
    case "unknown":
    case null:
      return "We don’t know that code. Check the spelling.";
    case "off":
      return `${c.code} isn’t on right now.`;
    case "not_started":
      return c.startsOn ? `${c.code} starts on ${shortDate(c.startsOn)}.` : `${c.code} hasn’t started yet.`;
    case "ended":
      return `${c.code} has ended.`;
    case "used_up":
      return `${c.code} has been used up.`;
    case "min_order": {
      const min = c.minOrderKes ?? 0;
      return `${c.code} is for orders of ${formatKes(min)} or more. Add ${formatKes(Math.max(min - foodKes, 0))} more to use it.`;
    }
    case "combos_only":
      // Nothing orderable at all (an emptied cart, or only dishes off today's menu) also lands here.
      return foodKes > 0 ? "Codes don’t apply to combos." : `Add a dish to use ${c.code}.`;
    case "mode":
      return c.modes && c.modes.length > 0 ? `${c.code} is for ${modesWords(c.modes)} only.` : `${c.code} isn’t for this kind of order.`;
    case "phone_used":
      return `This phone number has already used ${c.code}.`;
  }
}

/** The amber chip for a code that was applied and no longer works: it stays, the discount goes. */
export function codeHeldNote(c: CodeCheck, foodKes: number): string {
  if (c.reason === "min_order") return `Add ${formatKes(Math.max((c.minOrderKes ?? 0) - foodKes, 0))} more to use ${c.code}`;
  return codeError(c, foodKes).replace(/\.$/, "");
}

export const CODE_UNREACHABLE = "We couldn’t check the code. Try again.";
