-- A new dish made from the menu planner ("+ New dish", "Save and add to menu") in one transaction
-- (docs/plans/launch/fix-planner-new-dish.md, fix round 2; RQAPN-01). The dashboard used to insert
-- the dish, then save its options, then add it to the menu, as three calls. A refusal at the menu
-- step left the dish saved, and a reload or Back gave the form a new id, so the next save made a
-- second dish. Here the three steps are one call: any refusal rolls back all of it.
--
-- It composes the existing steps rather than copying them, so every rule they keep still applies:
--   * the insert goes through RLS (dishes_staff_write) and the dishes triggers (dishes_guard and the
--     rest), as the dashboard's own insert did, which is why this function is security invoker;
--   * save_dish_options (20261111000000) checks the owner's dishes and prices grant and the options;
--   * add_menu_entry (20261110000000) checks staff, the days, hours, plates and price, refuses a dish
--     that can't be planned, and logs entry.add.
-- A planned dish is never on the everyday menu (Tevin 2026-11-15, A: the planner's new-dish form has
-- no everyday switch), so is_regular is false.
--
-- The form's id already in use (review.r1, RPN-01). An existing id alone isn't proof this form
-- saved, so it counts as saved only when it is this form's earlier save: the same name, still not
-- everyday or archived, with a live menu entry of the same kind on every requested day. Then the
-- same entry id comes back (a double submit is one save). Otherwise it is refused honestly and
-- nothing changes: "saved_not_planned" when that dish was saved but its entry has gone since, and
-- "stale_form" for any other dish. Caught as a unique violation, so two submits racing each other
-- end the same way once the first commits.
create function public.create_planned_dish(
  p_id uuid,
  p_name text,
  p_description text,
  p_price_kes integer,
  p_category public.dish_category,
  p_photo_key text,
  p_photo_url text,
  p_photo_thumb_url text,
  p_options jsonb,
  p_kind public.entry_kind,
  p_days date[],
  p_from time,
  p_until time,
  p_plates integer
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_constraint text;
  v_dish public.dishes;
  v_entry uuid;
begin
  begin
    insert into public.dishes (id, name, description, price_kes, category, is_regular, photo_key, photo_url, photo_thumb_url)
    values (p_id, p_name, coalesce(p_description, ''), p_price_kes, p_category, false, p_photo_key, p_photo_url, p_photo_thumb_url);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'dishes_pkey' then raise; end if;
    select * into v_dish from public.dishes where id = p_id;
    if v_dish.id is null or v_dish.name <> p_name or v_dish.is_regular or v_dish.archived then
      raise exception 'This form is out of date. Reload the page and try again.' using errcode = 'P0001', detail = 'stale_form';
    end if;
    select e.id into v_entry
    from public.menu_entries e
    where e.dish_id = p_id and e.kind = p_kind and e.published and e.ended_early_at is null
      and not exists (
        select from unnest(p_days) d
        where d not between e.starts_on and e.ends_on
           or exists (select from public.menu_entry_off_days o where o.entry_id = e.id and o.day = d))
    limit 1;
    if v_entry is null then
      raise exception '% is already in the dish library, but it isn’t on that day’s menu any more. Add it from the planner.', v_dish.name
        using errcode = 'P0001', detail = 'saved_not_planned';
    end if;
    return v_entry;
  end;
  if coalesce(jsonb_typeof(p_options), 'null') <> 'array' or jsonb_array_length(p_options) > 0 then
    perform public.save_dish_options(p_id, p_options);
  end if;
  return public.add_menu_entry(p_id, p_kind, p_days, p_from, p_until, p_plates, null);
end $$;
revoke all on function public.create_planned_dish(uuid, text, text, integer, public.dish_category, text, text, text, jsonb,
  public.entry_kind, date[], time, time, integer) from public, anon;
grant execute on function public.create_planned_dish(uuid, text, text, integer, public.dish_category, text, text, text, jsonb,
  public.entry_kind, date[], time, time, integer) to authenticated;
