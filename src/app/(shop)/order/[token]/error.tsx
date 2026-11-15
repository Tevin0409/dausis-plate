"use client";
import { ShopError } from "@/components/states";

export default function OrderError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShopError
      title="We couldn’t load your order"
      message="Check your connection and try again."
      reset={reset}
      digest={error.digest}
    />
  );
}
