"use client";
import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  "aria-label"?: string;
  name?: string;
  value?: string;
  /** Ask before submitting, for actions that can't be undone. */
  confirm?: string;
  /** Disabled until the form is ready (as well as while it runs). */
  disabled?: boolean;
  /** Checked on tap; false stops the submit (nothing is sent). */
  onSubmitCheck?: () => boolean;
};

/** Submit button that locks while its form's server action runs, so a second tap can't resubmit. */
export function SubmitButton({ children, pendingLabel, className, confirm: question, disabled, onSubmitCheck, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={
        question || onSubmitCheck
          ? (e) => {
              if (onSubmitCheck && !onSubmitCheck()) e.preventDefault();
              else if (question && !window.confirm(question)) e.preventDefault();
            }
          : undefined
      }
      className={`touch-manipulation select-none ${className ?? ""} disabled:opacity-60 aria-busy:cursor-wait`}
      {...rest}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
