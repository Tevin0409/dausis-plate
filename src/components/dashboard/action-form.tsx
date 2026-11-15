"use client";
import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/app/dashboard/action-result";
import { useReportRefusal } from "./refusal-note";

/** Long enough to read the refusal line before the refresh takes the control away. */
const REFRESH_AFTER_REFUSAL_MS = 3000;

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * A form for a dashboard server action. The action returns `{ error }` on failure
 * and this shows it under the controls, keeping what was typed; a later success clears it.
 * When the database refused the action (`stale`: the page showed a control the person may no longer
 * use, spec-2.3), the line shows first and the page refreshes a moment later, so they can read why
 * before the control goes. The line then moves to the note under the page heading (refusal-note.tsx).
 */
export function ActionForm({
  action,
  className,
  errorClassName = "text-[13px] font-semibold text-coral-ink",
  children,
}: {
  action: Action;
  className?: string;
  errorClassName?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const reportRefusal = useReportRefusal();

  useEffect(() => {
    if (!state?.stale) return;
    const line = state.error;
    const t = setTimeout(() => reportRefusal(line), REFRESH_AFTER_REFUSAL_MS);
    return () => clearTimeout(t);
  }, [state, reportRefusal]);

  // React resets a form when its action finishes, whatever the result. Cancel that after a failure
  // so the person keeps what they typed; a success still resets. This is a native listener because
  // React's onReset doesn't fire for this reset. By then React has written the result to the form.
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const keepAfterFailure = (e: Event) => {
      if (el.hasAttribute("data-failed")) e.preventDefault();
    };
    el.addEventListener("reset", keepAfterFailure);
    return () => el.removeEventListener("reset", keepAfterFailure);
  }, []);

  return (
    <form ref={form} action={formAction} data-failed={state?.error ? "" : undefined} className={className}>
      {children}
      {state?.error && (
        <p key={state.error} role="alert" className={`note-in ${errorClassName}`}>
          {state.error}
        </p>
      )}
    </form>
  );
}
