-- Optimised photos live in R2; the dish row stores their public URLs.
-- photo_key keeps the R2 key of the large version so old files can be deleted on replace.
alter table public.dishes add column if not exists photo_url text, add column if not exists photo_thumb_url text;

create or replace view public.todays_menu
with (security_invoker = true) as
select
  e.id as entry_id,
  e.kind,
  e.starts_on,
  e.ends_on,
  e.show_from,
  e.show_until,
  e.sort_order,
  d.id as dish_id,
  d.name,
  d.description,
  d.photo_key,
  d.category,
  coalesce(e.price_kes, d.price_kes) as price_kes,
  e.plates_per_day,
  coalesce(md.plates_sold, 0) as plates_sold,
  case when e.plates_per_day is null then null
       else greatest(e.plates_per_day - coalesce(md.plates_sold, 0), 0) end as plates_left,
  (coalesce(md.sold_out_manual, false)
    or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)) as sold_out,
  (public.nairobi_time() between e.show_from and e.show_until) as open_now,
  e.auto_hide_sold_out,
  d.photo_url,
  d.photo_thumb_url
from public.menu_entries e
join public.dishes d on d.id = e.dish_id
left join public.menu_entry_days md on md.entry_id = e.id and md.day = public.nairobi_today()
where e.published
  and e.ended_early_at is null
  and public.nairobi_today() between e.starts_on and e.ends_on;
