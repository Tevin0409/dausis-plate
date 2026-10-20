import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

let s3: S3Client | undefined;

function client() {
  const { accountId, accessKeyId, secretAccessKey } = env.r2;
  s3 ??= new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3;
}

export const ALLOWED_PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type PhotoType = keyof typeof ALLOWED_PHOTO_TYPES;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const isPhotoType = (t: string): t is PhotoType => t in ALLOWED_PHOTO_TYPES;

/** A short-lived URL the browser PUTs the photo to directly; the app never proxies the bytes. */
export async function presignPhotoUpload(contentType: PhotoType, size: number) {
  const key = `dishes/${crypto.randomUUID()}.${ALLOWED_PHOTO_TYPES[contentType]}`;
  const command = new PutObjectCommand({
    Bucket: env.r2.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
    CacheControl: "public, max-age=31536000, immutable",
  });
  const url = await getSignedUrl(client(), command, { expiresIn: 300 });
  return { key, url };
}
