-- Wave 2 integration, step 4: the Reports Ratings tab (spec-2.12-reports.md, "Ratings (2.10)" and the
-- Ratings section). 2.12 left the tab as an empty state until 2.10 merged.
--   1. report_ratings(p_from, p_to): the figure, the weekly trend, replies and recent comments.
--   2. report_dishes again (as 20261116100200), plus each dish's rating for the period.
--   3. list_ratings gains an optional date range, so "All ratings" opens the Ratings screen on the
--      same period.
-- Ratings count on the Nairobi day they were sent (order_ratings.created_at), not the day of the order.
-- Hidden ratings are left out of every average and count, as on the public stars, and are counted
-- apart; recent comments include them with a hidden flag.

-- ───────────────────────── 1. report_ratings ─────────────────────────
create function public.report_ratings(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return (
    with r as (
      select r.order_id, r.stars, r.comment, r.created_at, r.hidden_at, r.reply, r.replied_at,
             (r.created_at at time zone 'Africa/Nairobi')::date as day
      from public.order_ratings r
      where (r.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
    )
    select jsonb_build_object(
      'avg', (select round(avg(stars), 1) from r where hidden_at is null),
      'count', (select count(*) from r where hidden_at is null),
      'hidden', (select count(*) from r where hidden_at is not null),
      -- Replies are counted against every comment, hidden or not: Mama can reply to either.
      'with_comment', (select count(*) from r where comment is not null),
      'replied', (select count(*) from r where comment is not null and reply is not null),
      -- Weeks start on Monday. A week with no counted ratings has no row (the chart shows a gap).
      'by_week', (
        select coalesce(jsonb_agg(jsonb_build_object('week', w, 'avg', a, 'count', n) order by w), '[]')
        from (select date_trunc('week', day)::date as w, round(avg(stars), 1) as a, count(*) as n
              from r where hidden_at is null group by 1) x),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', o.code, 'stars', x.stars, 'comment', x.comment, 'sent_at', x.created_at,
          'hidden', x.hidden_at is not null, 'reply', x.reply, 'replied_at', x.replied_at,
          'dishes', array(select distinct on (i.dish_id) i.name from public.order_items i
                          where i.order_id = x.order_id order by i.dish_id, i.name))
          order by x.created_at desc), '[]')
        from (select * from r where comment is not null order by created_at desc limit 10) x
        join public.orders o on o.id = x.order_id)
    )
  );
end $$;
revoke all on function public.report_ratings(date, date) from public, anon;
grant execute on function public.report_ratings(date, date) to authenticated;

-- ───────────────────────── 2. report_dishes, with ratings ─────────────────────────
-- As 20261116100200, plus rating_avg and rating_count: the average of the stars of the not-hidden
-- ratings sent in the period on orders that had the dish (one rating counts once per distinct dish,
-- Q1 A). From the 1st rating, because this is Mama's own view.
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
          e.usual_sold_out_minutes,
          rt.rating_avg, coalesce(rt.rating_count, 0) as rating_count
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
        left join (
          select i.dish_id, round(avg(r.stars), 1) as rating_avg, count(*)::integer as rating_count
          from public.order_ratings r
          join (select distinct oi.order_id, oi.dish_id from public.order_items oi) i on i.order_id = r.order_id
          where r.hidden_at is null and (r.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) rt on rt.dish_id = d.id
        -- A dish rated in the period stays listed even with no plates in it (a rating sent days after the order).
        where coalesce(s.plates, 0) > 0 or coalesce(e.days_on, 0) > 0 or (d.is_regular and not d.archived) or rt.rating_count is not null) x),
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

-- ───────────────────────── 3. list_ratings with a date range ─────────────────────────
-- As 2.10's, plus p_from and p_to (Nairobi days the rating was sent, both optional). Its argument
-- list changes, so it is dropped and created again with the same grants.
drop function public.list_ratings(text, timestamptz);
create function public.list_ratings(p_show text default 'all', p_before timestamptz default null,
                                    p_from date default null, p_to date default null)
returns table (
  order_id uuid, code text, first_name text, sent_at timestamptz, stars smallint, dishes text[],
  comment text, hidden_at timestamptz, reply text, replied_at timestamptz, is_new boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_seen timestamptz;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if p_show not in ('all', 'comments', 'low', 'hidden') then
    raise exception 'Unknown filter.' using errcode = '22023';
  end if;
  select s.ratings_seen_at into v_seen from public.staff s where s.user_id = auth.uid();
  return query
    select r.order_id, o.code, split_part(trim(o.customer_name), ' ', 1), r.created_at, r.stars,
           array(select distinct on (i.dish_id) i.name from public.order_items i
                  where i.order_id = r.order_id order by i.dish_id, i.name),
           r.comment, r.hidden_at, r.reply, r.replied_at,
           (v_seen is null or r.created_at > v_seen)
      from public.order_ratings r
      join public.orders o on o.id = r.order_id
     where (p_before is null or r.created_at < p_before)
       and (p_from is null or (r.created_at at time zone 'Africa/Nairobi')::date >= p_from)
       and (p_to is null or (r.created_at at time zone 'Africa/Nairobi')::date <= p_to)
       and case p_show
             when 'comments' then r.comment is not null
             when 'low' then r.stars <= 2
             when 'hidden' then r.hidden_at is not null
             else true end
     order by r.created_at desc
     limit 30;
end $$;
revoke all on function public.list_ratings(text, timestamptz, date, date) from public, anon;
grant execute on function public.list_ratings(text, timestamptz, date, date) to authenticated;
