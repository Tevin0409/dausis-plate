import { OWNER_ONLY } from "@/lib/permissions";

const INSUFFICIENT_PRIVILEGE = "42501";
const KNOWN = new Set(Object.values(OWNER_ONLY));

/**
 * The line to show when the database refused a change because of who is asking (42501), or null
 * for any other error. The guards' own texts pass through; a bare RLS or grant refusal reads as
 * "Only the owner can do this." (spec-2.3 "Refused anyway").
 */
export function refusal(error: { code?: string; message: string } | null): string | null {
  if (error?.code !== INSUFFICIENT_PRIVILEGE) return null;
  return KNOWN.has(error.message) ? error.message : OWNER_ONLY.owner;
}
