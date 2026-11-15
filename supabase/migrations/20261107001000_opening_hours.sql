-- Slice 2.2, opening hours (spec-2.2-opening-hours.md, decisions 1A, 2A, 3A).
-- One opening period a day, closing by midnight; one set of hours for every order type;
-- last orders 30, 15 or 0 minutes before closing. All times are Nairobi time.
--
--   * opening_hours, closed_dates, kitchen_settings: staff read, only the owner writes.
--   * kitchen_status_at(p_now) is the one place the open/closed rules live.
--   * close_early() / reopen_today() / save_opening_hours() / set_till_number() are owner RPCs.
--   * dishes.regular_available becomes unavailable_on: "sold out" lasts for that date only,
--     so a regular dish is back the next morning with no job running.
--   * get_order_status returns the till number for an unpaid, live order.

-- ───────────────────────── who may change the kitchen's settings ─────────────────────────
-- The one check every owner-only write goes through. Today it is the owner; slice 2.3 adds
-- per-person grants here ('hours', 'close_early', 'till_number') without touching callers.
create function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner()
$$;

-- ───────────────────────── tables ─────────────────────────
create table public.opening_hours (
  weekday smallint primary key check (weekday between 0 and 6), -- 0 = Sunday, as extract(dow)
  is_open boolean not null default true,
  opens time not null default '11:00',
  closes time not null default '20:00',
  -- time - time is an interval, so a closing past midnight can't wrap round and pass.
  constraint opening_hours_one_hour check (closes - opens >= interval '1 hour'),
  constraint opening_hours_by_midnight check (closes <= '24:00')
);

-- Every day open 11:00–20:00, matching the dish default show_from/show_until, so nothing
-- changes for customers until Mama enters her hours (a go-live item).
insert into public.opening_hours (weekday) select generate_series(0, 6);

create table public.closed_dates (
  day date primary key,
  note text check (char_length(note) <= 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.kitchen_settings (
  id boolean primary key default true check (id), -- one row
  last_orders_minutes smallint not null default 30 check (last_orders_minutes in (0, 15, 30)),
  closed_early_on date,
  closed_early_at timestamptz,
  closed_early_by uuid references auth.users (id) on delete set null,
  till_number text check (till_number ~ '^[0-9]{5,10}$'),
  updated_at timestamptz not null default now()
);
insert into public.kitchen_settings default values;

create trigger kitchen_settings_touch before update on public.kitchen_settings
  for each row execute function public.touch_updated_at();

alter table public.opening_hours enable row level security;
alter table public.closed_dates enable row level security;
alter table public.kitchen_settings enable row level security;

-- Customers read none of these; they get kitchen_status() and the till line on their order.
create policy opening_hours_staff_read on public.opening_hours for select to authenticated using ((select public.is_staff()));
create policy opening_hours_owner_write on public.opening_hours for all to authenticated
  using ((select public.has_permission('hours'))) with check ((select public.has_permission('hours')));

create policy closed_dates_staff_read on public.closed_dates for select to authenticated using ((select public.is_staff()));
create policy closed_dates_owner_write on public.closed_dates for all to authenticated
  using ((select public.has_permission('hours'))) with check ((select public.has_permission('hours')));

-- kitchen_settings holds three kinds of setting in one row (last orders, close early, till
-- number), so it has no write policy: each is changed by its own RPC below, which checks
-- its own permission. Nobody writes the row directly.
create policy kitchen_settings_staff_read on public.kitchen_settings for select to authenticated using ((select public.is_staff()));

revoke all on public.opening_hours, public.closed_dates, public.kitchen_settings from anon;

-- ───────────────────────── status ─────────────────────────
-- What customers get at p_now. Taking the time as a parameter lets tests cover every boundary.
--   state:  'open' | 'closed'
--   reason: null when open, else before_opening | past_last_orders | after_closing |
--           closed_day | closed_date | closed_early
--   opens_at / last_order_at / closes_at: today's, null on a closed day or closed date.
--     Orders are taken from opens_at up to and including the minute of last_order_at.
--   next_open_date / next_opens_at: when ordering next opens. Today counts only before
--     opening (and not closed early). Null if nothing opens within 60 days.
--   after_today_open_date / after_today_opens_at: the next opening after today, which the
--     close-early card names ("Opens Monday at 11:00").
create function public.kitchen_status_at(p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local timestamp := p_now at time zone 'Africa/Nairobi';
  v_today date := v_local::date;
  v_set public.kitchen_settings;
  v_h public.opening_hours;
  v_is_closed_date boolean;
  v_early boolean;
  v_opens timestamp;
  v_closes timestamp;
  v_last timestamp;
  v_state text := 'closed';
  v_reason text;
  v_next_date date;
  v_next_opens timestamp;
  v_after_date date;
  v_after_opens timestamp;
  v_day date;
  v_row public.opening_hours;
begin
  select * into v_set from public.kitchen_settings where id;
  select * into v_h from public.opening_hours where weekday = extract(dow from v_today);
  v_is_closed_date := exists (select 1 from public.closed_dates where day = v_today);
  v_early := v_set.closed_early_on = v_today;

  if v_h.is_open and not v_is_closed_date then
    -- date + time handles closes = 24:00 (the next day's 00:00) without wrapping.
    v_opens := v_today + v_h.opens;
    v_closes := v_today + v_h.closes;
    v_last := v_closes - make_interval(mins => v_set.last_orders_minutes);
  end if;

  if v_is_closed_date then
    v_reason := 'closed_date';
  elsif not v_h.is_open then
    v_reason := 'closed_day';
  elsif v_early and v_local < v_closes then
    v_reason := 'closed_early';
  elsif v_local < v_opens then
    v_reason := 'before_opening';
  elsif v_local < v_last + interval '1 minute' then
    v_state := 'open';
  elsif v_local < v_closes then
    v_reason := 'past_last_orders';
  else
    v_reason := 'after_closing';
  end if;

  if v_reason = 'before_opening' then
    v_next_date := v_today;
    v_next_opens := v_opens;
  end if;

  for i in 1..60 loop
    v_day := v_today + i;
    select * into v_row from public.opening_hours where weekday = extract(dow from v_day);
    if v_row.is_open and not exists (select 1 from public.closed_dates where day = v_day) then
      v_after_date := v_day;
      v_after_opens := v_day + v_row.opens;
      exit;
    end if;
  end loop;

  if v_next_date is null then
    v_next_date := v_after_date;
    v_next_opens := v_after_opens;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'reason', v_reason,
    'today', v_today,
    'last_orders_minutes', v_set.last_orders_minutes,
    'opens_at', v_opens at time zone 'Africa/Nairobi',
    'last_order_at', v_last at time zone 'Africa/Nairobi',
    'closes_at', v_closes at time zone 'Africa/Nairobi',
    'closed_early_at', case when v_early then v_set.closed_early_at end,
    'next_open_date', v_next_date,
    'next_opens_at', v_next_opens at time zone 'Africa/Nairobi',
    'after_today_open_date', v_after_date,
    'after_today_opens_at', v_after_opens at time zone 'Africa/Nairobi');
end $$;

create function public.kitchen_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.kitchen_status_at(now())
$$;

-- ───────────────────────── owner RPCs ─────────────────────────
-- Close for the rest of today. Refused once there is nothing left to close.
create function public.close_early() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status jsonb;
begin
  if not public.has_permission('close_early') then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_status := public.kitchen_status();
  if v_status->>'reason' in ('after_closing', 'closed_day', 'closed_date') then
    raise exception 'The kitchen is already closed for today' using errcode = 'P0001';
  end if;
  -- A second tap keeps the first time.
  update public.kitchen_settings
    set closed_early_on = public.nairobi_today(), closed_early_at = now(), closed_early_by = auth.uid()
    where id and closed_early_on is distinct from public.nairobi_today();
  return public.kitchen_status();
end $$;

create function public.reopen_today() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('close_early') then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.kitchen_settings
    set closed_early_on = null, closed_early_at = null, closed_early_by = null
    where id and closed_early_on = public.nairobi_today();
  return public.kitchen_status();
end $$;

-- Saves the week and last orders together, so a half-saved week can't reach customers.
-- p_days: [{weekday, is_open, opens, closes}], all seven.
create function public.save_opening_hours(p_days jsonb, p_last_orders_minutes integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day jsonb;
begin
  if not public.has_permission('hours') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(jsonb_typeof(p_days), '') <> 'array' or jsonb_array_length(p_days) <> 7
     or (select count(distinct (d->>'weekday')::int) from jsonb_array_elements(p_days) d) <> 7 then
    raise exception 'Send all seven days' using errcode = 'P0001';
  end if;
  for v_day in select * from jsonb_array_elements(p_days) loop
    update public.opening_hours
      set is_open = (v_day->>'is_open')::boolean, opens = (v_day->>'opens')::time, closes = (v_day->>'closes')::time
      where weekday = (v_day->>'weekday')::smallint;
  end loop;
  update public.kitchen_settings set last_orders_minutes = p_last_orders_minutes where id;
  return public.kitchen_status();
exception
  when check_violation then
    raise exception 'Closing must be at least 1 hour after opening, and by midnight.' using errcode = 'P0001';
end $$;

-- Null or '' removes it.
create function public.set_till_number(p_till text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_till text := nullif(trim(coalesce(p_till, '')), '');
begin
  if not public.has_permission('till_number') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_till is not null and v_till !~ '^[0-9]{5,10}$' then
    raise exception 'A till number is 5 to 10 digits, with no spaces.' using errcode = 'P0001';
  end if;
  update public.kitchen_settings set till_number = v_till where id;
  return v_till;
end $$;

-- ───────────────────────── regular dishes: sold out for today only ─────────────────────────
alter table public.dishes add column unavailable_on date;
update public.dishes set unavailable_on = public.nairobi_today() where not regular_available;
alter table public.dishes drop column regular_available;

-- The one place "on sale today" is decided for a regular dish.
create function public.regular_on_sale(p_unavailable_on date) returns boolean
language sql stable set search_path = '' as $$
  select p_unavailable_on is distinct from public.nairobi_today()
$$;

-- On sale or sold out for today, on Nairobi's date. Who may toggle is unchanged (staff).
create function public.set_regular_on_sale(p_dish uuid, p_on_sale boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.dishes
    set unavailable_on = case when p_on_sale then null else public.nairobi_today() end
    where id = p_dish and is_regular and not archived;
  if not found then raise exception 'That dish isn’t a regular any more' using errcode = 'P0001'; end if;
end $$;

-- ───────────────────────── order status: the till line ─────────────────────────
-- Adds till_number, only while the order is unpaid and not cancelled. The current number,
-- since an old till may be gone.
create or replace function public.get_order_status(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', o.code,
    'status', o.status,
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
    'till_number', case when o.payment_status <> 'paid' and o.status <> 'cancelled'
                     then (select k.till_number from public.kitchen_settings k where k.id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes) order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;

-- ───────────────────────── grants ─────────────────────────
-- kitchen_status is public, like place_order. The owner RPCs are for signed-in users only
-- and check has_permission() themselves. kitchen_status_at is for tests and internal use.
revoke all on function public.kitchen_status_at(timestamptz) from public, anon, authenticated;
revoke all on function public.kitchen_status() from public;
grant execute on function public.kitchen_status() to anon, authenticated;
revoke all on function public.close_early() from public, anon;
revoke all on function public.reopen_today() from public, anon;
revoke all on function public.save_opening_hours(jsonb, integer) from public, anon;
revoke all on function public.set_till_number(text) from public, anon;
revoke all on function public.set_regular_on_sale(uuid, boolean) from public, anon;
grant execute on function public.close_early() to authenticated;
grant execute on function public.reopen_today() to authenticated;
grant execute on function public.save_opening_hours(jsonb, integer) to authenticated;
grant execute on function public.set_till_number(text) to authenticated;
grant execute on function public.set_regular_on_sale(uuid, boolean) to authenticated;
