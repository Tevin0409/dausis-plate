"use client";
// Last resort for errors outside a segment's own boundary (e.g. a layout's reads).
import { TryAgain } from "@/components/states";
import { shopPrimary } from "@/components/state-styles";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-dvh bg-cream">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-16">
        <h1 className="font-display text-[28px] leading-tight">Something went wrong</h1>
        <p role="alert" className="text-[15px] leading-normal text-ink-soft">We couldn’t load this page. Check your connection and try again.</p>
        <TryAgain reset={reset} className={`mt-2 ${shopPrimary}`} />
        {error.digest && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">Reference {error.digest}</p>}
      </main>
    </div>
  );
}
