"use client";
import { DashboardError } from "@/components/states";

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DashboardError title="Couldn’t load menu and sales" message="Something went wrong loading today’s sales and the regular menu. Try again." reset={reset} digest={error.digest} />;
}
