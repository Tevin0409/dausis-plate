"use client";
import { ShopError } from "@/components/states";

export default function OrderError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShopError
      title="Couldn’t load your order"
      message="Your order is safe. We just couldn’t load its status. Check your connection and try again."
      reset={reset}
      digest={error.digest}
    />
  );
}
