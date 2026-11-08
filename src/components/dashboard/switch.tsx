"use client";

/**
 * The one switch look (DESIGN.md switch-track-off / -on / switch-knob; spec-2.4 "Build follow-ups").
 * Off track is Field (3.46:1 on cream, knob 3.69:1 on it), on track is Teal deep. Only the knob moves
 * (`.switch-knob`, translateX 18 px in globals.css); the track colour changes at once. The state is
 * announced by role="switch" and aria-checked, and shown by the knob's position.
 *
 * With children, the button carries a visible label before the track; without, pass `label`, which
 * becomes the aria-label. `className` styles the button (size, padding, ring) for each place.
 */
export function Switch({
  checked,
  onChange,
  label,
  children,
  className = "",
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={children ? undefined : label}
      onClick={() => onChange(!checked)}
      className={`switch press flex touch-manipulation items-center rounded-full select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${className}`}
    >
      {children}
      <span aria-hidden="true" className={`switch-track flex h-[26px] w-11 shrink-0 items-center rounded-full p-[2px] ${checked ? "bg-teal-deep" : "bg-field"}`}>
        <span className="switch-knob size-[22px] rounded-full bg-paper shadow-[0_1px_2px_rgb(26_32_44/0.2)]" />
      </span>
    </button>
  );
}
