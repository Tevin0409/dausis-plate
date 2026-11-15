-- Slice 2.1: the owner's tiles show Total ordered, Paid so far and Not paid yet.
-- Adds paid_kes and unpaid_kes (they add up to revenue_kes) and drops paid_online,
-- which could only ever be 0 at launch. Cancelled orders stay out, as before.
-- Same signature, so `create or replace` keeps the grants and revokes.
create or replace function public.dashboard_stats(p_day date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with day_orders as (
    select * from public.orders
    where (created_at at time zone 'Africa/Nairobi')::date = p_day and status <> 'cancelled'
  )
  select jsonb_build_object(
    'revenue_kes', coalesce((select sum(total_kes) from day_orders), 0),
    'paid_kes', coalesce((select sum(total_kes) from day_orders where payment_status = 'paid'), 0),
    'unpaid_kes', coalesce((select sum(total_kes) from day_orders where payment_status <> 'paid'), 0),
    'orders', (select count(*) from day_orders),
    'by_mode', coalesce((select jsonb_object_agg(mode::text, n) from (select mode, count(*) n from day_orders group by mode) m), '{}'::jsonb),
    'by_payment', coalesce((select jsonb_object_agg(payment_method::text, n) from (select payment_method, count(*) n from day_orders group by payment_method) m), '{}'::jsonb),
    'by_hour', coalesce((select jsonb_object_agg(h, n) from (
        select extract(hour from created_at at time zone 'Africa/Nairobi')::int h, count(*) n
        from day_orders group by 1) x), '{}'::jsonb),
    'rotating', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'sold', coalesce(md.plates_sold, 0), 'total', e.plates_per_day) order by coalesce(md.plates_sold, 0) desc)
      from public.menu_entries e
      join public.dishes d on d.id = e.dish_id
      left join public.menu_entry_days md on md.entry_id = e.id and md.day = p_day
      where e.published and p_day between e.starts_on and e.ends_on), '[]'::jsonb)
  ) into v;
  return v;
end $$;
