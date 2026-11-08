import { notFound } from "next/navigation";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { TeamView } from "@/components/dashboard/team/team-view";
import type { Grant } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { must } from "@/lib/supabase/result";
import { createClient, getStaff } from "@/lib/supabase/server";
import { TEAM, byTeamOrder, type Person } from "@/lib/team";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

/** Email and last sign-in for each account, server only: the admin client and metadata never reach the browser. */
async function accounts() {
  const admin = createAdminClient();
  const out = new Map<string, { email: string; lastSignIn: string | null }>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error("[db] loading team accounts failed:", error.code ?? "", error.message);
      throw new Error("Couldn't load the team");
    }
    for (const u of data.users) out.set(u.id, { email: u.email ?? "", lastSignIn: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }
  return out;
}

/** spec-2.6 "Team (`/dashboard/team`, owner)". */
export default async function TeamPage() {
  const staff = await getStaff();
  if (!staff) notFound();
  if (staff.role !== "owner") {
    return (
      <div className="flex w-full max-w-[720px] flex-col gap-2">
        <h1 className="font-display text-[34px] leading-tight">Team</h1>
        <p className="text-[15px] text-ink-soft">{TEAM.ownersOnly}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [rows, grants, users] = await Promise.all([
    supabase.from("staff").select("user_id, role, display_name, invited_at").then((r) => must(r, "team")),
    supabase.from("staff_grants").select("user_id, job").then((r) => must(r, "team grants")),
    accounts(),
  ]);
  const jobs = new Map<string, Grant[]>();
  for (const g of grants) jobs.set(g.user_id, [...(jobs.get(g.user_id) ?? []), g.job]);

  const people: Person[] = rows
    .map((r) => {
      const u = users.get(r.user_id);
      const email = u?.email ?? "";
      return {
        id: r.user_id,
        name: r.display_name?.trim() || email.split("@")[0] || "Someone",
        email,
        role: r.role,
        invited: r.invited_at !== null,
        lastSignIn: u?.lastSignIn ?? null,
        grants: jobs.get(r.user_id) ?? [],
        you: r.user_id === staff.id,
      };
    })
    .sort(byTeamOrder);

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 tabIndex={-1} className="font-display text-[34px] leading-tight outline-none">
          Team
        </h1>
        <p className="text-[15px] text-ink-soft">{TEAM.intro}</p>
        <RefusalNote className="mt-1" />
      </header>
      <TeamView people={people} />
    </div>
  );
}
