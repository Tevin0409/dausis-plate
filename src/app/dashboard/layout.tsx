import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClosedEarlyStrip } from "@/components/dashboard/closed-early-strip";
import { DashboardRail, DashboardTabBar } from "@/components/dashboard/nav";
import { RefusalNoteProvider } from "@/components/dashboard/refusal-note";
import { SavedNote } from "@/components/dashboard/saved-note";
import { primary } from "@/components/ui-classes";
import { TableRequestsProvider } from "@/components/dashboard/table-requests-provider";
import { nairobiToday } from "@/lib/format";
import type { KitchenStatus } from "@/lib/kitchen";
import { getKitchen } from "@/lib/kitchen-server";
import { can } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { signOut } from "./actions";

// The top of every dashboard page is cream, so the status bar is too (customer pages keep teal).
export const viewport: Viewport = { themeColor: "#fbf7f1" };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    // spec-2.6 "Not on the team": also what a removed person sees on their next request.
    return (
      <AuthShell>
        <div className="flex flex-col gap-2">
          <h1 className="text-[17px] leading-snug text-ink">
            <b className="font-semibold [overflow-wrap:anywhere]">{user.email}</b> isn’t on the Dausis Plate team.
          </h1>
          <p className="text-[15px] text-ink-soft">If that’s a mistake, ask the owner to add this email.</p>
        </div>
        <form action={signOut}>
          <button type="submit" className={`${primary} w-full`}>
            Sign out
          </button>
        </form>
      </AuthShell>
    );
  }
  // A temporary password from the owner: Set your password first; the dashboard waits (Q5 A).
  if (staff.mustChangePassword) redirect("/account/set-password");

  const supabase = await createClient();
  const startOfDay = new Date(`${nairobiToday(new Date())}T00:00:00+03:00`).toISOString();
  const [{ count, error: countError }, requestCount, kitchen] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new"),
    // spec-2.9: open table requests today, for the Orders badge; the provider's 10 s poll keeps it current.
    supabase.from("table_requests").select("id", { count: "exact", head: true }).is("cleared_at", null).gte("created_at", startOfDay),
    readKitchenStatus(),
  ]);
  if (requestCount.error) console.error("[db] counting table requests failed:", requestCount.error.code ?? "", requestCount.error.message);
  if (countError) console.error("[db] counting new orders failed:", countError.code ?? "", countError.message);
  const newOrders = countError ? null : (count ?? 0);

  // spec-2.2 "Dashboard shell": a min-h-dvh column with the tab bar sticky at its foot below 1024 px,
  // a row with the sticky rail from 1024 px. Neither prints.
  return (
    <TableRequestsProvider initialCount={requestCount.error ? null : (requestCount.count ?? 0)}>
    <div className="dash flex min-h-dvh flex-col bg-cream lg:flex-row print:block print:bg-white">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-paper px-4 py-3 font-semibold text-teal-deeper focus:not-sr-only focus:fixed focus:left-3 focus:top-3 print:hidden"
      >
        Skip to content
      </a>
      <DashboardRail newOrders={newOrders} role={staff.role} grants={staff.grants} name={staff.name} email={staff.email} />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 pb-4 pt-[calc(16px+env(safe-area-inset-top,0px))] outline-none min-[600px]:px-5 min-[600px]:pb-5 min-[600px]:pt-[calc(20px+env(safe-area-inset-top,0px))] lg:px-7 lg:pb-7 lg:pt-[calc(28px+env(safe-area-inset-top,0px))] print:block print:p-0"
      >
        <ClosedEarlyStrip closedEarly={kitchen?.reason === "closed_early"} owner={can(staff, "close_early")} />
        <Suspense fallback={null}>
          <SavedNote />
        </Suspense>
        <RefusalNoteProvider>{children}</RefusalNoteProvider>
      </main>
      <DashboardTabBar newOrders={newOrders} role={staff.role} grants={staff.grants} />
    </div>
    </TableRequestsProvider>
  );
}

/** The kitchen status for the strip. A failed read just leaves the strip off; the screens still work. */
async function readKitchenStatus(): Promise<KitchenStatus | null> {
  try {
    return (await getKitchen()).status;
  } catch {
    return null;
  }
}
