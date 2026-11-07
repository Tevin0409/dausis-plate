"use client";
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";

/**
 * "M-Pesa till: 123456 · Copy" under the payment chip (spec-2.2 "Order status: the till line").
 * The number stays selectable; Copy is hidden where the clipboard isn't available.
 */
export function TillLine({ till }: { till: string }) {
  const [canCopy, setCanCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCanCopy(typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText) && window.isSecureContext), []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(till);
      setCopied(true);
    } catch {
      // Refused (permissions, an old browser): the number is still there to select.
      setCanCopy(false);
    }
  }

  return (
    <p className="-mt-1 flex flex-wrap items-center justify-end gap-x-2 self-end text-right text-[15px] text-[#d7f0ee]">
      <span className="whitespace-nowrap">
        M-Pesa till: <b className="font-bold text-white tabular-nums select-all">{till}</b>
      </span>
      {canCopy && (
        <button
          type="button"
          onClick={copy}
          className="press -my-1 inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center gap-1.5 rounded-full px-3 font-semibold text-white underline-offset-2 select-none [-webkit-tap-highlight-color:transparent] active:bg-white/15"
        >
          {/* The key swaps the label so it fades in with 6 px, as the add button's does. */}
          <span key={copied ? "copied" : "copy"} className="note-in inline-flex items-center gap-1.5">
            {copied ? (
              <>
                <CheckIcon /> Copied
              </>
            ) : (
              "Copy"
            )}
          </span>
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Till number copied" : ""}
      </span>
    </p>
  );
}
