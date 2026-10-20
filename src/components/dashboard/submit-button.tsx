"use client";
import { useFormStatus } from "react-dom";

type Props = { children: React.ReactNode; pendingLabel?: string; className?: string; "aria-label"?: string };

/** Submit button that locks while its form's server action runs, so a second tap can't resubmit. */
export function SubmitButton({ children, pendingLabel, className, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={`${className ?? ""} disabled:cursor-wait disabled:opacity-60`} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
