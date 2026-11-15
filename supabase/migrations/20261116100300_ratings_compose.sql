-- Wave 2 integration, step 3: slice 2.10 (ratings) on the composed functions.
-- 2.10 (20261114000000_ratings) started from 2.9's base, so two of its redefinitions drop fields
-- other slices added, and the shop now reads 2.8's customer_menu, which has no ratings:
-- 1. get_order_status: the composed version (20261116100000) plus 2.10's rating, rate_dishes,
--    rate_until and google_review_url. Same signature and token-only access; create or replace
--    keeps init's grant. The customer's comment text and whether a rating is hidden never appear.
-- 2. todays_menu: 2.10's columns, with 2.7's rule back in sold_out (every choice of the dish out).
-- 3. customer_menu: the same rating_avg and rating_count at the end, so the menu and dish page
--    show the average. Its return type changes, so it is dropped and created again with its grants.

-- 1.
create or replace function public.get_order_status(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', o.code,
    'status', case when o.status <> 'cancelled' and o.prev_status is not null
                    and o.status_changed_at > now() - interval '5 seconds'
                   then o.prev_status else o.status end,
    'mode', o.mode,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'customer_name', o.customer_name,
    'table_label', t.label,
    'zone_name', z.name,
    'pickup_at', o.pickup_at,
    'subtotal_kes', o.subtotal_kes,
    'delivery_fee_kes', o.delivery_fee_kes,
    'total_kes', o.total_kes,
    'created_at', o.created_at,
    'status_changed_at', o.status_changed_at,
    'cancel_reason', o.cancel_reason,
    'cancel_note', o.cancel_note,
    'declined', o.status = 'cancelled' and o.prev_status = 'new',
    'till_number', case when o.payment_status <> 'paid' and o.status <> 'cancelled'
                     then (select k.till_number from public.kitchen_settings k where k.id) end,
    'placed_today', public.nairobi_day(o.created_at) = public.nairobi_today(),
    'requests', case when o.mode = 'dine_in' and o.table_id is not null then jsonb_build_object(
        'waiter', (select jsonb_build_object('asked_at', r.created_at,
                     'answered_at', case when not r.auto_cleared then r.cleared_at end,
                     'by_this_order', r.order_id is not distinct from o.id)
                     from public.table_requests r
                    where r.table_id = o.table_id and r.kind = 'waiter'
                      and public.nairobi_day(r.created_at) = public.nairobi_today()
                    order by r.cleared_at is null desc, r.created_at desc limit 1),
        'bill', (select jsonb_build_object('asked_at', r.created_at,
                   'answered_at', case when not r.auto_cleared then r.cleared_at end,
                   'by_this_order', r.order_id is not distinct from o.id)
                   from public.table_requests r
                  where r.table_id = o.table_id and r.kind = 'bill'
                    and public.nairobi_day(r.created_at) = public.nairobi_today()
                  order by r.cleared_at is null desc, r.created_at desc limit 1)) end,
    'phone', (select k.phone from public.kitchen_settings k where k.id),
    'delivery_address', case when o.mode = 'delivery' then o.delivery_address end,
    'delivery_notes', case when o.mode = 'delivery' then o.delivery_notes end,
    'kitchen_address', case when o.mode <> 'delivery' then (select k.address from public.kitchen_settings k where k.id) end,
    'maps_url', case when o.mode <> 'delivery' then (select k.maps_url from public.kitchen_settings k where k.id) end,
    'rating', (select jsonb_build_object('sent_at', rt.created_at, 'stars', rt.stars,
                 'comment_sent', rt.comment is not null,
                 'reply', case when rt.reply is not null
                               then jsonb_build_object('text', rt.reply, 'replied_at', rt.replied_at) end)
                 from public.order_ratings rt where rt.order_id = o.id),
    'rate_dishes', coalesce((select jsonb_agg(s.name order by s.name) from (
        select distinct on (i.dish_id) i.name from public.order_items i
         where i.order_id = o.id order by i.dish_id, i.name) s), '[]'::jsonb),
    'rate_until', case when o.status = 'completed' then o.status_changed_at + interval '7 days' end,
    'google_review_url', case when o.status = 'completed'
                           then (select k.google_review_url from public.kitchen_settings k where k.id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes, 'note', i.note,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'price_kes', x.price_kes) order by x.sort_order)
                            from public.order_item_extras x where x.order_item_id = i.id), '[]'::jsonb))
        order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;

-- 2. and 3.
-- As 20261111000000_owner_screens' view, plus 2.10's rating_avg and rating_count at the end.
create or replace view public.todays_menu
with (security_invoker = true) as
select
  e.id as entry_id, e.kind, e.starts_on, e.ends_on, e.show_from, e.show_until, e.sort_order,
  d.id as dish_id, d.name, d.description, d.photo_key, d.category,
  coalesce(e.price_kes, d.price_kes) as price_kes,
  e.plates_per_day,
  coalesce(md.plates_sold, 0) as plates_sold,
  case when e.plates_per_day is null then null
       else greatest(e.plates_per_day - coalesce(md.plates_sold, 0), 0) end as plates_left,
  (coalesce(md.sold_out_manual, false)
    or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)
    or public.choices_all_out(d.id)) as sold_out,
  (public.nairobi_time() between e.show_from and e.show_until) as open_now,
  e.auto_hide_sold_out,
  d.photo_url,
  d.photo_thumb_url,
  public.dish_rating_avg(d.rating_count, d.rating_total) as rating_avg,
  d.rating_count
from public.menu_entries e
join public.dishes d on d.id = e.dish_id
left join public.menu_entry_days md on md.entry_id = e.id and md.day = public.nairobi_today()
where e.published
  and e.ended_early_at is null
  and public.nairobi_today() between e.starts_on and e.ends_on
  and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = public.nairobi_today());

-- As 20261112000000_customer_flow's, plus rating_avg and rating_count at the end.
drop function public.customer_menu();
create function public.customer_menu()
returns table (
  menu_day date, entry_id uuid, kind public.entry_kind, starts_on date, ends_on date,
  show_from time, show_until time, sort_order integer, dish_id uuid, name text, description text,
  photo_key text, category public.dish_category, price_kes integer, plates_per_day integer,
  plates_sold integer, plates_left integer, sold_out boolean, open_now boolean,
  auto_hide_sold_out boolean, photo_url text, photo_thumb_url text,
  rating_avg numeric, rating_count integer)
language sql stable security definer set search_path = '' as $$
  with d as (select public.menu_day() as day, public.nairobi_today() as today)
  select d.day, e.id, e.kind, e.starts_on, e.ends_on, e.show_from, e.show_until, e.sort_order,
         dd.id, dd.name, dd.description, dd.photo_key, dd.category,
         coalesce(e.price_kes, dd.price_kes), e.plates_per_day, coalesce(md.plates_sold, 0),
         case when e.plates_per_day is null then null
              else greatest(e.plates_per_day - coalesce(md.plates_sold, 0), 0) end,
         coalesce(md.sold_out_manual, false)
           or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)
           or (d.day = d.today and public.choices_all_out(dd.id)),
         d.day = d.today and public.nairobi_time() between e.show_from and e.show_until,
         e.auto_hide_sold_out, dd.photo_url, dd.photo_thumb_url,
         public.dish_rating_avg(dd.rating_count, dd.rating_total), dd.rating_count
  from d
  cross join public.menu_entries e
  join public.dishes dd on dd.id = e.dish_id and not dd.archived
  left join public.menu_entry_days md on md.entry_id = e.id and md.day = d.day
  where e.published and e.ended_early_at is null
    and d.day between e.starts_on and e.ends_on
    and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = d.day)
$$;
revoke all on function public.customer_menu() from public;
grant execute on function public.customer_menu() to anon, authenticated;
