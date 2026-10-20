"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the server component every `seconds` while the order is still moving. */
export function AutoRefresh({ active, seconds = 10 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [active, seconds, router]);
  return null;
}
