import Image from "next/image";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard/nav";
import { createClient, getStaff } from "@/lib/supabase/server";
import { signOut } from "./actions";

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

  const { count } = await (await createClient())
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  return (
    <div className="flex min-h-dvh flex-wrap items-stretch bg-mist print:block print:bg-white">
      <aside className="print:hidden flex max-w-full flex-[1_1_220px] flex-col gap-1 border-r border-line bg-white px-4 py-6">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <Image src="/brand/dausis-plate-icon.svg" alt="" width={36} height={36} />
          <span className="font-display text-xl">Dausis Plate</span>
        </div>
        <DashboardNav newOrders={count ?? 0} />
        <form action={signOut} className="mt-auto px-3 pt-6">
          <p className="truncate text-[13px] text-ink-soft">{staff.name ?? staff.email}</p>
          <button className="mt-1 text-sm font-semibold text-teal-deep">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-[999_1_560px] px-4 py-7 sm:px-8 print:p-0">{children}</main>
    </div>
  );
}
