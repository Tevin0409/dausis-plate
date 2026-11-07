"use client";
import { useRouter } from "next/navigation";
import type { Area } from "@/lib/history";

/** "Everyone", or one person who appears in the record. It goes in the URL, so back and refresh keep it. */
export function WhoSelect({ people, who, area }: { people: { id: string; label: string }[]; who: string | null; area: Area | null }) {
  const router = useRouter();
  return (
    <label className="flex w-full min-w-0 items-center min-[480px]:w-auto">
      <span className="sr-only">Person</span>
      <select
        value={who ?? ""}
        onChange={(e) => {
          const q = new URLSearchParams();
          if (area) q.set("area", area);
          if (e.target.value) q.set("who", e.target.value);
          const s = q.toString();
          router.push(s ? `/dashboard/history?${s}` : "/dashboard/history");
        }}
        // 16 px, so iOS doesn't zoom into it.
        className="min-h-11 w-full min-w-0 truncate rounded-full min-[480px]:w-auto min-[480px]:max-w-64 border border-line-deep bg-paper pl-4 pr-9 text-base font-semibold text-ink touch-manipulation"
      >
        <option value="">Everyone</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
