type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const PlusIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const MinusIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M5 12h14" /></svg>
);
export const BackIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M15 18l-6-6 6-6" /></svg>
);
export const ArrowIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const CheckIcon = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={3} className={className}><path d="m5 12 5 5 9-10" /></svg>
);
export const CalendarIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
);
export const ReceiptIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
);
export const ListIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
export const ExternalIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>
);
export const PhoneIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
);
