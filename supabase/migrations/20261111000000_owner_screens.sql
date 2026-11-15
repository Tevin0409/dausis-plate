-- Slice 2.6: owner screens (docs/plans/launch/spec-2.6-owner-screens.md, "Build notes: Migration").
--   * delivery_zones: a food-only minimum order (Q1 A) and the fee's upper limit;
--   * dish_options: choices and extras (Q2 B), archived instead of deleted once ordered, out today
--     (Q3 B), with their rules; order_item_extras records what was paid for;
--   * place_order: extras, archived and out-today options, a missing choice, the zone minimum;
--   * todays_menu: a dish whose every choice is out today is sold out;
--   * set_option_out, save_dish_options, dish_has_orders, restore_dish;
--   * kitchen_settings.phone (Q4 A), shown on the order status page with the extras;
--   * staff: must_change_password (Q5 A) and invited_at, and the owner's team RPCs.
-- Go-live: run supabase/preflight/2.6-owner-screens.sql (read-only) first; it lists existing rows the new checks refuse.

-- ───────────────────────── delivery zones ─────────────────────────
alter table public.delivery_zones
  add column min_order_kes integer not null default 0 check (min_order_kes between 0 and 20000),
  add constraint delivery_zones_fee_limit check (fee_kes between 0 and 5000);

create or replace function public.log_delivery_zones() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('tables', 'zone.add', new.id, new.name, null,
      jsonb_build_object('fee', new.fee_kes, 'minimum', new.min_order_kes));
  elsif tg_op = 'DELETE' then
    perform public.log_change('tables', 'zone.delete', old.id, old.name);
  else
    if new.name is distinct from old.name then
      perform public.log_change('tables', 'zone.rename', new.id, new.name,
        jsonb_build_object('name', old.name), jsonb_build_object('name', new.name));
    end if;
    if new.fee_kes is distinct from old.fee_kes then
      perform public.log_change('tables', 'zone.fee', new.id, new.name,
        jsonb_build_object('fee', old.fee_kes), jsonb_build_object('fee', new.fee_kes));
    end if;
    if new.min_order_kes is distinct from old.min_order_kes then
      perform public.log_change('tables', 'zone.minimum', new.id, new.name,
        jsonb_build_object('minimum', old.min_order_kes), jsonb_build_object('minimum', new.min_order_kes));
    end if;
    if new.active is distinct from old.active then
      perform public.log_change('tables', case when new.active then 'zone.on' else 'zone.off' end, new.id, new.name);
    end if;
    if new.sort_order is distinct from old.sort_order then
      perform public.log_change('tables', 'zone.order', new.id, new.name,
        jsonb_build_object('order', old.sort_order), jsonb_build_object('order', new.sort_order));
    end if;
  end if;
  return null;
end $$;

-- ───────────────────────── dish options ─────────────────────────
-- Today's rows stay choices. out_on is the Nairobi day it's out; any other day it's in, so it
-- comes back by itself at midnight and nothing has to run.
alter table public.dish_options
  add column kind text not null default 'choice' check (kind in ('choice', 'extra')),
  add column archived boolean not null default false,
  add column out_on date,
  add constraint dish_options_price_limit check (price_delta_kes between 0 and 2000),
  add constraint dish_options_extra_priced check (kind = 'choice' or price_delta_kes >= 1),
  add constraint dish_options_extra_no_default check (kind = 'choice' or not is_default);

-- Labels are unique within a dish among the options customers can still pick.
create unique index dish_options_label_once on public.dish_options (dish_id, lower(btrim(label))) where not archived;
-- At most one default per dish. The spec asked for a trigger; a unique index holds the same rule
-- and also when two saves race.
create unique index dish_options_one_default on public.dish_options (dish_id)
  where is_default and not archived and kind = 'choice';

create function public.option_out_today(p_out_on date) returns boolean
language sql stable set search_path = '' as $$
  select p_out_on is not null and p_out_on = public.nairobi_today()
$$;

-- True when the dish has choices and every one of them is out today.
create function public.choices_all_out(p_dish uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.dish_options o where o.dish_id = p_dish and o.kind = 'choice' and not o.archived)
     and not exists (select from public.dish_options o where o.dish_id = p_dish and o.kind = 'choice' and not o.archived
                     and not public.option_out_today(o.out_on))
$$;
grant execute on function public.choices_all_out(uuid) to anon, authenticated;

-- 2.3's guard, except inside set_option_out, which any staff may call.
create or replace function public.guard_dish_options() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('dausis.option_out', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if public.api_caller() and not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- 2.3's one line per save. Out today writes its own line (set_option_out).
create or replace function public.log_dish_options() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dish uuid := coalesce(new.dish_id, old.dish_id);
  v_name text := public.dish_label(v_dish);
begin
  if not public.row_logging() or v_name is null
     or coalesce(current_setting('dausis.option_out', true), '') = 'on'
     or public.logged_in_tx(v_dish, array['dish.options', 'dish.add']) then
    return null;
  end if;
  perform public.log_change('menu', 'dish.options', v_dish, v_name);
  return null;
end $$;

-- ───────────────────────── extras on an order ─────────────────────────
create table public.order_item_extras (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  option_id uuid not null references public.dish_options (id), -- ordered extras are archived, never deleted
  label text not null,      -- a copy at the time of the order
  price_kes integer not null check (price_kes >= 0),
  sort_order smallint not null default 0
);
create index order_item_extras_item_idx on public.order_item_extras (order_item_id);
create index order_item_extras_option_idx on public.order_item_extras (option_id);

alter table public.order_item_extras enable row level security;
-- As order_items: staff read; customers see them through get_order_status; only place_order writes.
create policy order_item_extras_staff on public.order_item_extras for select to authenticated using ((select public.is_staff()));
revoke all on public.order_item_extras from anon, authenticated;
grant select on public.order_item_extras to authenticated;

-- ───────────────────────── archived date ─────────────────────────
-- For "Archived 4 Nov" in the Archived list.
alter table public.dishes add column archived_at timestamptz;

create function public.stamp_dish_archived() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := now();
  elsif not new.archived then
    new.archived_at := null;
  end if;
  return new;
end $$;
create trigger dishes_stamp_archived before insert or update of archived on public.dishes
  for each row execute function public.stamp_dish_archived();
revoke all on function public.stamp_dish_archived() from public, anon, authenticated;

-- Dishes archived before this release: the History's date when there is one, else the last update.
update public.dishes d set archived_at = coalesce(
    (select max(c.at) from public.change_log c where c.subject_id = d.id and c.action = 'dish.archive'), d.updated_at)
  where d.archived;

-- ───────────────────────── customers: todays_menu ─────────────────────────
-- As 20261110000000_menu_planner.sql, plus: every choice out today is sold out.
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
    or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)
    or public.choices_all_out(d.id)) as sold_out,
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
-- As 20261110000000_menu_planner.sql, plus choices and extras (Q2 B), out today (Q3 B) and the
-- zone minimum (Q1 A). Same signature and return type, so `create or replace` keeps the grants.
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
  v_item_id uuid;
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
  v_has_choices boolean;
  v_extra_ids jsonb;
  v_extra_count integer;
  v_extras jsonb;
  v_extra_sum integer;
  v_out_label text;
begin
  -- The key comes first: a retry must get its order back even if the menu, the
  -- plates or the clock have moved on since the first attempt.
  if v_key_text is null or v_key_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Refresh the page and try again' using errcode = 'P0001';
  end if;
  v_key := v_key_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  return query select o.public_token, o.code, o.total_kes, true from public.orders o where o.idempotency_key = v_key;
  if found then
    return;
  end if;

  v_status := public.kitchen_status();
  if v_status->>'state' <> 'open' then
    raise exception 'The kitchen is closed' using errcode = 'P0001', detail = 'kitchen_closed';
  end if;

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

    -- The choice: exactly one when the dish has choices, none otherwise.
    v_has_choices := exists (select from public.dish_options o where o.dish_id = v_dish.id and o.kind = 'choice' and not o.archived);
    if v_has_choices and public.choices_all_out(v_dish.id) then
      raise exception 'Sorry, % has sold out', v_dish.name using errcode = 'P0001';
    end if;
    v_option := null;
    if nullif(v_item->>'option_id', '') is not null then
      select * into v_option from public.dish_options o
        where o.id = (v_item->>'option_id')::uuid and o.dish_id = v_dish.id and o.kind = 'choice';
      if v_option.id is null then
        raise exception 'Invalid choice for %', v_dish.name using errcode = 'P0001';
      end if;
      if v_option.archived then
        raise exception 'That choice isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'choice_gone';
      end if;
      if public.option_out_today(v_option.out_on) then
        raise exception 'Sorry, % has run out today. Choose another side for %.', v_option.label, v_dish.name
          using errcode = 'P0001', detail = 'option_out';
      end if;
      v_price := v_price + v_option.price_delta_kes;
    elsif v_has_choices then
      raise exception 'Choose a side for %', v_dish.name using errcode = 'P0001', detail = 'choice_missing';
    end if;

    -- Extras: any number up to 8, each once, each a live extra of this dish, none out today.
    v_extras := '[]'::jsonb;
    v_extra_sum := 0;
    v_extra_ids := v_item->'extra_ids';
    if v_extra_ids is not null and jsonb_typeof(v_extra_ids) <> 'null' then
      if jsonb_typeof(v_extra_ids) <> 'array'
         or jsonb_array_length(v_extra_ids) > 8
         or exists (select from jsonb_array_elements(v_extra_ids) x
                    where jsonb_typeof(x) <> 'string'
                       or x #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'That extra isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'extra_gone';
      end if;
      v_extra_count := jsonb_array_length(v_extra_ids);
      if v_extra_count > 0 then
        if (select count(distinct (x #>> '{}')::uuid) from jsonb_array_elements(v_extra_ids) x) <> v_extra_count
           or (select count(*) from public.dish_options o
               where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x)
                 and o.dish_id = v_dish.id and o.kind = 'extra' and not o.archived) <> v_extra_count then
          raise exception 'That extra isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'extra_gone';
        end if;
        select o.label into v_out_label from public.dish_options o
          where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x)
            and public.option_out_today(o.out_on)
          order by o.sort_order, o.label limit 1;
        if v_out_label is not null then
          raise exception 'Sorry, % has run out today. Remove it from % and try again.', v_out_label, v_dish.name
            using errcode = 'P0001', detail = 'option_out';
        end if;
        select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'label', o.label, 'price_kes', o.price_delta_kes)
                                  order by o.sort_order, o.label), '[]'::jsonb),
               coalesce(sum(o.price_delta_kes), 0)
          into v_extras, v_extra_sum
          from public.dish_options o
          where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x);
        v_price := v_price + v_extra_sum;
      end if;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_dish.id, 'menu_entry_id', v_entry.id, 'option_id', v_option.id,
      'name', v_dish.name, 'option_label', v_option.label, 'unit_price_kes', v_price,
      'quantity', v_qty, 'note', left(nullif(trim(v_item->>'note'), ''), 200),
      'extras', v_extras);
  end loop;

  -- The minimum counts the food only, before the delivery fee (Q1 A).
  if v_mode = 'delivery' and v_subtotal < v_zone.min_order_kes then
    raise exception 'Your order is under %''s KSh % minimum for delivery. Add more, or choose pickup.',
      v_zone.name, to_char(v_zone.min_order_kes, 'FM99,999')
      using errcode = 'P0001', detail = 'under_minimum';
  end if;

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
            (v_line->>'unit_price_kes')::integer, (v_line->>'quantity')::integer, v_line->>'note')
    returning id into v_item_id;
    insert into public.order_item_extras (order_item_id, option_id, label, price_kes, sort_order)
      select v_item_id, (x->>'option_id')::uuid, x->>'label', (x->>'price_kes')::integer, (n - 1)::smallint
      from jsonb_array_elements(v_line->'extras') with ordinality as e(x, n);
  end loop;

  return query select o.public_token, o.code, o.total_kes, false from public.orders o where o.id = v_order_id;
end $$;

-- ───────────────────────── out today (Q3 B) ─────────────────────────
-- Anyone on the team. The only write staff without Dishes and prices make to dish_options.
create function public.set_option_out(p_option uuid, p_out boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_opt public.dish_options;
  v_today date := public.nairobi_today();
  v_was boolean;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_opt from public.dish_options where id = p_option and not archived for update;
  if v_opt.id is null then
    raise exception 'That choice isn''t there any more. Refresh the page.' using errcode = 'P0001', detail = 'missing';
  end if;
  v_was := public.option_out_today(v_opt.out_on);
  if coalesce(p_out, false) <> v_was then
    perform set_config('dausis.option_out', 'on', true);
    update public.dish_options set out_on = case when p_out then v_today end where id = p_option;
    perform set_config('dausis.option_out', '', true);
    perform public.log_change('menu', case when p_out then 'option.out' else 'option.in' end,
      v_opt.dish_id, public.dish_label(v_opt.dish_id), null, jsonb_build_object('option', v_opt.label, 'kind', v_opt.kind));
  end if;
  return jsonb_build_object('out', coalesce(p_out, false), 'all_choices_out', public.choices_all_out(v_opt.dish_id));
end $$;
revoke all on function public.set_option_out(uuid, boolean) from public, anon;
grant execute on function public.set_option_out(uuid, boolean) to authenticated;

-- ───────────────────────── saving a dish's options ─────────────────────────
-- p_options: [{id?, kind, label, extra, isDefault, sortOrder}], the whole list for the dish.
-- Runs as the caller, so 2.3's guard and RLS decide who may (Dishes and prices).
create function public.save_dish_options(p_dish uuid, p_options jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_rows jsonb;
  v_n_choice integer;
  v_n_extra integer;
  v_default uuid;
  v_default_pos integer;
  v_changed boolean := false;
  v_count integer;
  r record;
  v_new_id uuid;
begin
  if not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  perform from public.dishes where id = p_dish for update;
  if not found then raise exception 'That dish isn''t there any more.' using errcode = 'P0001', detail = 'missing'; end if;
  if coalesce(jsonb_typeof(p_options), 'null') <> 'array' then
    raise exception 'Something went wrong saving the options. Refresh the page.' using errcode = 'P0001', detail = 'shape';
  end if;

  -- Normalise: trimmed labels, position as given.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', nullif(x->>'id', ''),
           'kind', x->>'kind',
           'label', btrim(coalesce(x->>'label', '')),
           'extra', coalesce(nullif(x->>'extra', '')::numeric, 0),
           'isDefault', coalesce((x->>'isDefault')::boolean, false),
           'pos', n) order by n), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(p_options) with ordinality as t(x, n);

  if exists (select from jsonb_array_elements(v_rows) x where x->>'kind' is null or x->>'kind' not in ('choice', 'extra')) then
    raise exception 'Something went wrong saving the options. Refresh the page.' using errcode = 'P0001', detail = 'shape';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x where x->>'label' = '') then
    raise exception 'Each choice and extra needs a name.' using errcode = 'P0001', detail = 'label';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x where char_length(x->>'label') > 40) then
    raise exception 'A name can be up to 40 characters.' using errcode = 'P0001', detail = 'label';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x
             where (x->>'extra')::numeric <> trunc((x->>'extra')::numeric) or (x->>'extra')::numeric < 0) then
    raise exception 'A price is in whole shillings.' using errcode = 'P0001', detail = 'price';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x where (x->>'extra')::numeric > 2000) then
    raise exception 'A price can be up to KSh 2,000.' using errcode = 'P0001', detail = 'price';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x where x->>'kind' = 'extra' and (x->>'extra')::numeric < 1) then
    raise exception 'An extra needs a price. If it''s free, make it a choice or put it in the description.'
      using errcode = 'P0001', detail = 'free_extra';
  end if;
  select count(*) filter (where x->>'kind' = 'choice'), count(*) filter (where x->>'kind' = 'extra')
    into v_n_choice, v_n_extra from jsonb_array_elements(v_rows) x;
  if v_n_choice = 1 then
    raise exception 'Add a second choice, or remove this one. With one, there''s nothing to choose.'
      using errcode = 'P0001', detail = 'one_choice';
  end if;
  if v_n_choice > 8 then
    raise exception 'Eight choices is the most a dish can have.' using errcode = 'P0001', detail = 'too_many';
  end if;
  if v_n_extra > 8 then
    raise exception 'Eight extras is the most a dish can have.' using errcode = 'P0001', detail = 'too_many';
  end if;
  if (select count(distinct lower(x->>'label')) from jsonb_array_elements(v_rows) x) <> jsonb_array_length(v_rows) then
    raise exception 'Each choice and extra needs a different name.' using errcode = 'P0001', detail = 'duplicate';
  end if;
  if exists (select from jsonb_array_elements(v_rows) x where x->>'id' is not null
             and x->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or (select count(distinct x->>'id') from jsonb_array_elements(v_rows) x where x->>'id' is not null)
        <> (select count(*) from jsonb_array_elements(v_rows) x where x->>'id' is not null)
     or exists (select from jsonb_array_elements(v_rows) x where x->>'id' is not null
                and not exists (select from public.dish_options o
                                where o.id = (x->>'id')::uuid and o.dish_id = p_dish and not o.archived)) then
    raise exception 'These options changed since you opened the dish. Refresh the page and try again.'
      using errcode = 'P0001', detail = 'stale';
  end if;

  -- The default: the first choice marked, else the first choice.
  select coalesce(
           (select (x->>'pos')::int from jsonb_array_elements(v_rows) x where x->>'kind' = 'choice' and (x->>'isDefault')::boolean
             order by (x->>'pos')::int limit 1),
           (select (x->>'pos')::int from jsonb_array_elements(v_rows) x where x->>'kind' = 'choice' order by (x->>'pos')::int limit 1))
    into v_default_pos;

  -- 1. Removed: deleted when never ordered, else archived so old orders keep it.
  for r in select o.id from public.dish_options o
           where o.dish_id = p_dish and not o.archived
             and o.id not in (select (x->>'id')::uuid from jsonb_array_elements(v_rows) x where x->>'id' is not null) loop
    v_changed := true;
    if exists (select from public.order_items i where i.option_id = r.id)
       or exists (select from public.order_item_extras e where e.option_id = r.id) then
      update public.dish_options set archived = true, is_default = false where id = r.id;
    else
      delete from public.dish_options where id = r.id;
    end if;
  end loop;

  -- 2. Make room: clear defaults that move, and park labels that change (two labels can swap).
  update public.dish_options o set is_default = false
    from jsonb_array_elements(v_rows) x
    where x->>'id' is not null and o.id = (x->>'id')::uuid and o.is_default
      and (x->>'pos')::int is distinct from v_default_pos;
  get diagnostics v_count = row_count;
  v_changed := v_changed or v_count > 0;
  update public.dish_options o set label = o.id::text
    from jsonb_array_elements(v_rows) x
    where x->>'id' is not null and o.id = (x->>'id')::uuid and o.label <> x->>'label';

  -- 3. Update the kept ones where something differs.
  update public.dish_options o set
      kind = x->>'kind',
      label = x->>'label',
      price_delta_kes = (x->>'extra')::numeric::integer,
      is_default = coalesce((x->>'pos')::int = v_default_pos, false),
      sort_order = (x->>'pos')::int
    from jsonb_array_elements(v_rows) x
    where x->>'id' is not null and o.id = (x->>'id')::uuid
      and (o.kind, o.label, o.price_delta_kes, o.is_default, o.sort_order)
          is distinct from (x->>'kind', x->>'label', (x->>'extra')::numeric::integer, coalesce((x->>'pos')::int = v_default_pos, false), (x->>'pos')::int);
  get diagnostics v_count = row_count;
  v_changed := v_changed or v_count > 0;

  -- 4. Add the new ones.
  insert into public.dish_options (dish_id, kind, label, price_delta_kes, is_default, sort_order)
    select p_dish, x->>'kind', x->>'label', (x->>'extra')::numeric::integer, coalesce((x->>'pos')::int = v_default_pos, false), (x->>'pos')::int
    from jsonb_array_elements(v_rows) x where x->>'id' is null
    order by (x->>'pos')::int;
  get diagnostics v_count = row_count;
  v_changed := v_changed or v_count > 0;

  return jsonb_build_object('changed', v_changed);
end $$;
revoke all on function public.save_dish_options(uuid, jsonb) from public, anon;
grant execute on function public.save_dish_options(uuid, jsonb) to authenticated;

-- ───────────────────────── delete wording and restore ─────────────────────────
create function public.dish_has_orders(p_dish uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  return exists (select from public.order_items where dish_id = p_dish);
end $$;
revoke all on function public.dish_has_orders(uuid) from public, anon;
grant execute on function public.dish_has_orders(uuid) to authenticated;

-- Back to the dish list, on no menu: not everyday, and its planned days stay unpublished.
-- log_dishes writes "restored Pilau".
create function public.restore_dish(p_dish uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_name text;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  update public.dishes set archived = false where id = p_dish and archived returning name into v_name;
  return jsonb_build_object('result', case when v_name is null then 'missing' else 'restored' end, 'name', v_name);
end $$;
revoke all on function public.restore_dish(uuid) from public, anon;
grant execute on function public.restore_dish(uuid) to authenticated;

-- ───────────────────────── kitchen phone (Q4 A) ─────────────────────────
alter table public.kitchen_settings
  add column phone text check (phone ~ '^\+254[1-7][0-9]{8}$');

-- The app normalises what Mama types (src/lib/kitchen-phone.ts); this takes +254 and 9 digits only.
create function public.set_kitchen_phone(p_phone text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.has_permission('phone') then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if v_phone is not null and v_phone !~ '^\+254[1-7][0-9]{8}$' then
    raise exception 'Enter a Kenyan number, like 0712 345 678 or 020 123 4567.' using errcode = 'P0001', detail = 'phone';
  end if;
  update public.kitchen_settings set phone = v_phone where id;
  return v_phone;
end $$;
revoke all on function public.set_kitchen_phone(text) from public, anon;
grant execute on function public.set_kitchen_phone(text) to authenticated;

create or replace function public.log_kitchen_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if new.last_orders_minutes is distinct from old.last_orders_minutes then
    perform public.log_change('settings', 'settings.last_orders', null, null,
      jsonb_build_object('minutes', old.last_orders_minutes), jsonb_build_object('minutes', new.last_orders_minutes));
  end if;
  if new.till_number is distinct from old.till_number then
    perform public.log_change('settings', 'settings.till', null, null,
      jsonb_build_object('till', old.till_number), jsonb_build_object('till', new.till_number));
  end if;
  if new.phone is distinct from old.phone then
    perform public.log_change('settings', 'settings.phone', null, null,
      jsonb_build_object('phone', old.phone), jsonb_build_object('phone', new.phone));
  end if;
  if new.closed_early_on is not null and old.closed_early_on is distinct from new.closed_early_on then
    perform public.log_change('settings', 'kitchen.close_early', null, null, null,
      jsonb_build_object('at', new.closed_early_at));
  elsif new.closed_early_on is null and old.closed_early_on = public.nairobi_today() then
    perform public.log_change('settings', 'kitchen.reopen', null, null);
  end if;
  return null;
end $$;

-- As 20261109000100_order_board.sql, plus the kitchen phone and each item's extras.
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
    'phone', (select k.phone from public.kitchen_settings k where k.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'price_kes', x.price_kes) order by x.sort_order)
                            from public.order_item_extras x where x.order_item_id = i.id), '[]'::jsonb))
        order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;

-- ───────────────────────── team ─────────────────────────
alter table public.staff
  add column must_change_password boolean not null default false,
  add column invited_at timestamptz;

-- 2.3's lines, plus "invited Otieno" for a row added with an invite.
create or replace function public.log_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('team', case when new.invited_at is not null then 'staff.invite' else 'staff.add' end,
      new.user_id, public.person_label(new.user_id), null, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform public.log_change('team', 'staff.remove', old.user_id,
      coalesce(nullif(trim(old.display_name), ''), public.person_label(old.user_id), 'Someone'));
  elsif new.role is distinct from old.role then
    perform public.log_change('team', 'staff.role', new.user_id, public.person_label(new.user_id),
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  return null;
end $$;

create function public.team_owner_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
end $$;
revoke all on function public.team_owner_check() from public, anon, authenticated;

create function public.team_member(p_user uuid) returns public.staff
language plpgsql security definer set search_path = '' as $$
declare v public.staff;
begin
  select * into v from public.staff where user_id = p_user for update;
  if v.user_id is null then
    raise exception 'That person isn''t on the team any more. Refresh the page.' using errcode = 'P0001', detail = 'missing';
  end if;
  return v;
end $$;
revoke all on function public.team_member(uuid) from public, anon, authenticated;

-- The last-owner rule is 2.3's keep_an_owner trigger. log_staff writes the line.
create function public.team_set_role(p_user uuid, p_role public.staff_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.team_owner_check();
  perform public.team_member(p_user);
  update public.staff set role = p_role where user_id = p_user and role is distinct from p_role;
end $$;

create function public.team_set_name(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.staff;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.team_owner_check();
  if v_name = '' then raise exception 'Enter a name.' using errcode = 'P0001', detail = 'name'; end if;
  if char_length(v_name) > 40 then raise exception 'A name can be up to 40 characters.' using errcode = 'P0001', detail = 'name'; end if;
  v := public.team_member(p_user);
  if v.display_name is distinct from v_name then
    update public.staff set display_name = v_name where user_id = p_user;
    perform public.log_change('team', 'staff.rename', p_user, v_name,
      jsonb_build_object('name', v.display_name), jsonb_build_object('name', v_name));
  end if;
end $$;

-- Remove from team and Reset password end the person's sessions at once (spec-2.6 "The rules"), so
-- their next request is signed out instead of their next token refresh. Internal: no grant.
-- plpgsql and to_regclass: the local stand-in creates its auth tables after migrations run.
create function public.end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end $$;
revoke all on function public.end_sessions(uuid) from public, anon, authenticated;

-- Deletes the staff row, so the grants go with it. p_invite: this is Cancel invite.
create function public.team_remove(p_user uuid, p_invite boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.staff;
begin
  perform public.team_owner_check();
  if p_user = auth.uid() then
    raise exception 'You can''t remove yourself. Another owner can.' using errcode = 'P0001', detail = 'self';
  end if;
  v := public.team_member(p_user);
  if p_invite then
    -- Accepted while the panel was open: this is now a Remove, not a cancelled invite.
    if v.invited_at is null then
      raise exception 'That person has already accepted the invite. Refresh the page.' using errcode = 'P0001', detail = 'accepted';
    end if;
    perform set_config('dausis.bulk', 'on', true);
    delete from public.staff where user_id = p_user;
    perform set_config('dausis.bulk', '', true);
    perform public.log_change('team', 'staff.cancel_invite', p_user,
      coalesce(nullif(trim(v.display_name), ''), public.person_label(p_user), 'Someone'));
  else
    delete from public.staff where user_id = p_user;
  end if;
  perform public.end_sessions(p_user);
end $$;

-- The temporary password's hash, kept so the forced change can't end while it is still the password
-- (RQA26-01). Nobody reads it through the API: RLS on, no policies, no grants. One row per person;
-- a later reset replaces it, choosing a new password deletes it.
create table public.password_resets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  temp_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.password_resets enable row level security;
revoke all on table public.password_resets from public, anon, authenticated;

-- Mama's reset: the line ("reset Otieno's password", never the password) and the forced change.
-- The password itself is set by the server action through the admin API just before this runs, so
-- the hash read here is the temporary password's. auth.users is read when it runs (plpgsql + execute:
-- the local stand-in adds encrypted_password after migrations).
create function public.team_log_reset(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.staff;
begin
  perform public.team_owner_check();
  v := public.team_member(p_user);
  if v.role = 'owner' then
    raise exception 'Owners reset their own password with Forgot password on the sign-in page.'
      using errcode = 'P0001', detail = 'owner';
  end if;
  update public.staff set must_change_password = true where user_id = p_user;
  execute 'insert into public.password_resets (user_id, temp_hash)
             select u.id, coalesce(u.encrypted_password, '''') from auth.users u where u.id = $1
           on conflict (user_id) do update set temp_hash = excluded.temp_hash, created_at = now()'
    using p_user;
  perform public.log_change('team', 'staff.reset', p_user, public.person_label(p_user));
  perform public.end_sessions(p_user);
end $$;

-- Set your password: the caller's own row only. Choosing a password also ends "Invited".
-- The database decides, not the page (RQA26-01): it ends only when the caller has a password, and
-- after a reset only when that password is no longer the temporary one.
create function public.clear_must_change_password() returns void
language plpgsql security definer set search_path = '' as $$
declare v public.staff; current_hash text; temp text;
begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v from public.staff where user_id = auth.uid();
  if not found or (not v.must_change_password and v.invited_at is null) then return; end if;
  execute 'select coalesce(u.encrypted_password, '''') from auth.users u where u.id = $1' into current_hash using auth.uid();
  if coalesce(current_hash, '') = '' then
    raise exception 'Choose a password first.' using errcode = 'P0001', detail = 'no_password';
  end if;
  if v.must_change_password then
    select r.temp_hash into temp from public.password_resets r where r.user_id = auth.uid();
    if temp is not null and temp = current_hash then
      raise exception 'Choose a new password, not the temporary one.' using errcode = 'P0001', detail = 'temporary';
    end if;
  end if;
  update public.staff set must_change_password = false, invited_at = null where user_id = auth.uid();
  delete from public.password_resets where user_id = auth.uid();
end $$;

revoke all on function public.team_set_role(uuid, public.staff_role) from public, anon;
revoke all on function public.team_set_name(uuid, text) from public, anon;
revoke all on function public.team_remove(uuid, boolean) from public, anon;
revoke all on function public.team_log_reset(uuid) from public, anon;
revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.team_set_role(uuid, public.staff_role) to authenticated;
grant execute on function public.team_set_name(uuid, text) to authenticated;
grant execute on function public.team_remove(uuid, boolean) to authenticated;
grant execute on function public.team_log_reset(uuid) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;

-- Account, Change password: whether the caller has ever set a password (spec-2.6). Someone who has
-- only used email links has none, and sees "Set a password" with no current-password field. Only
-- the caller's own row, and only true/false: the hash never leaves the database.
-- plpgsql, so the column is looked up when it runs (the local stand-in adds it after migrations).
create function public.has_password() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = auth.uid()), false);
end $$;
revoke all on function public.has_password() from public, anon;
grant execute on function public.has_password() to authenticated;
