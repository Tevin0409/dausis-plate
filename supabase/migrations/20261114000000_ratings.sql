-- Slice 2.10: customer ratings (spec-2.10-ratings.md; Tevin 2026-11-07: Q1 A, Q2 B, Q3 B, Q4 B, Q5 A).
--
--   * One rating per completed order (1–5 stars, optional private comment), sent only through
--     rate_order with the order's public token, within 7 days of completion.
--   * The stars count once on every distinct dish in the order: dishes.rating_count / rating_total.
--     todays_menu shows rating_avg from the 3rd visible rating.
--   * Comments, hides and replies are the owner's: order_ratings is readable by owners only, and
--     every write goes through a security definer RPC.
--   * kitchen_settings.google_review_url: the "Review on Google" link. Empty means no Google card.
--
-- Functions that name the new 'ratings' change area are plpgsql, so the enum value isn't used
-- before this migration commits.

alter type public.change_area add value if not exists 'ratings';

-- ───────────────────────── tables ─────────────────────────
alter table public.dishes
  add column rating_count integer not null default 0 check (rating_count >= 0),
  add column rating_total integer not null default 0 check (rating_total >= 0);

alter table public.kitchen_settings
  add column google_review_url text
    -- No spaces or line breaks anywhere: one would make a dead button for customers (RQA210-03).
    check (google_review_url ~ '^https://\S+$' and char_length(google_review_url) <= 500);

alter table public.staff add column ratings_seen_at timestamptz;

create table public.order_ratings (
  order_id uuid primary key references public.orders (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text check (char_length(comment) between 1 and 500),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  reply text check (char_length(reply) between 1 and 500),
  replied_at timestamptz,
  replied_by uuid references auth.users (id) on delete set null,
  check (hidden_at is not null or hidden_by is null),
  check ((reply is null) = (replied_at is null))
);
create index order_ratings_created on public.order_ratings (created_at desc);
create index order_ratings_hidden on public.order_ratings (created_at desc) where hidden_at is not null;

alter table public.order_ratings enable row level security;
create policy order_ratings_owner_read on public.order_ratings
  for select to authenticated using ((select public.is_owner()));
revoke all on public.order_ratings from anon;
revoke insert, update, delete, truncate on public.order_ratings from authenticated;

-- Staff may edit dishes directly (dishes_staff_write), but the rating totals move only through
-- the rating RPCs, which run as the definer. A direct API write to them is refused.
create function public.guard_dish_rating_totals() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and (new.rating_count <> 0 or new.rating_total <> 0) then
      raise exception 'Ratings are counted by the app.' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.rating_count, new.rating_total) is distinct from (old.rating_count, old.rating_total) then
      raise exception 'Ratings are counted by the app.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger dishes_guard_rating_totals before insert or update on public.dishes
  for each row execute function public.guard_dish_rating_totals();

-- ───────────────────────── helpers ─────────────────────────
-- The distinct dishes an order counts on (Q1 A). Order lines never change after placing.
create function public.rating_dish_ids(p_order_id uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct i.dish_id from public.order_items i where i.order_id = p_order_id
$$;
revoke all on function public.rating_dish_ids(uuid) from public, anon, authenticated;

-- Average shown on a dish: one decimal, half up, only from the 3rd visible rating (Q2 B).
create function public.dish_rating_avg(p_count integer, p_total integer) returns numeric
language sql immutable set search_path = public as $$
  select case when p_count >= 3 then round(p_total::numeric / p_count, 1) end
$$;

-- ───────────────────────── today's menu ─────────────────────────
-- As 2.5's, plus rating_avg and rating_count at the end.
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
    or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)) as sold_out,
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

-- ───────────────────────── the customer's rating ─────────────────────────
-- Refusals are P0001 with a key the page maps to its line (src/lib/ratings.ts).
create function public.rate_order(p_token uuid, p_stars smallint, p_comment text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  r public.order_ratings%rowtype;
begin
  select * into o from public.orders where public_token = p_token for update;
  if not found then raise exception 'rating_no_order' using errcode = 'P0001'; end if;
  if o.status <> 'completed' then raise exception 'rating_not_finished' using errcode = 'P0001'; end if;
  if exists (select 1 from public.order_ratings where order_id = o.id) then
    raise exception 'rating_already' using errcode = 'P0001';
  end if;
  if o.status_changed_at < now() - interval '7 days' then
    raise exception 'rating_closed' using errcode = 'P0001';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'rating_stars' using errcode = 'P0001';
  end if;
  if char_length(v_comment) > 500 then raise exception 'rating_comment_long' using errcode = 'P0001'; end if;

  insert into public.order_ratings (order_id, stars, comment) values (o.id, p_stars, v_comment)
  returning * into r;
  update public.dishes d set rating_count = d.rating_count + 1, rating_total = d.rating_total + p_stars
   where d.id in (select public.rating_dish_ids(o.id));
  return jsonb_build_object('sent_at', r.created_at, 'stars', r.stars, 'comment_sent', r.comment is not null);
end $$;
revoke all on function public.rate_order(uuid, smallint, text) from public;
grant execute on function public.rate_order(uuid, smallint, text) to anon, authenticated;

-- ───────────────────────── the customer's page ─────────────────────────
-- As 2.9's, plus `rating` (never the comment text, never whether it's hidden), `rate_dishes`,
-- `rate_until` and `google_review_url` (completed orders only).
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
        'unit_price_kes', i.unit_price_kes) order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;

-- ───────────────────────── the owner's Ratings screen ─────────────────────────
create function public.list_ratings(p_show text default 'all', p_before timestamptz default null)
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
       and case p_show
             when 'comments' then r.comment is not null
             when 'low' then r.stars <= 2
             when 'hidden' then r.hidden_at is not null
             else true end
     order by r.created_at desc
     limit 30;
end $$;

-- The heading's line: visible ratings in the last 30 Nairobi days, and how many are hidden.
create function public.ratings_summary()
returns table (avg_stars numeric, visible integer, hidden integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  return query
    select round(avg(r.stars) filter (where r.hidden_at is null), 1),
           (count(*) filter (where r.hidden_at is null))::integer,
           (count(*) filter (where r.hidden_at is not null))::integer
      from public.order_ratings r
     where public.nairobi_day(r.created_at) > public.nairobi_today() - 30;
end $$;

-- Hide from the averages (Q3 B), or show again. Asking for the state it already has changes nothing.
create function public.set_rating_hidden(p_order_id uuid, p_hidden boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.order_ratings%rowtype;
  v_code text;
  v_sign integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into r from public.order_ratings where order_id = p_order_id for update;
  if not found then raise exception 'rating_missing' using errcode = 'P0001'; end if;
  if (r.hidden_at is not null) = p_hidden then return p_hidden; end if;

  v_sign := case when p_hidden then -1 else 1 end;
  update public.order_ratings
     set hidden_at = case when p_hidden then now() end,
         hidden_by = case when p_hidden then auth.uid() end
   where order_id = p_order_id;
  update public.dishes d
     set rating_count = d.rating_count + v_sign, rating_total = d.rating_total + v_sign * r.stars
   where d.id in (select public.rating_dish_ids(p_order_id));

  select o.code into v_code from public.orders o where o.id = p_order_id;
  perform public.log_change('ratings', case when p_hidden then 'ratings.hide' else 'ratings.show' end,
    p_order_id, v_code, null, jsonb_build_object('stars', r.stars));
  return p_hidden;
end $$;

-- Reply (Q4 B): empty removes it. The History doesn't copy the reply text.
create function public.reply_to_rating(p_order_id uuid, p_reply text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.order_ratings%rowtype;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
  v_code text;
  v_action text;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if char_length(v_reply) > 500 then raise exception 'reply_long' using errcode = 'P0001'; end if;
  select * into r from public.order_ratings where order_id = p_order_id for update;
  if not found then raise exception 'rating_missing' using errcode = 'P0001'; end if;
  if v_reply is not distinct from r.reply then
    return case when r.reply is null then null
                else jsonb_build_object('text', r.reply, 'replied_at', r.replied_at) end;
  end if;

  v_action := case when v_reply is null then 'ratings.reply_remove'
                   when r.reply is null then 'ratings.reply'
                   else 'ratings.reply_change' end;
  update public.order_ratings
     set reply = v_reply,
         replied_at = case when v_reply is not null then now() end,
         replied_by = case when v_reply is not null then auth.uid() end
   where order_id = p_order_id
  returning * into r;

  select o.code into v_code from public.orders o where o.id = p_order_id;
  perform public.log_change('ratings', v_action, p_order_id, v_code);
  return case when r.reply is null then null
              else jsonb_build_object('text', r.reply, 'replied_at', r.replied_at) end;
end $$;

create function public.mark_ratings_seen() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  update public.staff set ratings_seen_at = now() where user_id = auth.uid();
end $$;

-- ───────────────────────── Settings: the Google review link ─────────────────────────
create function public.set_google_review_url(p_url text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_old text;
begin
  if not public.has_permission('google_review_url') then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
  if v_url is not null and v_url !~ '^https://' then
    raise exception 'Start the link with https://' using errcode = 'P0001';
  end if;
  if char_length(v_url) > 500 then raise exception 'That link is too long.' using errcode = 'P0001'; end if;
  if v_url !~ '^https://\S+$' then
    raise exception 'Paste the whole link from Google, with no spaces.' using errcode = 'P0001';
  end if;
  select k.google_review_url into v_old from public.kitchen_settings k where k.id for update;
  if v_old is not distinct from v_url then return v_url; end if;
  update public.kitchen_settings set google_review_url = v_url where id;
  perform public.log_change('settings', 'settings.google_review', null, null,
    jsonb_build_object('url', v_old), jsonb_build_object('url', v_url));
  return v_url;
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function public.list_ratings(text, timestamptz) from public, anon;
revoke all on function public.ratings_summary() from public, anon;
revoke all on function public.set_rating_hidden(uuid, boolean) from public, anon;
revoke all on function public.reply_to_rating(uuid, text) from public, anon;
revoke all on function public.mark_ratings_seen() from public, anon;
revoke all on function public.set_google_review_url(text) from public, anon;
grant execute on function public.list_ratings(text, timestamptz) to authenticated;
grant execute on function public.ratings_summary() to authenticated;
grant execute on function public.set_rating_hidden(uuid, boolean) to authenticated;
grant execute on function public.reply_to_rating(uuid, text) to authenticated;
grant execute on function public.mark_ratings_seen() to authenticated;
grant execute on function public.set_google_review_url(text) to authenticated;
