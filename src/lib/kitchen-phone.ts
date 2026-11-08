// Slice 2.6, Settings: phone. The kitchen phone is a Kenyan mobile or landline, stored as +254 and 9
// digits (database check `^\+254[1-7][0-9]{8}$`). 8 and 9 (toll-free, premium) are refused.
// Customers' M-Pesa numbers stay mobile only (`normaliseKenyanPhone` in phone.ts).

export const KITCHEN_PHONE_ERROR = "Enter a Kenyan number, like 0712 345 678 or 020 123 4567.";

/** "" for empty (no phone), the +254 form when valid, null when it isn't a Kenyan number we take. */
export function normaliseKitchenPhone(input: string): string | null {
  const raw = input.trim();
  if (raw === "") return "";
  if (!/^[\d\s\-.()+]+$/.test(raw)) return null;
  if (raw.includes("+") && !/^\+254/.test(raw.replace(/[\s\-.()]/g, ""))) return null;
  const digits = raw.replace(/\D/g, "");
  const m = /^(?:0|254)([1-7]\d{8})$/.exec(digits);
  return m ? `+254${m[1]}` : null;
}

/** 0712 345 678 for mobiles (7, 1), 020 123 4567 for landlines (area code, then 3 and 4 digits). */
export function formatKenyanPhone(e164: string): string {
  const n = /^\+254(\d{9})$/.exec(e164)?.[1];
  if (!n) return e164;
  return /^[17]/.test(n) ? `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}
