"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-teal-deep px-5 text-sm font-bold text-white">
      {label}
    </button>
  );
}
