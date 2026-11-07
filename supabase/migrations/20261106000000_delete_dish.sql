-- Deletes a dish in one transaction, so a failure can never leave it half-removed
-- (taken off menus but still there). A dish with past orders is archived instead,
-- keeping receipts and sales history; its upcoming menu entries are unpublished.
-- Security invoker: the caller's own RLS policies decide what it may change.
-- Returns 'deleted', 'archived' or 'missing'; on 'deleted', photo_key for the app to clean up R2.
create or replace function public.delete_dish(p_dish uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_dish public.dishes;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_dish from public.dishes where id = p_dish for update;
  if v_dish.id is null then return jsonb_build_object('result', 'missing'); end if;

  if not exists (select 1 from public.order_items where dish_id = p_dish) then
    begin
      delete from public.menu_entries where dish_id = p_dish;
      delete from public.dishes where id = p_dish;
      return jsonb_build_object('result', 'deleted', 'photo_key', v_dish.photo_key);
    exception when foreign_key_violation then
      -- An order arrived after the check: keep the dish and archive it below.
      null;
    end;
  end if;

  update public.dishes set archived = true, is_regular = false where id = p_dish;
  update public.menu_entries set published = false where dish_id = p_dish and ends_on >= public.nairobi_today();
  return jsonb_build_object('result', 'archived');
end $$;

revoke execute on function public.delete_dish(uuid) from public, anon;
grant execute on function public.delete_dish(uuid) to authenticated;
