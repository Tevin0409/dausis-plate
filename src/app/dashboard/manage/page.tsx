import Link from "next/link";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { PlusIcon } from "@/components/icons";
import { formatKes, nairobiToday } from "@/lib/format";
import { notFound } from "next/navigation";
import { regularOnSale } from "@/lib/kitchen";
import { ActionForm } from "@/components/dashboard/action-form";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/result";
import { deleteDish, removeFromRegulars, setRegularAvailable } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dishes" };

const CATEGORY = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" } as const;

export default async function ManagePage() {
  const staff = await getStaff();
  if (!staff) notFound();
  const owner = staff.role === "owner";
  const today = nairobiToday();
  const supabase = await createClient();
  const regularsResult = await supabase
    .from("dishes")
    .select("id, name, category, price_kes, unavailable_on")
    .eq("is_regular", true)
    .eq("archived", false)
    .order("category")
    .order("sort_order");
  const regulars = must(regularsResult, "regular dishes").map((d) => ({ ...d, onSale: regularOnSale(d.unavailable_on, today) }));
  const edits = can(staff, "dishes_prices");
  const everyday = can(staff, "everyday_menu");
  const actions = edits || everyday || owner;

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      {/* Sales moved to Reports (2.12); the owner gets a pointer, staff just the header. */}
      <header>
        <h1 className="font-display text-[34px]">Dishes</h1>
        <RefusalNote className="mt-1" />
        {owner && (
          <p className="mt-1 text-sm text-ink-soft">
            Today’s sales are in <Link href="/dashboard/reports" className="font-semibold text-teal-deep underline underline-offset-2">Reports →</Link>
          </p>
        )}
      </header>

      <section aria-label="Always on the menu" className="overflow-hidden rounded-[18px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-base font-bold">Always on the menu <span className="font-medium text-ink-soft">· {regulars.length} items</span></h2>
          {/* A new everyday dish is both jobs at once: adding a dish and putting it on the everyday menu. */}
          {edits && everyday && (
            <Link href="/dashboard/dishes/new?regular=1" className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-teal-deep px-4 text-sm font-bold text-white">
              <PlusIcon size={16} /> Add item
            </Link>
          )}
        </div>
        <div className="relative overflow-x-auto">
          <table className={`w-full border-collapse text-[15px] ${actions ? "min-w-[760px]" : "min-w-[560px]"}`}>
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[13px] text-ink-soft">
                <th scope="col" className="px-5 py-2.5 font-semibold">Item</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Price</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">On sale today</th>
                {actions && <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {regulars.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-5 py-2.5 font-semibold [overflow-wrap:anywhere]">{d.name}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{CATEGORY[d.category]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{formatKes(d.price_kes)}</td>
                  <td className="px-3 py-1.5">
                    <ActionForm action={setRegularAvailable} className="flex flex-col items-start gap-1">
                      <input type="hidden" name="dishId" value={d.id} />
                      <input type="hidden" name="available" value={d.onSale ? "false" : "true"} />
                      <SubmitButton
                        pendingLabel="Saving…"
                        aria-label={`${d.name}: ${d.onSale ? "on sale, tap to mark sold out" : "sold out, tap to put back on sale"}`}
                        className={`min-h-11 rounded-full px-3.5 text-sm font-semibold ${
                          d.onSale ? "bg-teal-tint text-teal-deeper" : "bg-blush text-coral-ink"
                        }`}
                      >
                        {d.onSale ? "On sale" : "Sold out"}
                      </SubmitButton>
                      {/* About the dish, so it says tomorrow whether or not tomorrow is open (spec-2.2). */}
                      {!d.onSale && <span className="text-[13px] text-ink-soft">Back on sale tomorrow.</span>}
                    </ActionForm>
                  </td>
                  {actions && (
                    <td className="px-5 py-1.5 text-right">
                      <div className="flex items-start justify-end gap-1.5">
                        {edits && (
                          <Link href={`/dashboard/dishes/${d.id}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-line-deep px-3.5 text-sm font-semibold text-teal-deep">
                            Edit
                          </Link>
                        )}
                        {everyday && (
                          <ActionForm action={removeFromRegulars} className="flex flex-col items-end gap-1">
                            <input type="hidden" name="dishId" value={d.id} />
                            <SubmitButton pendingLabel="Saving…" aria-label={`Take ${d.name} off the everyday menu`} className="min-h-10 whitespace-nowrap rounded-[10px] border border-line-deep bg-white px-3 text-sm font-semibold text-ink-soft">
                              Take off menu
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {owner && (
                          <ActionForm action={deleteDish} className="flex flex-col items-end gap-1">
                            <input type="hidden" name="dishId" value={d.id} />
                            <SubmitButton
                              confirm={`Delete ${d.name}? It will disappear from the menu and the dish library.`}
                              pendingLabel="Deleting…"
                              aria-label={`Delete ${d.name}`}
                              className="min-h-10 rounded-[10px] border border-line-deep bg-white px-3 text-sm font-semibold text-coral-ink"
                            >
                              Delete
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {!everyday && <p className="text-sm text-ink-soft">{OWNER_ONLY.everyday_menu}</p>}
    </div>
  );
}
