import Link from "next/link";
import { dashPrimary } from "@/components/state-styles";

export default function DashboardNotFound() {
  return (
    <div className="flex max-w-[560px] flex-col gap-3 rounded-[20px] border border-line bg-white p-6">
      <h1 className="font-display text-[28px] leading-tight">Not found</h1>
      <p className="text-[15px] text-ink-soft">This page or dish doesn’t exist. It may have been removed.</p>
      <Link href="/dashboard/menu" className={`self-start ${dashPrimary}`}>Go to the daily menu</Link>
    </div>
  );
}
