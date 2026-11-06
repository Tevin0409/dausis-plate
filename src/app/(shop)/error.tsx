"use client";
import { usePathname } from "next/navigation";
import { ShopError } from "@/components/states";

const WHAT: Record<string, string> = { "/": "the menu", "/checkout": "checkout", "/cart": "your order" };

export default function ShopErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const what = WHAT[usePathname()] ?? "this page";
  return (
    <ShopError
      title="Something went wrong"
      message={`Something went wrong loading ${what}. Check your connection and try again.`}
      reset={reset}
      digest={error.digest}
      back={what !== "the menu"}
    />
  );
}
