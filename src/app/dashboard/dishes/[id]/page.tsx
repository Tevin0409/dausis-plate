import Link from "next/link";
import { RefusalNote } from "@/components/dashboard/refusal-note";
import { notFound } from "next/navigation";
import { PhotoUpload } from "@/components/dashboard/photo-upload";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { dayLabel, formatKes } from "@/lib/format";
import { ActionForm } from "@/components/dashboard/action-form";
import { can, OWNER_ONLY } from "@/lib/permissions";
import { createClient, getStaff } from "@/lib/supabase/server";
import { isUuid, must } from "@/lib/supabase/result";
import { deleteDish, saveDish, setEverydayMenu } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string; regular?: string }> };

const field = "min-h-12 rounded-xl border border-line-deep px-3.5 text-base font-medium";
const label = "flex flex-col gap-1.5 text-sm font-semibold";
const CATEGORY = { mains: "Mains", sides: "Sides", breakfast: "Breakfast", drinks: "Drinks" } as const;

export default async function DishEditorPage({ params, searchParams }: Props) {
  const [{ id }, { day, regular }, staff] = await Promise.all([params, searchParams, getStaff()]);
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) notFound();
  if (!staff) notFound();
  const edits = can(staff, "dishes_prices");
  const everyday = can(staff, "everyday_menu");
  // A new dish is the Dishes and prices job; without it there's nothing to show.
  if (isNew && !edits) return <ReadOnlyNote back={regular === "1" ? "/dashboard/manage" : "/dashboard/menu"} />;
  const supabase = await createClient();
  const query = supabase.from("dishes").select("id, name, description, price_kes, category, photo_url, is_regular").eq("id", id).maybeSingle();
  const dish = isNew ? null : must(await query, "the dish");
  if (!isNew && !dish) notFound();

  const planDay = isNew && day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const isRegular = dish?.is_regular ?? (regular === "1" && everyday);

  // 3B: without Dishes and prices, words, photo and price are read-only too (spec-2.3).
  if (dish && !edits) {
    return (
      <div className="flex max-w-[640px] flex-col gap-5">
        <div>
          <Link href={isRegular ? "/dashboard/manage" : "/dashboard/menu"} className="text-sm font-semibold text-teal-deep">← Back</Link>
          <h1 className="mt-2 font-display text-[34px] leading-tight [overflow-wrap:anywhere]">{dish.name}</h1>
          <RefusalNote className="mt-1" />
          <p className="mt-1 text-sm text-ink-soft">{OWNER_ONLY.dishes_prices}</p>
        </div>
        <section className="flex flex-col gap-[18px] rounded-[20px] border border-line bg-white p-6">
          {dish.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- same R2 URL the editor's preview shows
            <img src={dish.photo_url} alt={`Photo of ${dish.name}`} className="aspect-[4/3] w-full rounded-2xl object-cover" />
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-[18px] text-[15px]">
            <div className="col-span-2 flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Short description</dt>
              <dd className="[overflow-wrap:anywhere]">{dish.description || "No description."}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Price</dt>
              <dd className="font-semibold tabular-nums">{formatKes(dish.price_kes)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-semibold text-ink-soft">Category</dt>
              <dd className="font-semibold">{CATEGORY[dish.category]}</dd>
            </div>
          </dl>
          {everyday ? (
            <ActionForm action={setEverydayMenu} className="flex flex-col items-start gap-2 border-t border-line pt-[18px]">
              <input type="hidden" name="dishId" value={dish.id} />
              <input type="hidden" name="on" value={isRegular ? "false" : "true"} />
              <p className="text-[15px]">{isRegular ? "On the everyday menu." : "Not on the everyday menu."}</p>
              <SubmitButton pendingLabel="Saving…" className="min-h-11 rounded-xl border-[1.5px] border-line-deep bg-white px-4 text-sm font-semibold text-teal-deep">
                {isRegular ? "Take off the everyday menu" : "Put on the everyday menu"}
              </SubmitButton>
            </ActionForm>
          ) : (
            <p className="border-t border-line pt-[18px] text-[15px]">{isRegular ? "On the everyday menu." : "Not on the everyday menu."}</p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <div>
        <Link href={isRegular ? "/dashboard/manage" : "/dashboard/menu"} className="text-sm font-semibold text-teal-deep">← Back</Link>
        <h1 className="mt-2 font-display text-[34px] leading-tight">{isNew ? "New dish" : `Edit ${dish?.name}`}</h1>
        <RefusalNote className="mt-1" />
        {planDay && <p className="text-[15px] text-ink-soft">It’ll be added to {dayLabel(planDay, "long")} and saved to the dish library.</p>}
      </div>

      <ActionForm
        action={saveDish}
        className="flex flex-col gap-[18px] rounded-[20px] border border-line bg-white p-6"
        errorClassName="rounded-xl bg-blush px-4 py-3 text-[15px] text-coral-ink"
      >
        <input type="hidden" name="id" value={dish?.id ?? ""} />
        {/* New dishes get their id up front, so a repeated submit of this form can't create a second copy. */}
        {isNew && <input type="hidden" name="new_id" value={crypto.randomUUID()} />}
        <PhotoUpload initialUrl={dish?.photo_url ?? null} />

        <label className={label}>
          Dish name
          <input name="name" required maxLength={80} defaultValue={dish?.name} className={field} />
        </label>
        <label className={label}>
          Short description
          <textarea name="description" rows={2} maxLength={300} defaultValue={dish?.description} className="rounded-xl border border-line-deep px-3.5 py-3 text-[15px] font-normal" />
        </label>
        <div className="grid grid-cols-2 gap-3.5">
          <label className={label}>
            Price (KSh)
            <input name="price_kes" type="number" inputMode="numeric" min={0} required defaultValue={dish?.price_kes} className={field} />
          </label>
          <label className={label}>
            Category
            <select name="category" defaultValue={dish?.category ?? "mains"} className={field}>
              <option value="mains">Mains</option>
              <option value="sides">Sides</option>
              <option value="breakfast">Breakfast</option>
              <option value="drinks">Drinks</option>
            </select>
          </label>
        </div>
        {everyday ? (
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" name="is_regular" defaultChecked={isRegular} className="size-5 accent-teal-deep" />
            Always on the menu (a regular dish)
          </label>
        ) : (
          // Without the Everyday menu job the save keeps the dish where it is.
          isRegular && <input type="hidden" name="is_regular" value="on" />
        )}

        {planDay && (
          <fieldset className="flex flex-col gap-3.5 rounded-2xl bg-mist p-4">
            <legend className="sr-only">Add to the menu</legend>
            <input type="hidden" name="add_day" value={planDay} />
            <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[#eef2f6] p-1">
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-sm font-semibold has-[:checked]:bg-white has-[:checked]:text-teal-deep">
                <input type="radio" name="add_kind" value="day" defaultChecked className="sr-only" /> {dayLabel(planDay)} only
              </label>
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-sm font-semibold has-[:checked]:bg-white has-[:checked]:text-teal-deep">
                <input type="radio" name="add_kind" value="week" className="sr-only" /> Rest of the week
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className={label}>
                Plates a day
                <input name="plates_per_day" type="number" min={0} max={1000} step={1} placeholder="No limit" className={field} />
              </label>
              <label className={label}>
                Show from
                <input name="show_from" type="time" defaultValue="11:00" className={field} />
              </label>
              <label className={label}>
                Until
                <input name="show_until" type="time" defaultValue="20:00" className={field} />
              </label>
            </div>
          </fieldset>
        )}

        <SubmitButton pendingLabel="Saving…" className="min-h-[52px] self-start rounded-[14px] bg-teal-deep px-7 font-bold text-white">
          {planDay ? "Save and add to menu" : "Save dish"}
        </SubmitButton>
      </ActionForm>

      {dish && staff.role === "owner" && (
        <ActionForm
          action={deleteDish}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line bg-white px-6 py-4"
          errorClassName="basis-full text-[13px] font-semibold text-coral-ink"
        >
          <input type="hidden" name="dishId" value={dish.id} />
          <input type="hidden" name="after" value={dish.is_regular ? "/dashboard/manage" : "/dashboard/menu"} />
          <p className="text-sm text-ink-soft">Remove this dish from the menu and the dish library. Past orders keep their record.</p>
          <SubmitButton
            confirm={`Delete ${dish.name}? It will disappear from the menu and the dish library.`}
            pendingLabel="Deleting…"
            className="min-h-11 rounded-xl border-[1.5px] border-coral-ink bg-white px-4 text-sm font-bold text-coral-ink"
          >
            Delete dish
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

function ReadOnlyNote({ back }: { back: string }) {
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <Link href={back} className="text-sm font-semibold text-teal-deep">← Back</Link>
      <h1 className="font-display text-[34px] leading-tight">New dish</h1>
      <p className="text-[15px] text-ink-soft">{OWNER_ONLY.dishes_prices}</p>
    </div>
  );
}
