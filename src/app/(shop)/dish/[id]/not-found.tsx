import Link from "next/link";
import { shopPrimary } from "@/components/state-styles";

export default function DishNotFound() {
  return (
    <main className="flex flex-col gap-4 px-5 pt-16">
      <h1 className="font-display text-[28px] leading-tight">This dish isn’t on the menu</h1>
      <p className="text-[15px] leading-normal text-ink-soft">It may have been taken off, or the link is wrong. Today’s dishes are on the menu.</p>
      <Link href="/" className={`mt-2 ${shopPrimary}`}>See today’s menu</Link>
    </main>
  );
}
