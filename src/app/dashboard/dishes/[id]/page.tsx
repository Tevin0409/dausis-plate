import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoUpload } from "@/components/dashboard/photo-upload";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { dayLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { deleteDish, saveDish } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string; regular?: string }> };

const field = "min-h-12 rounded-xl border border-line-deep px-3.5 text-base font-medium";
const label = "flex flex-col gap-1.5 text-sm font-semibold";

export default async function DishEditorPage({ params, searchParams }: Props) {
  const [{ id }, { day, regular }] = await Promise.all([params, searchParams]);
  const isNew = id === "new";
  const supabase = await createClient();
  const dish = isNew
    ? null
    : (await supabase.from("dishes").select("id, name, description, price_kes, category, photo_url, is_regular").eq("id", id).maybeSingle()).data;
  if (!isNew && !dish) notFound();

  const planDay = isNew && day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const isRegular = dish?.is_regular ?? regular === "1";

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <div>
        <Link href={isRegular ? "/dashboard/manage" : "/dashboard/menu"} className="text-sm font-semibold text-teal-deep">← Back</Link>
        <h1 className="mt-2 font-display text-[34px] leading-tight">{isNew ? "New dish" : `Edit ${dish?.name}`}</h1>
        {planDay && <p className="text-[15px] text-ink-soft">It’ll be added to {dayLabel(planDay, "long")} and saved to the dish library.</p>}
      </div>

      <form action={saveDish} className="flex flex-col gap-[18px] rounded-[20px] border border-line bg-white p-6">
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
        <label className="flex items-center gap-3 text-[15px]">
          <input type="checkbox" name="is_regular" defaultChecked={isRegular} className="size-5 accent-teal-deep" />
          Always on the menu (a regular dish)
        </label>

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
                <input name="plates_per_day" type="number" min={0} placeholder="No limit" className={field} />
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
      </form>

      {dish && (
        <form action={deleteDish} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line bg-white px-6 py-4">
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
        </form>
      )}
    </div>
  );
}
