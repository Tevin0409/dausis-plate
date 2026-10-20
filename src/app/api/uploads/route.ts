import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaff } from "@/lib/supabase/server";
import { isPhotoType, MAX_PHOTO_BYTES, presignPhotoUpload } from "@/lib/r2";

const body = z.object({
  contentType: z.string(),
  size: z.number().int().positive().max(MAX_PHOTO_BYTES),
});

export async function POST(request: Request) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Sign in to upload photos" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Photos must be under 8 MB" }, { status: 400 });
  }
  const { contentType, size } = parsed.data;
  if (!isPhotoType(contentType)) {
    return NextResponse.json({ error: "Use a JPG, PNG or WebP photo" }, { status: 400 });
  }

  const { key, url } = await presignPhotoUpload(contentType, size);
  return NextResponse.json({ key, url });
}
