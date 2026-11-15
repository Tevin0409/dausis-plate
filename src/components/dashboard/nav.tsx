"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTableRequests } from "./table-requests-provider";
import {
  AccountIcon,
  CalendarIcon,
  ClockIcon,
  DishesIcon,
  ExternalIcon,
  MoreIcon,
  QrIcon,
  ReceiptIcon,
  SettingsIcon,
  SignOutIcon,
  StarIcon,
} from "@/components/icons";
import { signOut } from "@/app/dashboard/actions";
import { SubmitButton } from "./submit-button";
import { can, type Grant } from "@/lib/permissions";
import { NAV_TOUCH, roleLabel, shortName, type Role as Role0 } from "./nav-shared";

// spec-2.2 "Dashboard shell". One rail from 1024 px, one tab bar below it; CSS alone picks which shows.

type Role = Role0;
type Who = { role: Role; grants: readonly Grant[] };
type Item = {
  href: string;
  label: string;
  Icon: (p: { size?: number }) => React.ReactNode;
  also?: (path: string) => boolean;
  /** Who sees it; everyone when absent. */
  shows?: (who: Who) => boolean;
  /** Rail only: below 1024 px it is a row on More (History, spec-2.3). */
  railOnly?: boolean;
};

const ITEMS: Item[] = [
  { href: "/dashboard/orders", label: "Orders", Icon: ReceiptIcon },
  { href: "/dashboard/menu", label: "Menu", Icon: CalendarIcon },
  { href: "/dashboard/manage", label: "Dishes", Icon: DishesIcon, also: (p) => p.startsWith("/dashboard/dishes/") },
  { href: "/dashboard/tables", label: "Tables", Icon: QrIcon },
  // Staff with Close early see Settings for its card (spec-2.3); the other cards stay read-only.
  { href: "/dashboard/settings", label: "Settings", Icon: SettingsIcon, shows: (w) => can(w, "close_early") },
  { href: "/dashboard/ratings", label: "Ratings", Icon: StarIcon, shows: (w) => w.role === "owner", railOnly: true },
  { href: "/dashboard/history", label: "History", Icon: ClockIcon, shows: (w) => w.role === "owner", railOnly: true },
];

const visible = (who: Who) => ITEMS.filter((i) => !i.shows || i.shows(who));

const isOn = (path: string, item: Item) => path === item.href || path.startsWith(`${item.href}/`) || Boolean(item.also?.(path));

const FOCUS = "focus-visible:outline-2 focus-visible:outline-white focus-visible:-outline-offset-3";
const SELECTED = "bg-cream text-teal-deeper";
const UNSELECTED = "text-on-teal-soft hover:bg-teal-deeper hover:text-white";

/** The new-orders count as a badge; null means the count failed to load. */
function Badge({ count }: { count: number | null }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-[7px] left-[calc(50%+3px)] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blush px-[5px] text-[11.5px] leading-none font-bold text-coral-ink tabular-nums"
    >
      {count === null ? "!" : count > 99 ? "99+" : count}
    </span>
  );
}

function ordersLabel(count: number | null, requests: number) {
  const asking = requests === 1 ? "1 table request" : `${requests} table requests`;
  if (count === null) return requests > 0 ? `Orders, new order count failed, ${asking}` : "Orders, new order count failed";
  const parts = [count > 0 && `${count} new`, requests > 0 && asking].filter(Boolean);
  return parts.length ? `Orders, ${parts.join(", ")}` : undefined;
}

/** spec-2.9: the Orders badge counts new orders and open table requests, on every dashboard page. */
function useOrdersBadge(newOrders: number | null) {
  const requests = useTableRequests()?.count ?? 0;
  return { total: newOrders === null ? null : newOrders + requests, label: ordersLabel(newOrders, requests) };
}


type NavProps = { newOrders: number | null; role: Role; grants: readonly Grant[]; name: string | null; email: string | null };

export function DashboardRail({ newOrders, role, grants, name, email }: NavProps) {
  const path = usePathname();
  const badge = useOrdersBadge(newOrders);
  const items = visible({ role, grants });
  const row = `${NAV_TOUCH} ${FOCUS} flex w-20 flex-col items-center justify-center gap-1 rounded-[14px] text-[12.5px] font-semibold`;
  return (
    <aside className="sticky top-0 hidden h-dvh w-24 flex-none flex-col items-center gap-1 overflow-y-auto overscroll-contain bg-teal-deep px-2 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-[calc(12px+env(safe-area-inset-top,0px))] lg:flex print:hidden">
      <Link href="/dashboard" aria-label="Dausis Plate dashboard" className={`${FOCUS} mb-2 flex size-11 flex-none items-center justify-center rounded-full`}>
        <Image src="/brand/dausis-plate-icon.svg" alt="" width={44} height={44} />
      </Link>
      <nav aria-label="Dashboard" className="flex flex-col gap-1">
        {items.map((item) => {
          const on = isOn(path, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              aria-label={item.href === "/dashboard/orders" ? badge.label : undefined}
              className={`${row} h-16 [@media(max-height:800px)]:h-14 ${on ? SELECTED : UNSELECTED}`}
            >
              <span className="relative flex">
                <item.Icon size={22} />
                {item.href === "/dashboard/orders" && <Badge count={badge.total} />}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1 pt-4">
        <a href="/" target="_blank" rel="noreferrer" className={`${row} min-h-12 gap-0.5 py-1 text-center leading-tight ${UNSELECTED}`}>
          <ExternalIcon size={18} />
          <span>
            View live menu<span className="sr-only"> (opens a new tab)</span>
          </span>
        </a>
        <p className="w-20 px-1 py-2 text-center text-[12px] leading-tight text-on-teal-soft [overflow-wrap:anywhere]">
          <span title={shortName(name, email)} className="line-clamp-3 font-semibold text-white">{shortName(name, email)}</span>
          {roleLabel(role)}
        </p>
        <Link
          href="/dashboard/account"
          aria-current={path === "/dashboard/account" ? "page" : undefined}
          className={`${row} h-12 gap-0.5 ${path === "/dashboard/account" ? SELECTED : UNSELECTED}`}
        >
          <AccountIcon size={18} />
          Account
        </Link>
        <form action={signOut}>
          <SubmitButton pendingLabel="Signing out…" className={`${row} h-12 gap-0.5 ${UNSELECTED}`}>
            <SignOutIcon size={18} />
            Sign out
          </SubmitButton>
        </form>
      </div>
    </aside>
  );
}

export function DashboardTabBar({ newOrders, role, grants }: Pick<NavProps, "newOrders" | "role" | "grants">) {
  const path = usePathname();
  const badge = useOrdersBadge(newOrders);
  const items = visible({ role, grants }).filter((i) => !i.railOnly);
  // With Settings in the bar (the owner, or staff with Close early), the Tables tab moves into More
  // below 600 px, so More looks selected there, while aria-current stays on the (hidden) Tables tab.
  const owner = items.some((i) => i.href === "/dashboard/settings");
  const onTables = path.startsWith("/dashboard/tables");
  const moreOn = path === "/dashboard/more" || path === "/dashboard/account" || path.startsWith("/dashboard/history");
  const tab = `${NAV_TOUCH} ${FOCUS} flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[14px] text-[12px] font-semibold`;
  return (
    <nav
      aria-label="Dashboard"
      className="dash-tabbar sticky bottom-0 z-30 flex bg-teal-deep px-1.5 pb-[calc(4px+env(safe-area-inset-bottom,0px))] pt-1 lg:hidden print:hidden"
    >
      {items.map((item) => {
        const on = isOn(path, item);
        const movesToMore = owner && item.href === "/dashboard/tables";
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            aria-label={item.href === "/dashboard/orders" ? badge.label : undefined}
            className={`${tab} ${movesToMore ? "hidden min-[600px]:flex" : ""} ${on ? SELECTED : UNSELECTED}`}
          >
            <span className="relative flex">
              <item.Icon size={22} />
              {item.href === "/dashboard/orders" && <Badge count={badge.total} />}
            </span>
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/dashboard/more"
        aria-current={moreOn ? "page" : undefined}
        className={`${tab} ${moreOn ? SELECTED : owner && onTables ? `${UNSELECTED} max-[599px]:bg-cream max-[599px]:text-teal-deeper` : UNSELECTED}`}
      >
        <MoreIcon size={22} />
        More
      </Link>
    </nav>
  );
}
