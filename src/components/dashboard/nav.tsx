"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, ExternalIcon, ListIcon, ReceiptIcon } from "@/components/icons";

const items = [
  { href: "/dashboard/menu", label: "Daily menu", Icon: CalendarIcon },
  { href: "/dashboard/orders", label: "Orders", Icon: ReceiptIcon },
  { href: "/dashboard/manage", label: "Menu & sales", Icon: ListIcon },
] as const;

export function DashboardNav({ newOrders }: { newOrders: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1">
      {items.map(({ href, label, Icon }) => {
        const active = path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] ${
              active ? "bg-teal-tint font-bold text-teal-deeper" : "font-medium text-ink"
            }`}
          >
            <Icon />
            {label}
            {href === "/dashboard/orders" && newOrders > 0 && (
              <span className="ml-auto rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-ink">{newOrders} new</span>
            )}
          </Link>
        );
      })}
      <Link href="/" target="_blank" className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] font-medium">
        <ExternalIcon />
        View live menu
      </Link>
    </nav>
  );
}
