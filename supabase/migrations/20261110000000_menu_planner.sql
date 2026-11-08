-- Slice 2.5, the menu planner (docs/plans/launch/spec-2.5-menu-planner.md, plan-2.5-menu-planner.md).
--
--   * menu_entry_off_days: a week dish's days off, so it can come off one day only;
--   * plates_per_day is 1 to 1,000, matching the dish form;
--   * one dish, once a day: a live entry can't share a date with another live entry for the same
--     dish, whatever their kinds, days off counted. Refused with 23505, the date in `detail` and
--     the other entry's kind in `hint`, so the dashboard can say which;
--   * todays_menu and place_order skip a week dish on its day off (nothing else changes in them);
--   * the planner's functions: add_menu_entry, update_menu_entry, remove_menu_entry,
--     restore_menu_entry, copy_menu_day (now returns what it did) and copy_menu_week_preview;
--   * menu_entry_undo: what each removal changed, held on the server, so an Undo reverses exactly
--     that and nothing the browser sends back (RQA25-01).
--
-- The planner's functions are security definer and check `is_staff()` themselves, the way 2.3's
-- copy_menu_day does, so they can write their own History line. 2.3's price rule is untouched:
-- guard_menu_entries reads the caller from the request, so it still judges every price they
-- write. Refusals are P0001 with a short code in `detail` (past, closed_day, two_weeks, one_day,
-- no_days, hours, plates, price, dish, gone), which the dashboard turns into the spec's wording.

-- ───────────────────────── days off ─────────────────────────
create table public.menu_entry_off_days (
  entry_id uuid not null references public.menu_entries (id) on delete cascade,
  day date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (entry_id, day)
);
alter table public.menu_entry_off_days enable row level security;
-- Readable wherever its entry is (customers: published entries, for todays_menu), written by staff.
create policy off_days_read on public.menu_entry_off_days for select
  using (exists (select from public.menu_entries e where e.id = entry_id));
create policy off_days_staff_write on public.menu_entry_off_days for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
revoke all on public.menu_entry_off_days from anon, authenticated;
grant select on public.menu_entry_off_days to anon, authenticated;
grant insert, delete on public.menu_entry_off_days to authenticated;

-- ───────────────────────── Undo records ─────────────────────────
-- One row per removal, written by remove_menu_entry. Its Undo hands back only the token; what
-- comes back is this row, once. No policies and no grants: only the planner's functions read it.
create table public.menu_entry_undo (
  token uuid primary key default gen_random_uuid(),
  did text not null check (did in ('deleted', 'unpublished', 'off_day', 'ended')),
  entry_id uuid not null,
  day date,
  ends_on date,
  saved jsonb,
  removed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.menu_entry_undo enable row level security;
revoke all on public.menu_entry_undo from anon, authenticated;

-- Only a week entry has days off, and only inside its own dates.
create function public.check_off_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.menu_entries;
begin
  select * into v_entry from public.menu_entries where id = new.entry_id;
  if v_entry.kind is distinct from 'week' or new.day not between v_entry.starts_on and v_entry.ends_on then
    raise exception 'A day off is only for a week dish, inside its dates' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger menu_entry_off_days_check before insert or update on public.menu_entry_off_days
  for each row execute function public.check_off_day();

-- ───────────────────────── plates ─────────────────────────
alter table public.menu_entries
  drop constraint menu_entries_plates_per_day_check,
  add constraint menu_entries_plates_per_day_check check (plates_per_day between 1 and 1000);

-- ───────────────────────── one dish, once a day ─────────────────────────
-- True if the dish is on the menu that day by any live entry, days off counted.
create function public.dish_live_on(p_dish uuid, p_day date, p_except uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.menu_entries e
    where e.dish_id = p_dish and e.id is distinct from p_except
      and e.published and e.ended_early_at is null
      and p_day between e.starts_on and e.ends_on
      and not exists (select from public.menu_entry_off_days o where o.entry_id = e.id and o.day = p_day))
$$;

-- The first date a live entry shares with another live entry for its dish, and that one's kind.
-- An overlap is at most a week, so the series is short.
create function public.entry_clash(p_entry uuid, out clash_day date, out other_kind public.entry_kind)
language sql stable security definer set search_path = '' as $$
  select g::date, o.kind
  from public.menu_entries e
  join public.menu_entries o
    on o.dish_id = e.dish_id and o.id <> e.id
   and o.published and o.ended_early_at is null
   and o.starts_on <= e.ends_on and o.ends_on >= e.starts_on
  cross join lateral generate_series(greatest(e.starts_on, o.starts_on), least(e.ends_on, o.ends_on), interval '1 day') g
  where e.id = p_entry and e.published and e.ended_early_at is null
    and not exists (select from public.menu_entry_off_days x where x.entry_id = e.id and x.day = g::date)
    and not exists (select from public.menu_entry_off_days x where x.entry_id = o.id and x.day = g::date)
  order by g
  limit 1
$$;

-- The clash refusal: "<dish> is already on the menu on <date>", the date in detail, the other
-- entry's kind in hint.
create function public.raise_clash(p_dish uuid, p_day date, p_kind public.entry_kind) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '% is already on the menu on %', public.dish_label(p_dish), p_day
    using errcode = '23505', detail = p_day::text, hint = coalesce(p_kind::text, 'day');
end $$;

-- The other live entry's kind on that day, for a refusal that came from the unique index.
create function public.clash_kind(p_dish uuid, p_day date, p_except uuid) returns public.entry_kind
language sql stable security definer set search_path = '' as $$
  select e.kind from public.menu_entries e
  where e.dish_id = p_dish and e.id is distinct from p_except
    and e.published and e.ended_early_at is null
    and p_day between e.starts_on and e.ends_on
    and not exists (select from public.menu_entry_off_days o where o.entry_id = e.id and o.day = p_day)
  limit 1
$$;

-- Deferred, so a week entry and its days off are judged together. The planner's functions make it
-- immediate before they return, so the refusal reaches the caller of that call.
create function public.one_dish_once_a_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_dish uuid;
  v record;
begin
  if tg_table_name = 'menu_entries' then
    v_id := new.id;
  else
    v_id := old.entry_id;
  end if;
  select * into v from public.entry_clash(v_id);
  if v.clash_day is not null then
    select dish_id into v_dish from public.menu_entries where id = v_id;
    perform public.raise_clash(v_dish, v.clash_day, v.other_kind);
  end if;
  return null;
end $$;
create constraint trigger menu_entries_once_a_day
  after insert or update of starts_on, ends_on, published, ended_early_at on public.menu_entries
  deferrable initially deferred
  for each row execute function public.one_dish_once_a_day();
create constraint trigger menu_entry_off_days_once_a_day
  after delete on public.menu_entry_off_days
  deferrable initially deferred
  for each row execute function public.one_dish_once_a_day();

-- ───────────────────────── customers: todays_menu ─────────────────────────
-- As 20261020000200_dish_photo_urls.sql, plus the day-off check.
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
  and public.nairobi_today() between e.starts_on and e.ends_on
  and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = public.nairobi_today());

-- ───────────────────────── customers: place_order ─────────────────────────
-- As 20261107001100_place_order_opening_hours.sql, plus the day-off check in the entry lookup.
-- Same signature and return type, so `create or replace` keeps the grants.
create or replace function public.place_order(p jsonb)
returns table (public_token uuid, code text, total_kes integer, replayed boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_mode public.order_mode := (p->>'mode')::public.order_mode;
  v_payment public.payment_method;
  v_table_id uuid;
  v_zone public.delivery_zones;
  v_fee integer := 0;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_item jsonb;
  v_qty integer;
  v_dish public.dishes;
  v_entry public.menu_entries;
  v_option public.dish_options;
  v_price integer;
  v_sold integer;
  v_manual boolean;
  v_today date := public.nairobi_today();
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_key_text text := p->>'idempotency_key';
  v_key uuid;
  v_pickup_at timestamptz;
  v_status jsonb;
begin
  -- The key comes first: a retry must get its order back even if the menu, the
  -- plates or the clock have moved on since the first attempt.
  if v_key_text is null or v_key_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Refresh the page and try again' using errcode = 'P0001';
  end if;
  v_key := v_key_text::uuid;

  -- Serialises calls with the same key until this transaction ends. A second call
  -- waits here, then finds the first call's order, or places its own if that rolled back.
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  return query select o.public_token, o.code, o.total_kes, true from public.orders o where o.idempotency_key = v_key;
  if found then
    return;
  end if;

  -- Opening hours, closed dates and close early, on Nairobi time (kitchen_status_at).
  v_status := public.kitchen_status();
  if v_status->>'state' <> 'open' then
    raise exception 'The kitchen is closed' using errcode = 'P0001', detail = 'kitchen_closed';
  end if;

  -- Launch takes no online payment (spec-2.1-payments.md): on handover for every order,
  -- or at the counter for dine-in. Checked after the key, so a retry of an older order
  -- still gets it back.
  if coalesce(p->>'payment_method', '') not in ('on_handover', 'at_counter') then
    raise exception 'Choose how you’ll pay' using errcode = 'P0001';
  end if;
  v_payment := (p->>'payment_method')::public.payment_method;
  if v_payment = 'at_counter' and v_mode is distinct from 'dine_in' then
    raise exception 'Pay at the counter is for orders at a table. Choose pay on handover.' using errcode = 'P0001';
  end if;

  if coalesce(jsonb_typeof(p->'items'), 'missing') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Your order is empty' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p->'items') > 30 then
    raise exception 'Too many items in one order' using errcode = 'P0001';
  end if;

  if v_mode = 'dine_in' then
    select t.id into v_table_id from public.dining_tables t
      where t.qr_token = p->>'table_token' and t.active;
    if v_table_id is null then
      raise exception 'Scan the QR code on your table again' using errcode = 'P0001';
    end if;
  elsif v_mode = 'delivery' then
    select * into v_zone from public.delivery_zones z
      where z.id = (p->>'delivery_zone_id')::uuid and z.active;
    if v_zone.id is null then
      raise exception 'Choose a delivery area' using errcode = 'P0001';
    end if;
    v_fee := v_zone.fee_kes;
  elsif v_mode = 'pickup' then
    v_pickup_at := nullif(p->>'pickup_at', '')::timestamptz;
    if v_pickup_at < now() then
      raise exception 'That pickup time has passed. Pick a later time.' using errcode = 'P0001', detail = 'pickup_time';
    end if;
    -- Open means today, so no later than today's closing also means today.
    if v_pickup_at > (v_status->>'closes_at')::timestamptz then
      raise exception 'We close at %. Pick an earlier time.',
        case when ((v_status->>'closes_at')::timestamptz at time zone 'Africa/Nairobi')::time = '00:00' then 'midnight'
             else to_char((v_status->>'closes_at')::timestamptz at time zone 'Africa/Nairobi', 'HH24:MI') end
        using errcode = 'P0001', detail = 'pickup_time';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Invalid quantity' using errcode = 'P0001';
    end if;

    select * into v_dish from public.dishes where id = (v_item->>'dish_id')::uuid and not archived;
    if v_dish.id is null then
      raise exception 'A dish in your order is no longer available' using errcode = 'P0001';
    end if;

    v_entry := null;
    if v_item ? 'menu_entry_id' and nullif(v_item->>'menu_entry_id', '') is not null then
      select * into v_entry from public.menu_entries e
        where e.id = (v_item->>'menu_entry_id')::uuid
          and e.dish_id = v_dish.id
          and e.published and e.ended_early_at is null
          and v_today between e.starts_on and e.ends_on
          and public.nairobi_time() between e.show_from and e.show_until
          and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = v_today);
      if v_entry.id is null then
        raise exception '% is not on the menu right now', v_dish.name using errcode = 'P0001';
      end if;

      insert into public.menu_entry_days (entry_id, day) values (v_entry.id, v_today)
        on conflict do nothing;
      select plates_sold, sold_out_manual into v_sold, v_manual
        from public.menu_entry_days where entry_id = v_entry.id and day = v_today for update;
      if v_manual or (v_entry.plates_per_day is not null and v_sold + v_qty > v_entry.plates_per_day) then
        raise exception 'Sorry, % has sold out', v_dish.name using errcode = 'P0001';
      end if;
      update public.menu_entry_days set plates_sold = plates_sold + v_qty
        where entry_id = v_entry.id and day = v_today;
      v_price := coalesce(v_entry.price_kes, v_dish.price_kes);
    else
      if not (v_dish.is_regular and public.regular_on_sale(v_dish.unavailable_on)) then
        raise exception '% is not available today', v_dish.name using errcode = 'P0001';
      end if;
      v_price := v_dish.price_kes;
    end if;

    v_option := null;
    if nullif(v_item->>'option_id', '') is not null then
      select * into v_option from public.dish_options o
        where o.id = (v_item->>'option_id')::uuid and o.dish_id = v_dish.id;
      if v_option.id is null then
        raise exception 'Invalid choice for %', v_dish.name using errcode = 'P0001';
      end if;
      v_price := v_price + v_option.price_delta_kes;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_dish.id, 'menu_entry_id', v_entry.id, 'option_id', v_option.id,
      'name', v_dish.name, 'option_label', v_option.label, 'unit_price_kes', v_price,
      'quantity', v_qty, 'note', left(nullif(trim(v_item->>'note'), ''), 200));
  end loop;

  insert into public.orders (
    mode, table_id, pickup_at, delivery_zone_id, delivery_address, delivery_notes,
    customer_name, customer_phone, payment_method, payment_status,
    subtotal_kes, delivery_fee_kes, total_kes, idempotency_key)
  values (
    v_mode, v_table_id,
    v_pickup_at,
    case when v_mode = 'delivery' then v_zone.id end,
    case when v_mode = 'delivery' then left(trim(p->>'delivery_address'), 300) end,
    case when v_mode = 'delivery' then left(nullif(trim(p->>'delivery_notes'), ''), 300) end,
    left(trim(p->>'customer_name'), 80), trim(p->>'customer_phone'), v_payment,
    'unpaid'::public.payment_status,
    v_subtotal, v_fee, v_subtotal + v_fee, v_key)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, dish_id, menu_entry_id, option_id, name, option_label, unit_price_kes, quantity, note)
    values (v_order_id, (v_line->>'dish_id')::uuid, nullif(v_line->>'menu_entry_id', '')::uuid,
            nullif(v_line->>'option_id', '')::uuid, v_line->>'name', v_line->>'option_label',
            (v_line->>'unit_price_kes')::integer, (v_line->>'quantity')::integer, v_line->>'note');
  end loop;

  return query select o.public_token, o.code, o.total_kes, false from public.orders o where o.id = v_order_id;
end $$;

-- ───────────────────────── 2.3's price rule, and Undo ─────────────────────────
-- As 2.3, except while restore_menu_entry puts back a removal the same person made (Q1 a): the
-- price going back is the one that was removed, so it isn't a price change.
create or replace function public.guard_menu_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.api_caller()
     and coalesce(current_setting('dausis.restoring', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.price_kes is not null)
          or (tg_op = 'UPDATE' and new.price_kes is distinct from old.price_kes))
     and not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ───────────────────────── shared checks ─────────────────────────
create function public.planner_refuse(p_message text, p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = 'P0001', detail = p_code;
end $$;

-- The days asked for, sorted and checked: at least one; one for a day dish; none past; one
-- Monday–Sunday week; no weekly closed day. A closed date is allowed (Q2 A).
create function public.planner_days(p_kind public.entry_kind, p_days date[]) returns date[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v date[];
begin
  select coalesce(array_agg(distinct d order by d), '{}') into v from unnest(coalesce(p_days, '{}')) d where d is not null;
  if cardinality(v) = 0 then perform public.planner_refuse('Tick at least one day.', 'no_days'); end if;
  if p_kind = 'day' and cardinality(v) > 1 then perform public.planner_refuse('A day dish is on one day.', 'one_day'); end if;
  if v[1] < public.nairobi_today() then perform public.planner_refuse('Past days can''t be changed.', 'past'); end if;
  if date_trunc('week', v[1]) <> date_trunc('week', v[cardinality(v)]) then
    perform public.planner_refuse('A week dish stays inside one week.', 'two_weeks');
  end if;
  if exists (select from unnest(v) d join public.opening_hours h on h.weekday = extract(dow from d)::int where not h.is_open) then
    perform public.planner_refuse('The kitchen is closed that day.', 'closed_day');
  end if;
  return v;
end $$;

create function public.planner_values(p_from time, p_until time, p_plates integer, p_price integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_until is null or p_until <= p_from then
    perform public.planner_refuse('Serving must end after it starts.', 'hours');
  end if;
  if p_plates is not null and p_plates not between 1 and 1000 then
    perform public.planner_refuse('Plates a day can be 1 to 1,000. Leave it empty for no limit.', 'plates');
  end if;
  if p_price is not null and p_price not between 0 and 100000 then
    perform public.planner_refuse('Price is in whole shillings, up to 100,000.', 'price');
  end if;
end $$;

-- The price to store: null for none or the dish's usual price, so a change of the usual price
-- carries through. Refuses a dish that can't be planned (missing, archived, everyday).
create function public.planner_price(p_dish uuid, p_price integer) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dish public.dishes;
begin
  select * into v_dish from public.dishes where id = p_dish;
  if v_dish.id is null or v_dish.archived or v_dish.is_regular then
    perform public.planner_refuse('That dish can''t be planned.', 'dish');
  end if;
  return case when p_price = v_dish.price_kes then null else p_price end;
end $$;

-- The planner's write functions call this first: only staff, and the clash check deferred until
-- they've written everything (a previous call in the same transaction may have made it immediate).
create function public.planner_begin() returns void
language plpgsql set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- Earlier writes in this transaction are judged first, so a refusal is about this call's rows.
  set constraints public.menu_entries_once_a_day, public.menu_entry_off_days_once_a_day immediate;
  set constraints public.menu_entries_once_a_day, public.menu_entry_off_days_once_a_day deferred;
end $$;

-- ...and this last: the clash check runs now, so its refusal is this call's.
create function public.planner_end() returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('dausis.bulk', '', true);
  perform set_config('dausis.restoring', '', true);
  set constraints public.menu_entries_once_a_day, public.menu_entry_off_days_once_a_day immediate;
end $$;

-- ───────────────────────── + Day and + Week ─────────────────────────
create function public.add_menu_entry(
  p_dish uuid, p_kind public.entry_kind, p_days date[], p_from time, p_until time, p_plates integer, p_price integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_days date[];
  v_price integer;
  v_first date;
  v_last date;
  v_entry public.menu_entries;
begin
  perform public.planner_begin();
  v_days := public.planner_days(p_kind, p_days);
  perform public.planner_values(p_from, p_until, p_plates, p_price);
  v_price := public.planner_price(p_dish, p_price);
  v_first := v_days[1];
  v_last := v_days[cardinality(v_days)];

  perform set_config('dausis.bulk', 'on', true);
  begin
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day, show_from, show_until, sort_order)
    values (p_dish, p_kind, v_first, v_last, v_price, p_plates, p_from, p_until,
            coalesce((select max(sort_order) from public.menu_entries where v_first between starts_on and ends_on), 0) + 1)
    returning * into v_entry;
  exception when unique_violation then
    perform public.raise_clash(p_dish, v_first, public.clash_kind(p_dish, v_first, null));
  end;
  insert into public.menu_entry_off_days (entry_id, day)
    select v_entry.id, g::date from generate_series(v_first, v_last, interval '1 day') g where g::date <> all (v_days);
  update public.dishes set last_served_on = greatest(coalesce(last_served_on, v_last), v_last) where id = p_dish;
  perform public.log_change('menu', 'entry.add', p_dish, public.dish_label(p_dish), null,
    public.entry_json(v_entry) || jsonb_build_object('days', to_jsonb(v_days)));
  perform public.planner_end();
  return v_entry.id;
end $$;

-- ───────────────────────── removing ─────────────────────────
-- What a removal saved, so restore_menu_entry can reverse exactly that.
create function public.entry_saved(e public.menu_entries) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(e) - 'id' - 'created_at')
    || jsonb_build_object('off', coalesce((select jsonb_agg(o.day order by o.day) from public.menu_entry_off_days o where o.entry_id = e.id), '[]'))
$$;

-- A day dish; a week dish's day `p_day` (a day off); or, with no day, a week dish from today on.
-- Deleted when no order points at it, otherwise unpublished, as 2.3 did. A week dish that started
-- before today ends yesterday instead, so its past days stay as they were.
-- Returns {did: deleted | unpublished | off_day | ended, entry, day, ends_on?, saved?}.
-- Stores what a removal did and returns it with the token its Undo hands back.
create function public.undo_record(p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  with r as (
    insert into public.menu_entry_undo (did, entry_id, day, ends_on, saved)
    values (p->>'did', (p->>'entry')::uuid, (p->>'day')::date, (p->>'ends_on')::date, p->'saved')
    returning token)
  select p || jsonb_build_object('token', (select token from r))
$$;

create function public.remove_menu_entry(p_entry uuid, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
  e public.menu_entries;
  v_after public.menu_entries;
  v_day date;
  v_saved jsonb;
begin
  perform public.planner_begin();
  select * into e from public.menu_entries where id = p_entry for update;
  if e.id is null or not e.published or e.ended_early_at is not null then
    perform public.planner_refuse('That dish was taken off meanwhile.', 'gone');
  end if;
  if e.ends_on < v_today or (p_day is not null and p_day < v_today) then
    perform public.planner_refuse('Past days can''t be changed.', 'past');
  end if;

  if e.kind = 'week' and p_day is not null then
    if p_day not between e.starts_on and e.ends_on
       or exists (select from public.menu_entry_off_days where entry_id = e.id and day = p_day) then
      perform public.planner_refuse('That dish was taken off meanwhile.', 'gone');
    end if;
    -- Any other day left from today on? Then it's that day only (History: the row trigger's line).
    if exists (select from generate_series(greatest(e.starts_on, v_today), e.ends_on, interval '1 day') g
               where g::date <> p_day
                 and not exists (select from public.menu_entry_off_days o where o.entry_id = e.id and o.day = g::date)) then
      insert into public.menu_entry_off_days (entry_id, day) values (e.id, p_day);
      perform public.planner_end();
      return public.undo_record(jsonb_build_object('did', 'off_day', 'entry', e.id, 'day', p_day));
    end if;
  end if;

  v_day := case when e.kind = 'day' then e.starts_on else greatest(e.starts_on, v_today) end;
  perform set_config('dausis.bulk', 'on', true);
  if e.kind = 'week' and e.starts_on < v_today then
    update public.menu_entries set ends_on = v_today - 1 where id = e.id returning * into v_after;
    perform public.log_change('menu', 'entry.remove', e.dish_id, public.dish_label(e.dish_id),
      public.entry_json(e) || jsonb_build_object('id', e.id, 'day', v_day), public.entry_json(v_after));
    perform public.planner_end();
    return public.undo_record(jsonb_build_object('did', 'ended', 'entry', e.id, 'day', v_day, 'ends_on', e.ends_on));
  end if;

  perform public.log_change('menu', 'entry.remove', e.dish_id, public.dish_label(e.dish_id),
    public.entry_json(e) || jsonb_build_object('id', e.id, 'day', v_day));
  if exists (select from public.order_items where menu_entry_id = e.id) then
    update public.menu_entries set published = false where id = e.id;
    perform public.planner_end();
    return public.undo_record(jsonb_build_object('did', 'unpublished', 'entry', e.id, 'day', v_day));
  end if;
  v_saved := public.entry_saved(e);
  delete from public.menu_entries where id = e.id;
  perform public.planner_end();
  return public.undo_record(jsonb_build_object('did', 'deleted', 'entry', e.id, 'day', v_day, 'saved', v_saved));
end $$;

-- ───────────────────────── Undo ─────────────────────────
-- Reverses exactly what remove_menu_entry did. Only `token` is read from `p_undo`: the rest comes
-- from the server's record of that removal (RQA25-01), so a changed dish, price, date or end can't
-- come back with it. Each record works once. 2.5b Q1 A: a removed one-day price goes back as it
-- was, whoever on the team taps Undo. If the dish went back on that day meanwhile, it's the clash
-- refusal.
create function public.restore_menu_entry(p_undo jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
  u public.menu_entry_undo;
  v_id uuid;
  v_did text;
  v_day date;
  s jsonb;
  e public.menu_entries;
begin
  perform public.planner_begin();
  if coalesce(p_undo->>'token', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform public.planner_refuse('That dish was changed meanwhile.', 'gone');
  end if;
  update public.menu_entry_undo set used_at = now()
    where token = (p_undo->>'token')::uuid and used_at is null
    returning * into u;
  if u.token is null then perform public.planner_refuse('That dish was changed meanwhile.', 'gone'); end if;
  v_id := u.entry_id; v_did := u.did; v_day := u.day; s := u.saved;
  if v_day is not null and v_day < v_today then
    perform public.planner_refuse('Past days can''t be changed.', 'past');
  end if;
  perform set_config('dausis.bulk', 'on', true);

  if v_did = 'off_day' then
    delete from public.menu_entry_off_days where entry_id = v_id and day = v_day;
    if not found then perform public.planner_refuse('That dish was changed meanwhile.', 'gone'); end if;
    select * into e from public.menu_entries where id = v_id;
  elsif v_did = 'ended' then
    update public.menu_entries set ends_on = u.ends_on
      where id = v_id and published and ended_early_at is null and ends_on = v_today - 1
      returning * into e;
  elsif v_did = 'unpublished' then
    begin
      update public.menu_entries set published = true
        where id = v_id and not published and ends_on >= v_today
        returning * into e;
    exception when unique_violation then
      select * into e from public.menu_entries where id = v_id;
      perform public.raise_clash(e.dish_id, e.starts_on, public.clash_kind(e.dish_id, e.starts_on, v_id));
    end;
  elsif v_did = 'deleted' then
    if (s->>'starts_on')::date < v_today then perform public.planner_refuse('Past days can''t be changed.', 'past'); end if;
    -- 2.5b Q1 A: the stored one-day price goes back as it was, whoever taps Undo.
    if s->'price_kes' <> 'null'::jsonb and not public.has_grant('dishes_prices') then
      perform set_config('dausis.restoring', 'on', true);
    end if;
    begin
      insert into public.menu_entries (id, dish_id, kind, starts_on, ends_on, price_kes, plates_per_day,
                                       show_from, show_until, auto_hide_sold_out, published, sort_order)
      values (v_id, (s->>'dish_id')::uuid, (s->>'kind')::public.entry_kind, (s->>'starts_on')::date, (s->>'ends_on')::date,
              (s->>'price_kes')::integer, (s->>'plates_per_day')::integer, (s->>'show_from')::time, (s->>'show_until')::time,
              coalesce((s->>'auto_hide_sold_out')::boolean, true), true, coalesce((s->>'sort_order')::integer, 0))
      returning * into e;
    exception when unique_violation then
      perform public.raise_clash((s->>'dish_id')::uuid, (s->>'starts_on')::date,
        public.clash_kind((s->>'dish_id')::uuid, (s->>'starts_on')::date, null));
    end;
    perform set_config('dausis.restoring', '', true);
    insert into public.menu_entry_off_days (entry_id, day)
      select v_id, d::date from jsonb_array_elements_text(coalesce(s->'off', '[]')) d;
  end if;

  if e.id is null then perform public.planner_refuse('That dish was changed meanwhile.', 'gone'); end if;
  perform public.log_change('menu', 'entry.restore', e.dish_id, public.dish_label(e.dish_id), null,
    public.entry_json(e) || jsonb_build_object('day', coalesce(v_day, e.starts_on)));
  perform public.planner_end();
  return e.id;
end $$;

-- ───────────────────────── editing ─────────────────────────
-- Hours, plates and price for every day the entry covers from today on, and for a week dish its
-- days (`p_days`, from today on; null keeps them). Q2 (a): a week dish stays one record, so its
-- past days show the current values; the edit is all in this function.
-- Returns null, or remove_menu_entry's result when no day is left.
create function public.update_menu_entry(
  p_entry uuid, p_from time, p_until time, p_plates integer, p_price integer, p_days date[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
  e public.menu_entries;
  v_price integer;
  v_days date[];
  v_start date;
  v_end date;
begin
  perform public.planner_begin();
  select * into e from public.menu_entries where id = p_entry for update;
  if e.id is null or not e.published or e.ended_early_at is not null then
    perform public.planner_refuse('That dish was taken off meanwhile.', 'gone');
  end if;
  if e.ends_on < v_today then perform public.planner_refuse('Past days can''t be changed.', 'past'); end if;
  perform public.planner_values(p_from, p_until, p_plates, p_price);
  v_price := public.planner_price(e.dish_id, p_price);

  if e.kind = 'week' and p_days is not null then
    if cardinality(array_remove(p_days, null)) = 0 then
      return public.remove_menu_entry(e.id, null);
    end if;
    v_days := public.planner_days('week', p_days);
    if date_trunc('week', v_days[1]) <> date_trunc('week', e.starts_on) then
      perform public.planner_refuse('A week dish stays inside one week.', 'two_weeks');
    end if;
    -- starts_on moves only while it's still ahead, and never before today.
    v_start := case when e.starts_on >= v_today then v_days[1] else e.starts_on end;
    v_end := v_days[cardinality(v_days)];
    -- Days off past the new end, or before a new start, go with the dates: not a change of their own.
    perform set_config('dausis.bulk', 'on', true);
    delete from public.menu_entry_off_days where entry_id = e.id and (day > v_end or day < v_start);
    perform set_config('dausis.bulk', '', true);
    update public.menu_entries set starts_on = v_start, ends_on = v_end where id = e.id;
    -- From today on: ticked days lose their day off, unticked ones get one.
    delete from public.menu_entry_off_days where entry_id = e.id and day >= v_today and day = any (v_days);
    insert into public.menu_entry_off_days (entry_id, day)
      select e.id, g::date from generate_series(greatest(v_start, v_today), v_end, interval '1 day') g
      where g::date <> all (v_days)
      on conflict do nothing;
  end if;

  update public.menu_entries
     set show_from = p_from, show_until = p_until, plates_per_day = p_plates,
         price_kes = case when v_price is distinct from e.price_kes then v_price else price_kes end
   where id = e.id;
  perform public.planner_end();
  return null;
end $$;

-- ───────────────────────── copying a day ─────────────────────────
-- The source day's live day dishes that a copy onto p_to would add: not archived, not already on
-- p_to by any entry. Shared by the copy and its preview.
create function public.copyable(p_from date, p_to date) returns setof public.menu_entries
language sql stable security definer set search_path = '' as $$
  select e.* from public.menu_entries e
  join public.dishes d on d.id = e.dish_id
  where e.kind = 'day' and e.starts_on = p_from and e.published and e.ended_early_at is null
    and not d.archived
    and not public.dish_live_on(e.dish_id, p_to)
$$;

drop function public.copy_menu_day(date, date);
create function public.copy_menu_day(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prices boolean := public.has_grant('dishes_prices');
  v_hours public.opening_hours;
  v_count integer;
  v_archived jsonb;
  v_outside jsonb;
  v_priced jsonb;
begin
  perform public.planner_begin();
  if p_to < public.nairobi_today() then perform public.planner_refuse('Past days can''t be changed.', 'past'); end if;
  select * into v_hours from public.opening_hours where weekday = extract(dow from p_to)::int;
  if not coalesce(v_hours.is_open, true) then perform public.planner_refuse('The kitchen is closed that day.', 'closed_day'); end if;

  select coalesce(jsonb_agg(d.name order by d.name), '[]') into v_archived
    from public.menu_entries e join public.dishes d on d.id = e.dish_id
   where e.kind = 'day' and e.starts_on = p_from and e.published and e.ended_early_at is null and d.archived;

  perform set_config('dausis.bulk', 'on', true);
  with ins as (
    insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day,
                                     show_from, show_until, auto_hide_sold_out, published, sort_order)
    select c.dish_id, 'day', p_to, p_to, case when v_prices then c.price_kes end, c.plates_per_day,
           c.show_from, c.show_until, c.auto_hide_sold_out, true, c.sort_order
    from public.copyable(p_from, p_to) c
    on conflict do nothing
    returning dish_id, show_from, show_until, sort_order
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('name', public.dish_label(ins.dish_id),
                                               'from', to_char(ins.show_from, 'HH24:MI'),
                                               'until', to_char(ins.show_until, 'HH24:MI'))
                            order by public.dish_label(ins.dish_id))
                  filter (where v_hours.weekday is not null
                            and (ins.show_from < v_hours.opens or ins.show_until > v_hours.closes)), '[]'),
         -- RQA25-02: the copied dishes that had a one-day price on p_from, and the price each has now
         -- (that one-day price when kept, else the usual price), for the note's price line.
         coalesce(jsonb_agg(jsonb_build_object('name', public.dish_label(ins.dish_id),
                                               'price', case when v_prices then src.price_kes else d.price_kes end)
                            order by ins.sort_order, public.dish_label(ins.dish_id))
                  filter (where src.price_kes is not null), '[]')
    into v_count, v_outside, v_priced
    from ins
    join public.dishes d on d.id = ins.dish_id
    left join public.menu_entries src
      on src.dish_id = ins.dish_id and src.kind = 'day' and src.starts_on = p_from
     and src.published and src.ended_early_at is null;
  if v_count > 0 then
    perform public.log_change('menu', 'menu.copy_day', null, null, null,
      jsonb_build_object('from', p_from, 'to', p_to, 'count', v_count));
  end if;
  perform public.planner_end();
  return jsonb_build_object('copied', v_count, 'archived', v_archived, 'outside_hours', v_outside,
                            'prices', jsonb_build_object('kept', v_prices, 'dishes', v_priced));
end $$;

-- For each open day of the week from today on, how many dishes each copy button would add:
-- {"2026-11-10": {"prev": 3, "last_week": 0}, ...}. Read only; one call per page load.
create function public.copy_menu_week_preview(p_week_start date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.is_staff() then null else coalesce(jsonb_object_agg(d::date::text, jsonb_build_object(
           'prev', (select count(*) from public.copyable(d::date - 1, d::date)),
           'last_week', (select count(*) from public.copyable(d::date - 7, d::date)))), '{}') end
  from generate_series(date_trunc('week', p_week_start), date_trunc('week', p_week_start) + interval '6 days', interval '1 day') d
  join public.opening_hours h on h.weekday = extract(dow from d)::int and h.is_open
  where d::date >= public.nairobi_today()
$$;

-- ───────────────────────── History ─────────────────────────
-- A week dish's day off, made or taken back outside the planner's own lines.
create function public.log_menu_entry_off_days() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dish uuid;
  v_row public.menu_entry_off_days := coalesce(new, old);
begin
  if not public.row_logging() then return null; end if;
  select dish_id into v_dish from public.menu_entries where id = v_row.entry_id;
  if v_dish is null then return null; end if; -- its entry is being deleted: that line covers it
  perform public.log_change('menu', case when tg_op = 'INSERT' then 'entry.off_day' else 'entry.day_back' end,
    v_dish, public.dish_label(v_dish), null, jsonb_build_object('day', v_row.day, 'entry', v_row.entry_id));
  return null;
end $$;
create trigger menu_entry_off_days_log after insert or delete on public.menu_entry_off_days
  for each row execute function public.log_menu_entry_off_days();

-- ───────────────────────── grants ─────────────────────────
revoke all on function public.check_off_day() from public, anon, authenticated;
revoke all on function public.one_dish_once_a_day() from public, anon, authenticated;
revoke all on function public.log_menu_entry_off_days() from public, anon, authenticated;
revoke all on function public.dish_live_on(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.entry_clash(uuid) from public, anon, authenticated;
revoke all on function public.raise_clash(uuid, date, public.entry_kind) from public, anon, authenticated;
revoke all on function public.clash_kind(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.planner_refuse(text, text) from public, anon, authenticated;
revoke all on function public.planner_days(public.entry_kind, date[]) from public, anon, authenticated;
revoke all on function public.planner_values(time, time, integer, integer) from public, anon, authenticated;
revoke all on function public.planner_price(uuid, integer) from public, anon, authenticated;
revoke all on function public.planner_begin() from public, anon, authenticated;
revoke all on function public.planner_end() from public, anon, authenticated;
revoke all on function public.entry_saved(public.menu_entries) from public, anon, authenticated;
revoke all on function public.undo_record(jsonb) from public, anon, authenticated;
revoke all on function public.copyable(date, date) from public, anon, authenticated;

revoke all on function public.add_menu_entry(uuid, public.entry_kind, date[], time, time, integer, integer) from public, anon;
revoke all on function public.update_menu_entry(uuid, time, time, integer, integer, date[]) from public, anon;
revoke all on function public.remove_menu_entry(uuid, date) from public, anon;
revoke all on function public.restore_menu_entry(jsonb) from public, anon;
revoke all on function public.copy_menu_day(date, date) from public, anon;
revoke all on function public.copy_menu_week_preview(date) from public, anon;
grant execute on function public.add_menu_entry(uuid, public.entry_kind, date[], time, time, integer, integer) to authenticated;
grant execute on function public.update_menu_entry(uuid, time, time, integer, integer, date[]) to authenticated;
grant execute on function public.remove_menu_entry(uuid, date) to authenticated;
grant execute on function public.restore_menu_entry(jsonb) to authenticated;
grant execute on function public.copy_menu_day(date, date) to authenticated;
grant execute on function public.copy_menu_week_preview(date) to authenticated;
