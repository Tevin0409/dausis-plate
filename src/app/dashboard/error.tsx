"use client";
import { DashboardError } from "@/components/states";

export default function DashboardErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DashboardError title="Something went wrong" message="This page didn’t load. Check the connection and try again." reset={reset} digest={error.digest} />;
}
