import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { ClosedEarlyStrip } from "@/components/dashboard/closed-early-strip";
import { DashboardRail, DashboardTabBar } from "@/components/dashboard/nav";
import { RefusalNoteProvider } from "@/components/dashboard/refusal-note";
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
    return (
      <main className="flex min-h-dvh items-center justify-center bg-mist px-4">
        <div className="max-w-sm rounded-3xl border border-line bg-white p-7">
          <h1 className="font-display text-2xl">Not on the staff list yet</h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            {user.email} is signed in but hasn’t been added as staff. Ask the owner to add you.
          </p>
          <form action={signOut} className="mt-4">
            <button className="font-semibold text-teal-deep">Sign out</button>
          </form>
        </div>
      </main>
    );
  }

  const [{ count, error: countError }, kitchen] = await Promise.all([
    (await createClient()).from("orders").select("id", { count: "exact", head: true }).eq("status", "new"),
    readKitchenStatus(),
  ]);
  if (countError) console.error("[db] counting new orders failed:", countError.code ?? "", countError.message);
  const newOrders = countError ? null : (count ?? 0);

  // spec-2.2 "Dashboard shell": a min-h-dvh column with the tab bar sticky at its foot below 1024 px,
  // a row with the sticky rail from 1024 px. Neither prints.
  return (
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
        <RefusalNoteProvider>{children}</RefusalNoteProvider>
      </main>
      <DashboardTabBar newOrders={newOrders} role={staff.role} grants={staff.grants} />
    </div>
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
