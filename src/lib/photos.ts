/** Public URL for a dish photo stored in R2, resized by Cloudflare when enabled. */
export function photoUrl(key: string | null, width = 640): string | null {
  const base = process.env.NEXT_PUBLIC_PHOTO_BASE_URL;
  if (!key || !base) return null;
  const clean = base.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING === "true") {
    return `${clean}/cdn-cgi/image/width=${width},quality=80,format=auto/${key}`;
  }
  return `${clean}/${key}`;
}
