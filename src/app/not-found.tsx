import Link from "next/link";
import { shopPrimary } from "@/components/state-styles";

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-cream">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-16">
        <h1 className="font-display text-[28px] leading-tight">This page doesn’t exist</h1>
        <p className="text-[15px] leading-normal text-ink-soft">The link may be wrong or out of date.</p>
        <Link href="/" className={`mt-2 ${shopPrimary}`}>See today’s menu</Link>
      </main>
    </div>
  );
}
