"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageNote } from "@/components/ui-parts";

const NOTES: Record<string, string> = { password: "Password saved." };

/**
 * A note that arrives with the page after a step on another page, e.g. Set your password →
 * the board with "Password saved." (`?saved=password`). The flag leaves the address at once, so a
 * reload doesn't repeat it, and the note goes when the person moves to another page.
 */
export function SavedNote() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [note] = useState(() => {
    const text = NOTES[params.get("saved") ?? ""];
    return text ? { text, on: pathname } : null;
  });

  useEffect(() => {
    if (!note) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [note]);

  if (!note || note.on !== pathname) return null;
  return (
    <div className="mb-4 print:hidden">
      <PageNote text={note.text} />
    </div>
  );
}
