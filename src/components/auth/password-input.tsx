"use client";
import { useState } from "react";
import { ctl, field } from "@/components/ui-classes";

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  describedBy?: string;
  enterKeyHint?: "go" | "done" | "next";
};

/** A password field with a 44 px Show toggle (spec-2.6 Sign in). Shown or hidden changes at once. */
export function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, enterKeyHint = "done" }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint={enterKeyHint}
        maxLength={200}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${field} pr-[72px]`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-controls={id}
        aria-label={shown ? "Hide password" : "Show password"}
        className={`${ctl} absolute inset-y-0 right-0.5 my-auto flex h-11 min-w-11 items-center justify-center rounded-[var(--r-sm)] px-3 text-[14px] font-semibold text-teal-deep`}
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
