"use client";
import { DashboardError } from "@/components/states";

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DashboardError title="Couldn’t load orders" message="Something went wrong loading today’s orders. Try again." reset={reset} digest={error.digest} />;
}
