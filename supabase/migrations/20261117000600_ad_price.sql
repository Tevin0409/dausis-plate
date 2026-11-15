-- 2.11 follow-up: an ad's price and "Amount due" (spec-2.11-ad-price.md; Tevin 2026-11-15, 1A).
-- One agreed price per run replaces the weekly or monthly fee, which never shipped. A draft may have
-- no price yet; approving needs one (0 for a free ad). The price never reaches customers, so changing
-- it keeps the approval (guard_ads leaves it out of the customer-visible list) and an ended ad may
-- still correct it. Reports' "Ads, for invoicing" gains the amount due, counted once, in the period
-- where the run starts.

-- An approved ad must have its price, and before this migration no ad has one (only the weekly or
-- monthly fee, which is not the agreed run price and is never converted). So stop here, loudly, if
-- any ad was approved before this migration: each needs a price Tevin decides. List them first with
-- the read-only supabase/preflight/ad-price.sql. A database with no approved ads upgrades as is.
do $$
declare
  v_list text;
begin
  select string_agg(format('%s (%s, %s to %s)', a.advertiser, a.space, a.starts_on, a.ends_on), '; '
                    order by a.starts_on, a.advertiser)
    into v_list
  from public.ads a
  where a.approved_at is not null;
  if v_list is not null then
    raise exception 'Ad price migration stopped: these approved ads have no agreed price yet: %', v_list
      using errcode = 'P0001',
            hint = 'Run supabase/preflight/ad-price.sql to list them. Each listed run needs a price Tevin decides before this migration can apply. Nothing was changed.';
  end if;
end $$;

alter table public.ads
  add column price_kes integer check (price_kes between 0 and 10000000);
alter table public.ads drop column fee_kes, drop column fee_period;
-- An approved ad always has its price, so Amount due never lacks a figure (only a draft waits for one).
-- The check above means no approved ad reaches this line; the seed sets its ads' prices after migrating.
alter table public.ads add constraint ads_price_when_approved check (approved_at is null or price_kes is not null);

create or replace function public.ad_snapshot(a public.ads) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('advertiser', a.advertiser, 'space', a.space, 'starts_on', a.starts_on,
    'ends_on', a.ends_on, 'price_kes', a.price_kes)
$$;
revoke all on function public.ad_snapshot(public.ads) from public, anon, authenticated;

create or replace function public.log_ads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() or coalesce(current_setting('dausis.ad_rpc', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('promos', 'ad.create', new.id, new.advertiser, null, public.ad_snapshot(new));
  elsif tg_op = 'DELETE' then
    perform public.log_change('promos', 'ad.delete', old.id, old.advertiser);
  else
    if (new.advertiser, new.line, new.place, new.link_label, new.link_url, new.logo_key, new.logo_url,
        new.space, new.starts_on, new.ends_on, new.price_kes)
       is distinct from (old.advertiser, old.line, old.place, old.link_label, old.link_url, old.logo_key,
        old.logo_url, old.space, old.starts_on, old.ends_on, old.price_kes) then
      -- `other`: whether anything besides the price changed, so History can tell a price-only edit.
      perform public.log_change('promos', 'ad.edit', new.id, new.advertiser,
        public.ad_snapshot(old),
        public.ad_snapshot(new) || jsonb_build_object(
          'to_draft', old.approved_at is not null and new.approved_at is null,
          'other', (new.advertiser, new.line, new.place, new.link_label, new.link_url, new.logo_key, new.logo_url,
                    new.space, new.starts_on, new.ends_on)
                   is distinct from (old.advertiser, old.line, old.place, old.link_label, old.link_url, old.logo_key,
                    old.logo_url, old.space, old.starts_on, old.ends_on)));
    end if;
  end if;
  return null;
end $$;
revoke all on function public.log_ads() from public, anon, authenticated;

-- ad_action: as in 20261117000000, and approving refuses an ad with no price (detail ad_price).
create or replace function public.ad_action(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_ad public.ads;
  v_space public.ad_space;
  v_status text;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select a.space into v_space from public.ads a where a.id = p_id;
  if v_space is null then raise exception 'That ad isn’t there any more.' using errcode = 'P0001', detail = 'ad_missing'; end if;
  perform public.lock_ad_space(v_space);
  select * into v_ad from public.ads a where a.id = p_id for update;
  if not found then raise exception 'That ad isn’t there any more.' using errcode = 'P0001', detail = 'ad_missing'; end if;
  if v_ad.space <> v_space then
    -- Moved between the read and the lock: take the other space's lock too.
    perform public.lock_ad_space(v_ad.space);
  end if;
  v_status := public.ad_status(v_ad);

  perform set_config('dausis.ad_rpc', 'on', true);
  if p_action = 'approve' then
    if v_status <> 'draft' then raise exception 'This ad is already approved.' using errcode = 'P0001', detail = 'ad_state'; end if;
    if v_ad.price_kes is null then
      raise exception 'Add the price you agreed before approving. Use 0 if it’s free.' using errcode = 'P0001', detail = 'ad_price';
    end if;
    if v_ad.ends_on < public.nairobi_today() then
      raise exception 'This ad’s dates are over. Pick new dates first.' using errcode = 'P0001', detail = 'ad_dates_over';
    end if;
    perform public.ad_overlap_check(v_ad);
    update public.ads set approved_at = now(), approved_by = auth.uid() where id = p_id returning * into v_ad;
    perform public.log_change('promos', 'ad.approve', v_ad.id, v_ad.advertiser, null, public.ad_snapshot(v_ad));
  elsif p_action = 'pause' then
    if v_status <> 'live' then raise exception 'Only a live ad can be paused.' using errcode = 'P0001', detail = 'ad_state'; end if;
    update public.ads set paused_at = now() where id = p_id returning * into v_ad;
    perform public.log_change('promos', 'ad.pause', v_ad.id, v_ad.advertiser);
  elsif p_action = 'resume' then
    if v_status <> 'paused' then raise exception 'Only a paused ad can be resumed.' using errcode = 'P0001', detail = 'ad_state'; end if;
    perform public.ad_overlap_check(v_ad);
    update public.ads set paused_at = null where id = p_id returning * into v_ad;
    perform public.log_change('promos', 'ad.resume', v_ad.id, v_ad.advertiser);
  elsif p_action = 'end' then
    if v_status not in ('scheduled', 'live', 'paused') then
      raise exception 'Only a scheduled, live or paused ad can be ended.' using errcode = 'P0001', detail = 'ad_state';
    end if;
    update public.ads set ended_early_at = now() where id = p_id returning * into v_ad;
    perform public.log_change('promos', 'ad.end', v_ad.id, v_ad.advertiser);
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform set_config('dausis.ad_rpc', '', true);
  return public.ad_status(v_ad);
end $$;
revoke all on function public.ad_action(uuid, text) from public, anon;
grant execute on function public.ad_action(uuid, text) to authenticated;

-- ads_overview: price_kes in place of the fee pair (the return type changes, so drop and create).
drop function public.ads_overview();
create function public.ads_overview()
returns table (id uuid, advertiser text, line text, place text, link_label text, link_url text,
               logo_key text, logo_url text, space public.ad_space, starts_on date, ends_on date,
               price_kes integer, status text, approved_at timestamptz,
               created_at timestamptz, views bigint, taps bigint, month_views bigint, month_taps bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  return query
  select a.id, a.advertiser, a.line, a.place, a.link_label, a.link_url, a.logo_key, a.logo_url,
         a.space, a.starts_on, a.ends_on, a.price_kes, public.ad_status(a), a.approved_at,
         a.created_at,
         coalesce(sum(c.views), 0)::bigint, coalesce(sum(c.taps), 0)::bigint,
         coalesce(sum(c.views) filter (where c.day >= date_trunc('month', public.nairobi_today())::date), 0)::bigint,
         coalesce(sum(c.taps) filter (where c.day >= date_trunc('month', public.nairobi_today())::date), 0)::bigint
  from public.ads a
  left join public.ad_daily_counts c on c.ad_id = a.id
  group by a.id
  order by a.created_at desc, a.id desc;
end $$;
revoke all on function public.ads_overview() from public, anon;
grant execute on function public.ads_overview() to authenticated;

-- report_promos_ads: as in 20261117000400, and each ad gains price_kes, amount_due and counted_here.
-- This period: the price counts when the run starts in the period (counted_here), else amount_due is
-- null and the cell shows "—". Whole run: every row carries its price. Listed: ads with views in the
-- period or run, and approved ads whose run starts in the period (this period) or has started (whole
-- run), so an ad that got no views still shows what it owes. A draft never approved has no views.
create or replace function public.report_promos_ads(p_from date, p_to date, p_ads_whole_run boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_today date := public.nairobi_today();
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object(
    'codes', (
      select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'active', d.active, 'uses', coalesce(u.n, 0),
          'discount', coalesce(u.di, 0), 'sales', coalesce(u.s, 0)) order by coalesce(u.n, 0) desc, d.code), '[]')
      from public.discount_codes d
      left join (
        select o.discount_code_id as id, count(*)::integer as n, sum(o.discount_kes)::integer as di, sum(o.total_kes)::integer as s
        from public.orders o
        where o.discount_code_id is not null and o.status <> 'cancelled'
          and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) u on u.id = d.id),
    'combos', (
      select coalesce(jsonb_agg(jsonb_build_object('combo', x.name, 'sold', x.sold, 'revenue', x.revenue) order by x.sold desc, x.name), '[]')
      from (
        select coalesce(cb.name, c.name) as name, sum(c.quantity)::integer as sold,
               sum(c.unit_price_kes * c.quantity
                   + coalesce((select sum(i.unit_price_kes * i.quantity)
                               from public.order_items i where i.order_combo_id = c.id), 0))::integer as revenue
        from public.order_combos c
        join public.orders o on o.id = c.order_id
        left join public.combos cb on cb.id = c.combo_id
        where o.status <> 'cancelled' and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by coalesce(c.combo_id::text, c.name), coalesce(cb.name, c.name)) x),
    'ads_whole_run', p_ads_whole_run,
    'ads', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'advertiser', a.advertiser, 'space', a.space,
          'starts_on', a.starts_on, 'ends_on', a.ends_on, 'views', v.views, 'taps', v.taps,
          'price_kes', a.price_kes, 'counted_here', h.here,
          'amount_due', case when h.here then a.price_kes end) order by v.views desc, a.advertiser), '[]')
      from public.ads a
      join lateral (
        select coalesce(sum(n.views), 0)::integer as views, coalesce(sum(n.taps), 0)::integer as taps
        from public.ad_daily_counts n
        where n.ad_id = a.id
          and case when p_ads_whole_run then n.day between a.starts_on and least(a.ends_on, v_today)
                   else n.day between p_from and p_to end) v on true
      cross join lateral (
        select p_ads_whole_run or a.starts_on between p_from and p_to as here) h
      where v.views > 0
         or (a.approved_at is not null
             and case when p_ads_whole_run then a.starts_on <= v_today else a.starts_on between p_from and p_to end))
  );
end $$;
revoke all on function public.report_promos_ads(date, date, boolean) from public, anon;
grant execute on function public.report_promos_ads(date, date, boolean) to authenticated;
