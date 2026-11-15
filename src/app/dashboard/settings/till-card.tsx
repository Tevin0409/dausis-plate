"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { saveTill } from "./actions";
import { btnPrimary, btnQuiet, errorText, field, hint, tile, tileHeading } from "./ui";

const FORMAT = "A till number is 5 to 10 digits, with no spaces.";

/** spec-2.2 "M-Pesa till number": its own save with a confirm step, since a wrong number sends money elsewhere. */
export function TillCard({ initial }: { initial: string | null }) {
  const [saved, setSaved] = useState(initial ?? "");
  const [value, setValue] = useState(initial ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"back" | "field" | null>(null);

  useEffect(() => {
    if (focusNext.current === "back") backRef.current?.focus();
    if (focusNext.current === "field") inputRef.current?.focus();
    focusNext.current = null;
  });

  const trimmed = value.trim();
  const changed = trimmed !== saved;

  function ask(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (trimmed && !/^[0-9]{5,10}$/.test(trimmed)) {
      setError(FORMAT);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setConfirming(true);
    focusNext.current = "back";
  }

  function back() {
    setConfirming(false);
    focusNext.current = "field";
  }

  function save() {
    start(async () => {
      const res = await saveTill(trimmed).catch(() => null);
      setConfirming(false);
      focusNext.current = "field";
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Couldn’t save. The till number hasn’t changed. Try again.");
        return;
      }
      setSaved(trimmed);
      setValue(trimmed);
      setDone(true);
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        M-Pesa till number
      </h2>
      <p id={`${id}-hint`} className={`${hint} mt-1`}>
        Customers see this on their order page.
      </p>

      <form onSubmit={ask} noValidate className="mt-4 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
          Till number
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={10}
            value={value}
            readOnly={confirming}
            onChange={(e) => (setError(null), setDone(false), setValue(e.target.value.replace(/\s/g, "")))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err ${id}-hint` : `${id}-hint`}
            className={`${field} tabular-nums tracking-wide`}
          />
        </label>
        {!confirming && (
          <button type="submit" disabled={!changed || pending} className={`${btnPrimary} min-[480px]:mt-[22px]`}>
            Save
          </button>
        )}
      </form>

      {error && (
        <p key={error} id={`${id}-err`} role="alert" className={`${errorText} mt-2`}>
          {error}
        </p>
      )}

      <div role="status" aria-live="polite">
        {done && !changed && <p className="note-in mt-2 text-[15px] font-semibold text-teal-deeper">Saved. Customers see it now.</p>}
      </div>

      {confirming && (
        <div role="group" aria-labelledby={`${id}-c`} className="note-in mt-4 rounded-[var(--r-md)] bg-cream p-4">
          <p id={`${id}-c`} className="text-[15px] leading-snug">
            {trimmed ? (
              <>
                Customers will pay to till <strong className="tabular-nums">{trimmed}</strong>. A wrong number sends their money to someone else.
              </>
            ) : (
              "Customers won’t see a till number."
            )}
          </p>
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-3 min-[480px]:flex">
            <button ref={backRef} type="button" onClick={back} disabled={pending} className={btnQuiet}>
              Go back
            </button>
            <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : trimmed ? "Save till number" : "Remove it"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
