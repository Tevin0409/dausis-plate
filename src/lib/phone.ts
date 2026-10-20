/** Normalises Kenyan numbers (0712…, 712…, 254712…, +254712…) to +2547XXXXXXXX / +2541XXXXXXXX. */
export function normaliseKenyanPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let local: string | null = null;
  if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) local = digits;
  else if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3);
  return local ? `+254${local}` : null;
}

/** Format Daraja expects: 2547XXXXXXXX */
export const toMsisdn = (e164: string) => e164.replace(/^\+/, "");
