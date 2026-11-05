"use client";
import { DashboardError } from "@/components/states";

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DashboardError title="Couldn’t load the menu plan" message="Something went wrong loading the week’s menu. Try again." reset={reset} digest={error.digest} />;
}
