import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountIcon, ChartIcon, ClockIcon, ExternalIcon, PeopleIcon, QrIcon, SignOutIcon } from "@/components/icons";
import { can } from "@/lib/permissions";
import { NAV_TOUCH, roleLabel, shortName } from "@/components/dashboard/nav-shared";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { getStaff } from "@/lib/supabase/server";
import { signOut } from "../actions";

export const metadata = { title: "More" };

const ROW = `${NAV_TOUCH} flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-teal-deep focus-visible:-outline-offset-2 hover:bg-cream active:bg-cream`;

/** spec-2.2 "More page": a plain page, no sheet and no motion beyond press feedback. */
export default async function MorePage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  const owner = staff.role === "owner";
  // Tables moves here below 600 px whenever Settings takes its place in the tab bar.
  const tablesHere = can(staff, "close_early");

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="font-display text-[28px] leading-tight">More</h1>
        <p className="mt-1 text-[15px] text-ink-soft [overflow-wrap:anywhere]">
          {shortName(staff.name, staff.email)} · {roleLabel(staff.role)}
        </p>
      </div>

      <ul className="overflow-hidden rounded-[var(--r-md)] bg-paper shadow-[var(--shadow-card)]">
        {tablesHere && (
          <li className="border-b border-sand min-[600px]:hidden">
            <Link href="/dashboard/tables" className={ROW}>
              <QrIcon size={20} /> Tables
            </Link>
          </li>
        )}
        <li className="border-b border-sand">
          <a href="/" target="_blank" rel="noreferrer" className={ROW}>
            <ExternalIcon size={20} />
            <span className="flex flex-col">
              View live menu
              <span className="text-[13px] font-normal text-ink-soft">Opens a new tab</span>
            </span>
          </a>
        </li>
        {owner && (
          <li className="border-b border-sand lg:hidden">
            <Link href="/dashboard/team" className={ROW}>
              <PeopleIcon size={20} /> Team
            </Link>
          </li>
        )}
        <li>
          <Link href="/dashboard/account" className={ROW}>
            <AccountIcon size={20} /> Account &amp; password
          </Link>
        </li>
        {owner && (
          <li className="border-t border-sand lg:hidden">
            <Link href="/dashboard/reports" className={ROW}>
              <ChartIcon size={20} /> Reports
            </Link>
          </li>
        )}
        {owner && (
          <li className="border-t border-sand lg:hidden">
            <Link href="/dashboard/history" className={ROW}>
              <ClockIcon size={20} /> History
            </Link>
          </li>
        )}
      </ul>

      <form action={signOut} className="overflow-hidden rounded-[var(--r-md)] bg-paper shadow-[var(--shadow-card)]">
        <SubmitButton pendingLabel="Signing out…" className={`${ROW} text-coral-ink`}>
          <SignOutIcon size={20} /> Sign out
        </SubmitButton>
      </form>
    </div>
  );
}
