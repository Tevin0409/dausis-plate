import "server-only";
import { headers } from "next/headers";

/** The site's address for links the server writes (QR cards, invite links): the configured URL, else this request's host. */
export async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && /^https?:\/\//.test(configured) && !configured.includes("localhost")) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
