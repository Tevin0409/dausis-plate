"use client";
import { ShopError } from "@/components/states";

export default function DishError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShopError
      title="Something went wrong"
      message="Something went wrong loading this dish. Check your connection and try again."
      reset={reset}
      digest={error.digest}
    />
  );
}
