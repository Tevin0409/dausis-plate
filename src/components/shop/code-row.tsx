"use client";
import { useEffect, useRef, useState } from "react";
import { TagIcon } from "@/components/icons";
import { CODE_UNREACHABLE, codeHeldNote } from "@/lib/discount-words";
import { formatKes } from "@/lib/format";
import { CODE_MAX } from "@/lib/promos";
import { useCart } from "./cart-provider";
import { useKitchen } from "./kitchen-provider";

const quiet =
  "press inline-flex min-h-11 select-none items-center gap-2 rounded-full px-2 -ml-2 text-[15px] font-semibold text-teal-deep touch-manipulation";

/** A code saved with the cart, waiting for its first check. */
const pending = (c: { check: { ok: boolean; reason: unknown } }) => !c.check.ok && c.check.reason === null;

/**
 * The cart's code row (spec-2.11 "Customer: cart — code"), under the lines and above the summary.
 * "Have a code?" opens the field; an applied code is a teal chip, or amber when it stops working.
 */
export function CodeRow({ className = "" }: { className?: string }) {
  const { code, applyCode, removeCode, discountKes, foodKes, codeFresh } = useCart();
  const { open } = useKitchen();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  if (code) {
    const waiting = pending(code);
    const works = code.check.ok;
    return (
      <div className={className}>
        <div
          className={`${codeFresh ? "code-in" : ""} flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--r-md)] py-1.5 pl-3.5 pr-1.5 text-[15px] ${
            works || waiting ? "bg-teal-tint" : "bg-amber-tint"
          }`}
        >
          <TagIcon size={17} className={`flex-none ${works || waiting ? "text-teal-deep" : "text-amber-ink"}`} />
          <span className="min-w-0 flex-1 basis-24 [overflow-wrap:anywhere]">
            <strong className="font-bold">{code.code}</strong>
            {works && code.check.label && <span className="text-ink-soft"> · {code.check.label}</span>}
            {!works && !waiting && <span className="block text-[14px] font-semibold text-amber-ink">{codeHeldNote(code.check, foodKes)}</span>}
            {works && !open && <span className="block text-[13px] text-ink-soft">Checked again when you order.</span>}
          </span>
          <span className="ml-auto flex flex-none items-center gap-1">
            {works && <span className="font-bold tabular-nums text-teal-deep">−{formatKes(discountKes)}</span>}
            <button
              type="button"
              onClick={() => {
                removeCode();
                setText("");
                setEditing(false);
              }}
              className="press min-h-11 select-none rounded-full px-3 text-sm font-semibold text-teal-deep touch-manipulation"
            >
              Remove<span className="sr-only"> code {code.code}</span>
            </button>
          </span>
        </div>
        {code.unreachable && (
          <p role="alert" className="fade-in mt-1.5 text-[14px] text-coral-ink">
            {CODE_UNREACHABLE}
          </p>
        )}
      </div>
    );
  }

  if (!editing)
    return (
      <div className={className}>
        <button type="button" onClick={() => setEditing(true)} className={quiet}>
          <TagIcon size={17} />
          Have a code?
        </button>
      </div>
    );

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await applyCode(text);
    setBusy(false);
    if (r.ok) setEditing(false);
    else setError(r.error);
  };

  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
        className="flex flex-col gap-1.5"
      >
        <label htmlFor="discount-code" className="text-[15px] font-semibold">
          Discount code
        </label>
        <div className="flex gap-2">
          <input
            ref={field}
            id="discount-code"
            name="discount-code"
            value={text}
            onChange={(e) => setText(e.target.value.toUpperCase())}
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center", behavior: "auto" })}
            maxLength={CODE_MAX}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="go"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "discount-code-error" : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-[var(--r-md)] border-[1.5px] border-field bg-paper px-3.5 text-base uppercase tracking-wide focus:border-teal-deep focus:outline-none focus:ring-[3px] focus:ring-teal/30"
          />
          <button
            type="submit"
            disabled={busy || text.trim() === ""}
            className="press min-h-12 w-24 flex-none select-none rounded-full bg-paper text-[15px] font-semibold text-teal-deep ring-1 ring-teal-deep touch-manipulation disabled:text-ink-soft disabled:ring-sand-deep"
          >
            {busy ? "Checking…" : "Apply"}
          </button>
        </div>
        {error && (
          <p id="discount-code-error" role="alert" className="fade-in text-[14px] text-coral-ink">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

/** The summary's Discount line: deeper teal, only while the code works. */
export function DiscountLine({ className = "" }: { className?: string }) {
  const { code, discountKes, codeFresh } = useCart();
  if (!code?.check.ok || discountKes <= 0) return null;
  return (
    <div className={`${codeFresh ? "code-in" : ""} flex justify-between gap-3 text-teal-deep ${className}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">Discount ({code.code})</span>
      <span className="flex-none font-semibold tabular-nums">−{formatKes(discountKes)}</span>
    </div>
  );
}
