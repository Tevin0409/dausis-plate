"use client";
// Error, not-found and loading pieces shared by the shop and the dashboard.
// Plain structure on the existing tokens; the wave-1 design restyles them.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { dashPrimary, shopPrimary, shopSecondary } from "./state-styles";

/** Re-runs the failed server render: refresh the data, then reset the boundary. */
export function TryAgain({ reset, className }: { reset: () => void; className: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(() => {
          router.refresh();
          reset();
        })
      }
      className={className}
    >
      {pending ? "Trying again…" : "Try again"}
    </button>
  );
}

type ErrorProps = { title: string; message: string; reset: () => void; digest?: string };

/** Shop error: phone-first, one clear retry and a way back to the menu. */
export function ShopError({ title, message, reset, digest, back = true }: ErrorProps & { back?: boolean }) {
  return (
    <main className="flex flex-col gap-4 px-5 pt-16">
      <h1 className="font-display text-[28px] leading-tight">{title}</h1>
      <p role="alert" className="text-[15px] leading-normal text-ink-soft">{message}</p>
      <div className="mt-2 flex flex-col gap-3">
        <TryAgain reset={reset} className={shopPrimary} />
        {back && <Link href="/" className={shopSecondary}>Back to menu</Link>}
      </div>
      {digest && <p className="mt-2 text-[13px] text-ink-soft [overflow-wrap:anywhere]">Reference {digest}</p>}
    </main>
  );
}

/** Dashboard error: sits inside the dashboard shell so the nav stays usable. */
export function DashboardError({ title, message, reset, digest }: ErrorProps) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3 rounded-[20px] border border-line bg-white p-6">
      <h1 className="font-display text-[28px] leading-tight">{title}</h1>
      <p role="alert" className="text-[15px] text-ink-soft">{message}</p>
      <div className="mt-1">
        <TryAgain reset={reset} className={dashPrimary} />
      </div>
      {digest && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">Reference {digest}</p>}
    </div>
  );
}

/** A static placeholder block. No shimmer or pulse: this slice adds no motion. */
export function Bone({ className }: { className: string }) {
  return <div aria-hidden className={`bg-sand ${className}`} />;
}

/** Marks a skeleton region as loading for assistive tech. */
export function Loading({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
