"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/app/dashboard/action-result";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * A form for a dashboard server action. The action returns `{ error }` on failure
 * and this shows it under the controls; a later success clears it.
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
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p role="alert" className={errorClassName}>
          {state.error}
        </p>
      )}
    </form>
  );
}
