// Money maths and wording for Reports. The database does the sums; this reads them back in Mama's words.
import { formatKes } from "@/lib/format";

export type MoneyRow = {
  bucket: string;
  cash: number;
  mpesa: number;
  mpesa_online: number;
  card: number;
  not_recorded: number;
  cash_n: number;
  mpesa_n: number;
  credit_notes: number;
  cn_cash: number;
  cn_mpesa: number;
  credit_notes_voided: number;
  cnv_cash: number;
  cnv_mpesa: number;
  net: number;
  legacy_n: number;
};

/** Net money in = payments − credit notes issued + credit notes voided. */
export const netOf = (r: Pick<MoneyRow, "cash" | "mpesa" | "mpesa_online" | "card" | "not_recorded" | "credit_notes" | "credit_notes_voided">) =>
  r.cash + r.mpesa + r.mpesa_online + r.card + r.not_recorded - r.credit_notes + r.credit_notes_voided;

/** "−KSh 520" for money below zero (a real minus sign, no red). */
export const kesSigned = (n: number) => (n < 0 ? `−${formatKes(-n)}` : formatKes(n));

/** In a table cell: "−520" for a credit note, "+520" for a void, plain otherwise, "" for none. */
export function plainSigned(n: number, sign: "-" | "+" | "" = ""): string {
  if (!n) return "";
  const body = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.abs(n));
  if (sign === "-") return `−${body}`;
  if (sign === "+") return `+${body}`;
  return n < 0 ? `−${body}` : body;
}

/** Today's drawer line (spec "Money in by day"), from the one-day money_in row. */
export function drawerLine(r: MoneyRow | undefined): string {
  const part = (label: string, taken: number, n: number, out: number, back: number, by: string) => {
    const net = taken - out + back;
    let s = `${label}: ${formatKes(taken)} from ${n === 1 ? "1 order" : `${n} orders`}`;
    if (out) s += `, less ${formatKes(out)} refunded ${by}`;
    if (back) s += `, plus ${formatKes(back)} from a voided credit note`;
    if (out || back) s += `: ${kesSigned(net)}`;
    return `${s}.`;
  };
  const cash = part("Cash taken today", r?.cash ?? 0, r?.cash_n ?? 0, r?.cn_cash ?? 0, r?.cnv_cash ?? 0, "in cash");
  // The spec writes the M-Pesa side without "orders": "M-Pesa: KSh 12,100 from 30."
  const m = r?.mpesa ?? 0;
  const mOut = r?.cn_mpesa ?? 0;
  const mBack = r?.cnv_mpesa ?? 0;
  let mp = `M-Pesa: ${formatKes(m)} from ${r?.mpesa_n ?? 0}`;
  if (mOut) mp += `, less ${formatKes(mOut)} refunded by M-Pesa`;
  if (mBack) mp += `, plus ${formatKes(mBack)} from a voided credit note`;
  if (mOut || mBack) mp += `: ${kesSigned(m - mOut + mBack)}`;
  return `${cash} ${mp}.`;
}

/** "KSh 520 of 670 · 150 kept" when lowered, "KSh 670" otherwise. */
export function creditNoteAmount(amount: number, orderTotal: number): string {
  return amount < orderTotal ? `${formatKes(amount)} of ${orderTotal} · ${orderTotal - amount} kept` : formatKes(amount);
}

/** The prefilled credit-note reason from the cancel reason ("Refund" alone for Other). */
export function defaultCreditReason(reason: string | null): string {
  const w: Record<string, string> = {
    sold_out: "it sold out",
    too_busy: "we were too busy",
    cant_deliver: "we couldn’t deliver there",
    customer_asked: "customer asked to cancel",
    no_show: "customer didn’t come",
  };
  return reason && w[reason] ? `Refund: ${w[reason]}` : "Refund";
}

/** Checks the credit note amount the way the server will, so the form can say it before sending. */
export function creditAmountError(raw: string, paid: number): string | null {
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!raw.trim() || !Number.isInteger(n) || n < 1) return "Enter at least KSh 1.";
  if (n > paid) return `The credit note can’t be more than was paid, ${formatKes(paid)}.`;
  return null;
}

export const creditReasonError = (raw: string): string | null => {
  const n = raw.trim().length;
  return n >= 3 && n <= 120 ? null : "Write a reason of 3 to 120 characters.";
};
