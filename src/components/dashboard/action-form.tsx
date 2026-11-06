"use client";
import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/app/dashboard/action-result";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * A form for a dashboard server action. The action returns `{ error }` on failure
 * and this shows it under the controls, keeping what was typed; a later success clears it.
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
        <p role="alert" className={errorClassName}>
          {state.error}
        </p>
      )}
    </form>
  );
}
