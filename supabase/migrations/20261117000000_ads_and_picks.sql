-- Slice 2.11 part A: Mama's picks and neighbour ads (spec-2.11-ads-promos.md, plan-2.11-build.md).
-- 1. dishes.is_pick: owner only, logged as promo.pick; customer_menu() and todays_menu return it.
-- 2. ads: two spaces (menu, order page), one live ad per space per day, approved by the owner.
--    Approve / pause / resume / end go through RPCs that lock the space, so two approvals can't
--    both take it. A customer-visible edit sends an approved ad back to draft.
-- 3. live_ads(): what customers may see (no fee, no web address). Views and taps per ad per day,
--    counted only while the ad is live, with no customer details.

-- Only used inside function bodies below, so adding it in this file is safe.
alter type public.change_area add value if not exists 'promos';

-- ───────────────────────── 1. Mama's pick ─────────────────────────
alter table public.dishes add column is_pick boolean not null default false;

create function public.guard_dish_pick() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.api_caller() and not public.is_owner()
     and ((tg_op = 'INSERT' and new.is_pick) or (tg_op = 'UPDATE' and new.is_pick is distinct from old.is_pick)) then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dishes_pick_guard before insert or update of is_pick on public.dishes
  for each row execute function public.guard_dish_pick();

create function public.log_dish_pick() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if new.is_pick is distinct from old.is_pick then
    perform public.log_change('promos', case when new.is_pick then 'promo.pick_on' else 'promo.pick_off' end, new.id, new.name);
  end if;
  return null;
end $$;
create trigger dishes_pick_log after update of is_pick on public.dishes
  for each row execute function public.log_dish_pick();
revoke all on function public.guard_dish_pick() from public, anon, authenticated;
revoke all on function public.log_dish_pick() from public, anon, authenticated;

-- todays_menu: as 20261116100300_ratings_compose's (ratings, and 2.7's every-choice-out rule), plus is_pick at the end.
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
  d.rating_count,
  d.is_pick
from public.menu_entries e
join public.dishes d on d.id = e.dish_id
left join public.menu_entry_days md on md.entry_id = e.id and md.day = public.nairobi_today()
where e.published
  and e.ended_early_at is null
  and public.nairobi_today() between e.starts_on and e.ends_on
  and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = public.nairobi_today());

-- customer_menu(): as 20261116100300_ratings_compose's, plus is_pick at the end. The return type changes,
-- so it is dropped and made again.
drop function public.customer_menu();
create function public.customer_menu()
returns table (
  menu_day date, entry_id uuid, kind public.entry_kind, starts_on date, ends_on date,
  show_from time, show_until time, sort_order integer, dish_id uuid, name text, description text,
  photo_key text, category public.dish_category, price_kes integer, plates_per_day integer,
  plates_sold integer, plates_left integer, sold_out boolean, open_now boolean,
  auto_hide_sold_out boolean, photo_url text, photo_thumb_url text,
  rating_avg numeric, rating_count integer, is_pick boolean)
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
         public.dish_rating_avg(dd.rating_count, dd.rating_total), dd.rating_count, dd.is_pick
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

-- ───────────────────────── 2. neighbour ads ─────────────────────────
create type public.ad_space as enum ('menu', 'order');

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  advertiser text not null check (char_length(btrim(advertiser)) between 1 and 32),
  line text not null check (char_length(btrim(line)) between 1 and 70),
  place text not null default '' check (char_length(btrim(place)) <= 40),
  link_label text not null check (char_length(btrim(link_label)) between 1 and 24),
  -- A web address, or a Kenyan number as tel:+254XXXXXXXXX (the action normalises it).
  link_url text not null check (
    (link_url ~ '^https://[^\s]+$' and char_length(link_url) <= 500) or link_url ~ '^tel:\+254[0-9]{9}$'),
  logo_key text,
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  space public.ad_space not null,
  starts_on date not null,
  ends_on date not null,
  fee_kes integer not null default 0 check (fee_kes between 0 and 10000000),
  fee_period text not null default 'month' check (fee_period in ('week', 'month')),
  -- Set only by the RPCs below (the guard refuses them from the API otherwise).
  approved_at timestamptz,
  approved_by uuid,
  paused_at timestamptz,
  ended_early_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (paused_at is null or approved_at is not null),
  check (ended_early_at is null or approved_at is not null)
);
create index ads_space_idx on public.ads (space, starts_on) where approved_at is not null and ended_early_at is null;
create index ads_created_idx on public.ads (created_at desc, id desc);

alter table public.ads enable row level security;
create policy ads_owner_read on public.ads for select to authenticated using ((select public.is_owner()));
create policy ads_owner_insert on public.ads for insert to authenticated with check ((select public.is_owner()));
create policy ads_owner_update on public.ads for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy ads_owner_delete_draft on public.ads for delete to authenticated
  using ((select public.is_owner()) and approved_at is null);
revoke all on public.ads from anon, authenticated;
grant select, insert, update, delete on public.ads to authenticated;

-- Showing on customers' screens today. Written once, used by every check below.
create function public.ad_is_live(a public.ads) returns boolean
language sql stable set search_path = '' as $$
  select a.approved_at is not null and a.paused_at is null and a.ended_early_at is null
     and public.nairobi_today() between a.starts_on and a.ends_on
$$;

-- draft | scheduled | live | paused | ended
create function public.ad_status(a public.ads) returns text
language sql stable set search_path = '' as $$
  select case
    when a.approved_at is null then 'draft'
    when a.ended_early_at is not null or a.ends_on < public.nairobi_today() then 'ended'
    when a.paused_at is not null then 'paused'
    when a.starts_on > public.nairobi_today() then 'scheduled'
    else 'live' end
$$;
grant execute on function public.ad_status(public.ads) to authenticated;

create function public.ad_snapshot(a public.ads) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('advertiser', a.advertiser, 'space', a.space, 'starts_on', a.starts_on,
    'ends_on', a.ends_on, 'fee_kes', a.fee_kes, 'fee_period', a.fee_period)
$$;
revoke all on function public.ad_snapshot(public.ads) from public, anon, authenticated;

create function public.guard_ads() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rpc boolean := coalesce(current_setting('dausis.ad_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if public.api_caller() then
      new.approved_at := null; new.approved_by := null; new.paused_at := null; new.ended_early_at := null;
      new.created_by := auth.uid();
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- An ad that was ever live keeps its counts for invoicing.
    if exists (select from public.ad_daily_counts c where c.ad_id = old.id) then
      raise exception 'This ad has been shown, so it can’t be deleted. End it instead.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if not v_rpc and public.api_caller()
     and (new.approved_at, new.approved_by, new.paused_at, new.ended_early_at)
         is distinct from (old.approved_at, old.approved_by, old.paused_at, old.ended_early_at) then
    raise exception 'Use Approve, Pause, Resume or End now.' using errcode = '42501';
  end if;
  if not v_rpc and (new.advertiser, new.line, new.place, new.link_label, new.link_url, new.logo_key,
                    new.logo_url, new.space, new.starts_on)
     is distinct from (old.advertiser, old.line, old.place, old.link_label, old.link_url, old.logo_key,
                       old.logo_url, old.space, old.starts_on) then
    if public.ad_status(old) = 'ended' then
      raise exception 'This ad has ended. Make a new ad instead.' using errcode = 'P0001';
    end if;
    -- Customers would see something Mama hasn't approved: back to draft.
    new.approved_at := null; new.approved_by := null; new.paused_at := null;
  end if;
  -- R211-01: a later end date keeps the approval, so it gets approval's check, under the same space
  -- lock: an approved run can't grow into another approved ad's days.
  if not v_rpc and new.ends_on > old.ends_on
     and new.approved_at is not null and new.paused_at is null and new.ended_early_at is null then
    perform public.lock_ad_space(new.space);
    perform public.ad_overlap_check(new);
  end if;
  return new;
end $$;
create trigger ads_guard before insert or update or delete on public.ads
  for each row execute function public.guard_ads();

create function public.log_ads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() or coalesce(current_setting('dausis.ad_rpc', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('promos', 'ad.create', new.id, new.advertiser, null, public.ad_snapshot(new));
  elsif tg_op = 'DELETE' then
    perform public.log_change('promos', 'ad.delete', old.id, old.advertiser);
  else
    if (new.advertiser, new.line, new.place, new.link_label, new.link_url, new.logo_key, new.logo_url,
        new.space, new.starts_on, new.ends_on, new.fee_kes, new.fee_period)
       is distinct from (old.advertiser, old.line, old.place, old.link_label, old.link_url, old.logo_key,
        old.logo_url, old.space, old.starts_on, old.ends_on, old.fee_kes, old.fee_period) then
      perform public.log_change('promos', 'ad.edit', new.id, new.advertiser,
        public.ad_snapshot(old),
        public.ad_snapshot(new) || jsonb_build_object('to_draft', old.approved_at is not null and new.approved_at is null));
    end if;
  end if;
  return null;
end $$;
create trigger ads_log after insert or update or delete on public.ads
  for each row execute function public.log_ads();
revoke all on function public.guard_ads() from public, anon, authenticated;
revoke all on function public.log_ads() from public, anon, authenticated;

create table public.ad_daily_counts (
  ad_id uuid not null references public.ads (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  taps integer not null default 0 check (taps >= 0),
  primary key (ad_id, day)
);
alter table public.ad_daily_counts enable row level security;
create policy ad_daily_counts_owner_read on public.ad_daily_counts for select to authenticated
  using ((select public.is_owner()));
revoke all on public.ad_daily_counts from anon, authenticated;
grant select on public.ad_daily_counts to authenticated;

-- "Mama Pima's Butchery is on the menu until 30 Nov. Pick dates after that, or the order page."
-- Another approved, unpaused, not-ended ad in the same space whose days (from today) meet this one's.
create function public.ad_overlap_check(a public.ads) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
  v_other public.ads;
begin
  select o.* into v_other from public.ads o
   where o.space = a.space and o.id <> a.id
     and o.approved_at is not null and o.paused_at is null and o.ended_early_at is null
     and o.ends_on >= v_today
     and greatest(o.starts_on, v_today) <= a.ends_on
     and greatest(a.starts_on, v_today) <= o.ends_on
   order by o.starts_on limit 1;
  if found then
    raise exception '% is % until %. Pick dates after that, or %.',
      v_other.advertiser,
      case when a.space = 'menu' then 'on the menu' else 'on the order page' end,
      to_char(v_other.ends_on, 'FMDD Mon'),
      case when a.space = 'menu' then 'the order page' else 'the menu' end
      using errcode = 'P0001', detail = 'ad_overlap';
  end if;
end $$;
revoke all on function public.ad_overlap_check(public.ads) from public, anon, authenticated;

-- One lock per space, so two approvals for the same space queue and the second sees the first.
create function public.lock_ad_space(p_space public.ad_space) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('dausis.ad_space:' || p_space::text, 0))
$$;
revoke all on function public.lock_ad_space(public.ad_space) from public, anon, authenticated;

-- Approve / Pause / Resume / End now. Each returns the ad's new status.
create function public.ad_action(p_id uuid, p_action text) returns text
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

-- ───────────────────────── 3. what customers see, and the counts ─────────────────────────
-- Live ads for a space, at most one per space (the approval lock keeps it so; limit 1 is a backstop).
-- No fee, no web address: a web tap goes through /a/[id]. A phone link gives its number.
create function public.live_ads(p_space public.ad_space)
returns table (id uuid, space public.ad_space, advertiser text, line text, place text,
               link_label text, link_kind text, link_tel text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.space, a.advertiser, a.line, a.place, a.link_label,
         case when a.link_url like 'tel:%' then 'tel' else 'web' end,
         case when a.link_url like 'tel:%' then substr(a.link_url, 5) end,
         a.logo_url
  from public.ads a
  where a.space = p_space and public.ad_is_live(a)
  order by a.approved_at
  limit 1
$$;
revoke all on function public.live_ads(public.ad_space) from public;
grant execute on function public.live_ads(public.ad_space) to anon, authenticated;

-- A view: the card half on screen for a second, once per page load. At most two ids (one per
-- space); anything else, or an ad that isn't live, counts nothing.
create function public.count_ad_view(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 2 then return; end if;
  insert into public.ad_daily_counts as c (ad_id, day, views)
    select a.id, public.nairobi_today(), 1 from public.ads a
     where a.id = any (p_ids) and public.ad_is_live(a)
  on conflict (ad_id, day) do update set views = c.views + 1;
end $$;
revoke all on function public.count_ad_view(uuid[]) from public;
grant execute on function public.count_ad_view(uuid[]) to anon, authenticated;

-- A tap: counted, and the stored link returned. Null when the ad isn't live, so /a/[id] can never
-- send anyone somewhere that isn't a live ad's own link.
create function public.count_ad_tap(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  select a.link_url into v_url from public.ads a where a.id = p_id and public.ad_is_live(a);
  if v_url is null then return null; end if;
  insert into public.ad_daily_counts as c (ad_id, day, taps) values (p_id, public.nairobi_today(), 1)
    on conflict (ad_id, day) do update set taps = c.taps + 1;
  return v_url;
end $$;
revoke all on function public.count_ad_tap(uuid) from public;
grant execute on function public.count_ad_tap(uuid) to anon, authenticated;

-- The owner's list: every ad with its status and counts (whole run and this month).
create function public.ads_overview()
returns table (id uuid, advertiser text, line text, place text, link_label text, link_url text,
               logo_key text, logo_url text, space public.ad_space, starts_on date, ends_on date,
               fee_kes integer, fee_period text, status text, approved_at timestamptz,
               created_at timestamptz, views bigint, taps bigint, month_views bigint, month_taps bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  return query
  select a.id, a.advertiser, a.line, a.place, a.link_label, a.link_url, a.logo_key, a.logo_url,
         a.space, a.starts_on, a.ends_on, a.fee_kes, a.fee_period, public.ad_status(a), a.approved_at,
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
