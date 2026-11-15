-- Wave 2 integration (RW2B-03): Reports' sold-out days and usual sold-out time count every day a
-- dish sold out, including a day it sold out and came back on (switched back on, or plates given
-- back by a cancel). 2.12's report_dishes (20261116000000_reports) tested only whether the dish is
-- out now, so those days were missed, although set_entry_sold_out and the plate trigger keep the
-- first sold_out_at of the day for exactly this. Rows from before sold_out_at existed have no time:
-- for them the current flag still counts, as before (they have no time for the usual-time median).
-- Only that one expression changes; the 'days' list already reports out and back_on separately.
create or replace function public.report_dishes(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object(
    'dishes', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.plates desc, x.name), '[]')
      from (
        select d.id, d.name, d.is_regular,
          coalesce(s.plates, 0) as plates, coalesce(s.revenue, 0) as revenue,
          -- An everyday dish is on the menu every day the kitchen was open (opening hours, less closed dates).
          case when d.is_regular then od.n else coalesce(e.days_on, 0) end as days_on,
          case when (case when d.is_regular then od.n else coalesce(e.days_on, 0) end) > 0
               then round(coalesce(s.plates, 0)::numeric / (case when d.is_regular then od.n else e.days_on end), 1) end as per_day,
          e.limit_days, e.limit_used_avg, e.limit_avg, coalesce(e.sold_out_days, 0) as sold_out_days,
          e.usual_sold_out_minutes
        from public.dishes d
        cross join lateral (
          select count(*)::integer as n from generate_series(p_from, p_to, interval '1 day') g(x)
          join public.opening_hours h on h.weekday = extract(dow from g.x)::smallint and h.is_open
          where not exists (select from public.closed_dates c where c.day = g.x::date)
        ) od
        left join (
          select i.dish_id, sum(i.quantity) as plates, sum(i.unit_price_kes * i.quantity) as revenue
          from public.order_items i join public.orders o on o.id = i.order_id
          where o.status <> 'cancelled' and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) s on s.dish_id = d.id
        left join (
          select dd.dish_id, count(*) as days_on,
            count(*) filter (where dd.ppd is not null) as limit_days,
            round(avg(dd.sold) filter (where dd.ppd is not null), 1) as limit_used_avg,
            round(avg(dd.ppd) filter (where dd.ppd is not null), 1) as limit_avg,
            count(*) filter (where dd.out) as sold_out_days,
            round(percentile_cont(0.5) within group (order by dd.mins) filter (where dd.out and dd.mins is not null))::integer as usual_sold_out_minutes
          from (
            select e.dish_id, e.plates_per_day as ppd, coalesce(md.plates_sold, 0) as sold,
              -- Sold out at some point that day: a time was recorded (kept after it came back on, or
              -- after a cancel gave plates back), or, for rows from before sold_out_at, it is out now.
              (md.sold_out_at is not null
               or coalesce(md.sold_out_manual, false)
               or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)) as out,
              extract(epoch from (md.sold_out_at at time zone 'Africa/Nairobi')::time)::integer / 60 as mins
            from public.menu_entries e
            cross join lateral generate_series(greatest(e.starts_on, p_from), least(e.ends_on, p_to), interval '1 day') g(day)
            left join public.menu_entry_days md on md.entry_id = e.id and md.day = g.day::date
            where e.published
              and not exists (select from public.menu_entry_off_days f where f.entry_id = e.id and f.day = g.day::date)
          ) dd group by 1) e on e.dish_id = d.id
        where coalesce(s.plates, 0) > 0 or coalesce(e.days_on, 0) > 0 or (d.is_regular and not d.archived)) x),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object('dish', d.name, 'day', g.day::date, 'plates', coalesce(md.plates_sold, 0),
        'limit', e.plates_per_day, 'sold_out_at', md.sold_out_at,
        'sold_out_minutes', case when md.sold_out_at is not null then extract(epoch from (md.sold_out_at at time zone 'Africa/Nairobi')::time)::integer / 60 end,
        'out', (coalesce(md.sold_out_manual, false) or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)),
        'back_on', md.sold_out_at is not null
                   and not (coalesce(md.sold_out_manual, false) or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)))
        order by d.name, g.day), '[]')
      from public.menu_entries e
      join public.dishes d on d.id = e.dish_id
      cross join lateral generate_series(greatest(e.starts_on, p_from), least(e.ends_on, p_to), interval '1 day') g(day)
      left join public.menu_entry_days md on md.entry_id = e.id and md.day = g.day::date
      where e.published
        and not exists (select from public.menu_entry_off_days f where f.entry_id = e.id and f.day = g.day::date))
  );
end $$;
