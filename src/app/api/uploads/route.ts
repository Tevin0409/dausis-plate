import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaff } from "@/lib/supabase/server";
import { isPhotoType, MAX_VARIANT_BYTES, presignPhotoUpload, type PhotoType } from "@/lib/r2";

const body = z.object({
  variants: z
    .array(
      z.object({
        name: z.enum(["full", "thumb"]),
        contentType: z.string(),
        size: z.number().int().positive().max(MAX_VARIANT_BYTES),
      }),
    )
    .length(2)
    .refine((v) => new Set(v.map((x) => x.name)).size === 2, "Need one full and one thumb"),
});

export async function POST(request: Request) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Sign in to upload photos" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That photo is too large after resizing" }, { status: 400 });

  const variants = parsed.data.variants;
  if (!variants.every((v) => isPhotoType(v.contentType))) {
    return NextResponse.json({ error: "Unsupported photo format" }, { status: 400 });
  }

  const uploads = await presignPhotoUpload(
    variants.map((v) => ({ name: v.name, contentType: v.contentType as PhotoType, size: v.size })),
  );
  return NextResponse.json({ uploads });
}
