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
export const QrIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></svg>
);
export const PhoneIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
);
export const SettingsIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);
export const ClockIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const ChartIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M4 20h16M7 20v-6M12 20V6M17 20v-10" /></svg>
);
export const DownloadIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" /></svg>
);
export const MoreIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.6} className={className}><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
);
export const AccountIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const PeopleIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5" /><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .7 3.3 2.4 4 5.2" /></svg>
);
export const SignOutIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M14 4H5v16h9M10 12h10M17 8l4 4-4 4" /></svg>
);
export const DishesIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M3 13h18a9 9 0 0 1-18 0zM12 4v2M8 6.5l.8 1.6M16 6.5l-.8 1.6" /></svg>
);
export const BikeIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-7h5l3 7M10 9 8.5 6H6M15 9l1.5-3H19" /></svg>
);
export const BagIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const UpIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M6 15l6-6 6 6" /></svg>
);
export const DownIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M6 9l6 6 6-6" /></svg>
);
export const CloseIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const TableIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M3 9h18M5 9v11M19 9v11M8 9l1-4h6l1 4" /></svg>
);
export const TrashIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
);
export const InfoIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></svg>
);
export const PinIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const CopyIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></svg>
);
export const ShareIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M12 15V4M8 8l4-4 4 4M6 12v6.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V12" /></svg>
);
export const SearchIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const BellIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
);
export const StarIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} strokeWidth={2} className={className}><path d="M12 3.5l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.8l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z" /></svg>
);
