import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// Daraja STK push result callback. Matches the order by CheckoutRequestID.
const callback = z.object({
  Body: z.object({
    stkCallback: z.object({
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      CallbackMetadata: z
        .object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) })
        .optional(),
    }),
  }),
});

export async function POST(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!process.env.MPESA_CALLBACK_SECRET || secret !== process.env.MPESA_CALLBACK_SECRET) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }

  const parsed = callback.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ResultCode: 1, ResultDesc: "Bad payload" }, { status: 400 });

  const { CheckoutRequestID, ResultCode, CallbackMetadata } = parsed.data.Body.stkCallback;
  const receipt = CallbackMetadata?.Item.find((i) => i.Name === "MpesaReceiptNumber")?.Value;

  const admin = createAdminClient();
  await admin
    .from("orders")
    .update(
      ResultCode === 0
        ? { payment_status: "paid", mpesa_receipt: receipt === undefined ? null : String(receipt) }
        : { payment_status: "failed" },
    )
    .eq("mpesa_checkout_request_id", CheckoutRequestID);

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
