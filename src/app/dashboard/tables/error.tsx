"use client";
import { DashboardError } from "@/components/states";

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <DashboardError
      title="Couldn’t load tables and delivery areas"
      message="Something went wrong loading your tables and delivery areas. They haven’t changed. Try again."
      reset={reset}
      digest={error.digest}
    />
  );
}
