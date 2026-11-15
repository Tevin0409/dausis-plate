"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { KITCHEN_PHONE_ERROR, formatKenyanPhone, normaliseKitchenPhone } from "@/lib/kitchen-phone";
import { saveKitchenPhone } from "./actions";
import { btnPrimary, errorText, field, hint, tile, tileHeading } from "./ui";

/**
 * spec-2.6 "Settings: phone card": the kitchen phone customers can call from their order page.
 * Its own Save, as the till number; no confirm step (a wrong number is shown, not paid to).
 * The field shows the saved number as 0712 345 678; what's typed is normalised on save.
 */
export function PhoneCard({ initial }: { initial: string | null }) {
  const [saved, setSaved] = useState(initial ?? "");
  const [value, setValue] = useState(initial ? formatKenyanPhone(initial) : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const normalised = normaliseKitchenPhone(value);
  const changed = normalised === null || normalised !== saved;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (normalised === null) {
      setError(KITCHEN_PHONE_ERROR);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      const res = await saveKitchenPhone(value).catch(() => null);
      if (!res?.ok) {
        const line = res && !res.ok ? res.error : "Couldn’t save. The kitchen phone hasn’t changed. Try again.";
        setError(line);
        if (res && !res.ok && res.stale) setTimeout(() => reportRefusal(line), 3000);
        inputRef.current?.focus();
        return;
      }
      const now = res.note ?? "";
      setSaved(now);
      setValue(now ? formatKenyanPhone(now) : "");
      setDone(true);
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        Kitchen phone
      </h2>
      <p id={`${id}-hint`} className={`${hint} mt-1`}>
        Customers see this on their order page, to call you about an order.
      </p>

      <form onSubmit={save} noValidate className="mt-4 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
          Phone number
          <input
            ref={inputRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="done"
            maxLength={24}
            placeholder="0712 345 678"
            value={value}
            onChange={(e) => (setError(null), setDone(false), setValue(e.target.value))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err ${id}-hint` : `${id}-hint`}
            className={`${field} tabular-nums`}
          />
        </label>
        <button type="submit" disabled={!changed || pending} className={`${btnPrimary} min-[480px]:mt-[22px]`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {error && (
        <p key={error} id={`${id}-err`} role="alert" className={`${errorText} mt-2`}>
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {done && !changed && (
          <p className="note-in mt-2 text-[15px] font-semibold text-teal-deeper">{saved ? "Saved. Customers see it on their order page." : "Removed. Customers see no phone."}</p>
        )}
      </div>
    </section>
  );
}
