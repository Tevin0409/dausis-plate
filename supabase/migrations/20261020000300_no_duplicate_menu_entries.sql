-- One live entry per dish, kind and start day; copying a day skips dishes already on it.
create unique index if not exists menu_entries_one_per_day
  on public.menu_entries (dish_id, kind, starts_on)
  where published and ended_early_at is null;

create or replace function public.copy_menu_day(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day,
                                   show_from, show_until, auto_hide_sold_out, published, sort_order)
  select dish_id, 'day', p_to, p_to, price_kes, plates_per_day,
         show_from, show_until, auto_hide_sold_out, true, sort_order
  from public.menu_entries
  where kind = 'day' and starts_on = p_from and ended_early_at is null
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
