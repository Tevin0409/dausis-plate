"use client";
import { useId, useRef, useState, useTransition } from "react";
import { googleLinkProblem } from "@/lib/ratings";
import { saveGoogleReviewUrl } from "./actions";
import { btnPrimary, btnQuiet, errorText, field, hint, tile, tileHeading } from "./ui";

/** spec-2.10 "Settings: Google review link". Until it's set, customers see no Google button at all. */
export function GoogleReviewCard({ initial }: { initial: string | null }) {
  const [saved, setSaved] = useState(initial ?? "");
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  const changed = trimmed !== saved;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    const local = googleLinkProblem(trimmed);
    if (local) {
      setError(local);
      input.current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      const res = await saveGoogleReviewUrl(trimmed).catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Couldn’t save. The link hasn’t changed. Try again.");
        input.current?.focus();
        return;
      }
      setSaved(res.url ?? "");
      setValue(res.url ?? "");
      setDone(true);
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        Google review link
      </h2>
      <p id={`${id}-hint`} className={`${hint} mt-1`}>
        From your Google Business Profile: Ask for reviews → copy the link. Customers see ‘Review on Google’ after every order.
      </p>

      <form onSubmit={save} noValidate className="mt-4 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
          Link
          <input
            ref={input}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://g.page/r/…"
            value={value}
            onChange={(e) => (setError(null), setDone(false), setValue(e.target.value))}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${error ? `${id}-err ` : ""}${id}-hint${saved ? "" : ` ${id}-unset`}`}
            className={field}
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
          <p className="note-in mt-2 text-[15px] font-semibold text-teal-deeper">
            {saved ? "Saved. Customers see it now." : "Removed. Customers won’t see a Google button."}
          </p>
        )}
      </div>

      {!saved && !done && (
        <p id={`${id}-unset`} className="mt-3 rounded-[var(--r-md)] bg-cream px-4 py-3 text-[14px] text-ink-soft">
          Not set yet. Customers won’t see a Google button until you add it.
        </p>
      )}
      {saved && !changed && (
        <a href={saved} target="_blank" rel="noopener noreferrer" className={`${btnQuiet} mt-3 min-h-11 text-[15px]`}>
          Test the link<span className="sr-only"> (opens Google)</span>
        </a>
      )}
    </section>
  );
}
