import "server-only";
import { toMsisdn } from "@/lib/phone";

export type PaymentStart =
  | { kind: "mpesa_prompt_sent" }
  | { kind: "redirect"; url: string }
  | { kind: "none" }
  | { kind: "failed"; message: string };

type Order = { code: string; publicToken: string; totalKes: number; phone: string };

/**
 * M-Pesa STK push. STUB: logs instead of calling Daraja, and the order stays "payment pending"
 * (staff can mark it paid on the orders board). To go live:
 *   1. OAuth token from Daraja: GET /oauth/v1/generate?grant_type=client_credentials
 *   2. POST /mpesa/stkpush/v1/processrequest with BusinessShortCode, Password
 *      (base64 of shortcode + passkey + timestamp), Timestamp, TransactionType "CustomerPayBillOnline",
 *      Amount, PartyA and PhoneNumber = msisdn, PartyB = shortcode,
 *      CallBackURL = `${NEXT_PUBLIC_SITE_URL}/api/payments/mpesa/callback?secret=${MPESA_CALLBACK_SECRET}`,
 *      AccountReference = order code, TransactionDesc = "Dausis Plate order"
 *   3. Save the returned CheckoutRequestID on the order (service-role client) so the callback can match it.
 */
export async function startMpesaPayment(order: Order): Promise<PaymentStart> {
  console.info(`[mpesa:stub] STK push to ${toMsisdn(order.phone)} for KSh ${order.totalKes} (${order.code})`);
  return { kind: "mpesa_prompt_sent" };
}

/** Card checkout. STUB: plug in the chosen provider's hosted checkout and return { kind: "redirect", url }. */
export async function startCardPayment(order: Order): Promise<PaymentStart> {
  console.info(`[card:stub] checkout for KSh ${order.totalKes} (${order.code})`);
  return { kind: "none" };
}
