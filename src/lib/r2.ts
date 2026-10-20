import "server-only";
import { DeleteObjectsCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

let s3: S3Client | undefined;

function client() {
  const { accountId, accessKeyId, secretAccessKey } = env.r2;
  s3 ??= new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // AWS SDK ≥3.729 signs a CRC32 of the (empty) body into presigned PUT URLs by default,
    // so R2 rejects the real upload. Only add checksums when an operation requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3;
}

/** Only already-optimised images are accepted; the browser converts before upload. */
export const PHOTO_TYPES = { "image/webp": "webp", "image/jpeg": "jpg" } as const;
export type PhotoType = keyof typeof PHOTO_TYPES;
export const isPhotoType = (t: string): t is PhotoType => t in PHOTO_TYPES;
export const MAX_VARIANT_BYTES = 3 * 1024 * 1024;

export type VariantName = "full" | "thumb";

/** dishes/<uuid>/full.webp, dishes/<uuid>/thumb.jpg … */
export const PHOTO_KEY = /^dishes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(full|thumb)\.(webp|jpg)$/;

export function publicPhotoUrl(key: string): string {
  const base = process.env.NEXT_PUBLIC_PHOTO_BASE_URL;
  if (!base) throw new Error("Missing NEXT_PUBLIC_PHOTO_BASE_URL. See .env.example.");
  return `${base.replace(/\/$/, "")}/${key}`;
}

/** Short-lived PUT URLs, one per variant, sharing one photo id. The bytes never pass through the app. */
export async function presignPhotoUpload(variants: { name: VariantName; contentType: PhotoType; size: number }[]) {
  const id = crypto.randomUUID();
  return Promise.all(
    variants.map(async (v) => {
      const key = `dishes/${id}/${v.name}.${PHOTO_TYPES[v.contentType]}`;
      const command = new PutObjectCommand({
        Bucket: env.r2.bucket,
        Key: key,
        ContentType: v.contentType,
        ContentLength: v.size,
        CacheControl: "public, max-age=31536000, immutable",
      });
      return { name: v.name, key, url: await getSignedUrl(client(), command, { expiresIn: 300 }) };
    }),
  );
}

export async function photoExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Deletes every variant stored under the same photo id as `key`. Best effort. */
export async function deletePhotoSet(key: string | null) {
  if (!key || !PHOTO_KEY.test(key)) return;
  const prefix = key.slice(0, key.lastIndexOf("/") + 1);
  const keys = ["full.webp", "full.jpg", "thumb.webp", "thumb.jpg"].map((f) => ({ Key: prefix + f }));
  try {
    await client().send(new DeleteObjectsCommand({ Bucket: env.r2.bucket, Delete: { Objects: keys, Quiet: true } }));
  } catch (e) {
    console.warn("[r2] couldn’t delete old photo", prefix, e);
  }
}
