"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, ShareIcon } from "@/components/icons";

const pill =
  "press inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full bg-paper px-4 text-[15px] font-semibold text-teal-deep ring-1 ring-sand-deep touch-manipulation";

/** "Save this link" (spec-2.8b §1.4): until WhatsApp, the way back to a waiting order. */
export function SaveLink({ code }: { code: string }) {
  const [url, setUrl] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [said, setSaid] = useState("");
  const box = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The page's own address, so it is whatever host the customer opened.
  useEffect(() => {
    setUrl(window.location.origin + window.location.pathname);
    setCanShare(typeof navigator.share === "function");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setManual(false);
      setCopied(true);
      setSaid("Link copied.");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: select the link so the customer can copy it themselves.
      const el = box.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setManual(true);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `Dausis Plate order ${code}`, url });
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  return (
    <section aria-labelledby="save-heading" className="mx-5 mt-5 rounded-[var(--r-lg)] bg-paper p-[18px] shadow-[var(--shadow-card)]">
      <h2 id="save-heading" className="font-display text-[21px] leading-tight">Save this link</h2>
      <p className="mt-1 text-sm text-ink-soft">Bookmark it, or send it to yourself, to come back to this order.</p>
      <p
        ref={box}
        title={url}
        className="mt-3 select-all truncate rounded-[var(--r-sm)] bg-sand px-3 py-2.5 font-mono text-sm tabular-nums text-ink"
      >
        {url || " "}
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" onClick={copy} disabled={!url} className={pill}>
          <span className="relative inline-grid size-[18px] place-items-center">
            <CopyIcon className={`copy-swap col-start-1 row-start-1 ${copied ? "opacity-0" : "opacity-100"}`} />
            <CheckIcon className={`copy-swap copy-check col-start-1 row-start-1 ${copied ? "opacity-100" : "copy-off opacity-0"}`} />
          </span>
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare && (
          <button type="button" onClick={share} className={pill}>
            <ShareIcon />
            Share
          </button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">{said}</p>
      {manual && (
        <p role="status" className="note-in mt-2 text-[13px] font-semibold text-ink">
          Press and hold the link to copy it.
        </p>
      )}
      <p className="mt-3 text-[13px] text-ink-soft">
        Lost it?{" "}
        <Link href="/order/find" className="py-[14px] font-semibold text-teal-deep underline underline-offset-2">
          Find your order
        </Link>{" "}
        with your phone number and code <span className="whitespace-nowrap tabular-nums">{code}</span>.
      </p>
    </section>
  );
}
