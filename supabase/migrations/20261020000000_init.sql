-- Dausis Plate: menu, rotating daily/weekly dishes, ordering.
-- All "today" logic runs on Nairobi time.

create extension if not exists pgcrypto;

-- ───────────────────────── enums ─────────────────────────
create type public.staff_role as enum ('owner', 'staff');
create type public.dish_category as enum ('mains', 'sides', 'breakfast', 'drinks');
create type public.entry_kind as enum ('day', 'week');
create type public.order_mode as enum ('dine_in', 'pickup', 'delivery');
create type public.payment_method as enum ('mpesa', 'card', 'on_handover');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'unpaid');
create type public.order_status as enum ('new', 'preparing', 'ready', 'completed', 'cancelled');

-- ───────────────────────── time helpers ─────────────────────────
create or replace function public.nairobi_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

create or replace function public.nairobi_time() returns time
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::time $$;

-- ───────────────────────── staff ─────────────────────────
create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null default 'staff',
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'owner')
$$;

-- ───────────────────────── dishes (library + regulars) ─────────────────────────
-- Every dish she has ever cooked lives here. Regular dishes show every day;
-- rotating dishes only appear through menu_entries.
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  price_kes integer not null check (price_kes >= 0),
  photo_key text,
  category public.dish_category not null default 'mains',
  is_regular boolean not null default false,
  regular_available boolean not null default true,
  sort_order integer not null default 0,
  archived boolean not null default false,
  last_served_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dishes_regular_idx on public.dishes (is_regular, category, sort_order) where not archived;

-- "Swap your side" style choices.
create table public.dish_options (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes (id) on delete cascade,
  label text not null,
  price_delta_kes integer not null default 0,
  is_default boolean not null default false,
  sort_order integer not null default 0
);
create index dish_options_dish_idx on public.dish_options (dish_id);

-- ───────────────────────── rotating menu ─────────────────────────
-- kind 'day'  → starts_on = ends_on (one day)
-- kind 'week' → a date range, shown every day in it
create table public.menu_entries (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes (id) on delete restrict,
  kind public.entry_kind not null default 'day',
  starts_on date not null,
  ends_on date not null,
  price_kes integer check (price_kes >= 0),
  plates_per_day integer check (plates_per_day > 0),
  show_from time not null default '11:00',
  show_until time not null default '20:00',
  auto_hide_sold_out boolean not null default true,
  published boolean not null default true,
  ended_early_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint menu_entries_range check (ends_on >= starts_on),
  constraint menu_entries_day_single check (kind <> 'day' or starts_on = ends_on),
  constraint menu_entries_hours check (show_until > show_from)
);
create index menu_entries_range_idx on public.menu_entries (starts_on, ends_on) where published;

-- Plates sold per entry per day (weekly entries reset each day).
create table public.menu_entry_days (
  entry_id uuid not null references public.menu_entries (id) on delete cascade,
  day date not null,
  plates_sold integer not null default 0 check (plates_sold >= 0),
  sold_out_manual boolean not null default false,
  primary key (entry_id, day)
);

-- ───────────────────────── tables & delivery ─────────────────────────
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  qr_token text not null unique default encode(gen_random_bytes(8), 'hex'),
  active boolean not null default true
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  fee_kes integer not null check (fee_kes >= 0),
  active boolean not null default true,
  sort_order integer not null default 0
);

-- ───────────────────────── orders ─────────────────────────
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 100) unique,
  code text generated always as ('DP-' || lpad(number::text, 4, '0')) stored,
  public_token uuid not null unique default gen_random_uuid(),
  mode public.order_mode not null,
  table_id uuid references public.dining_tables (id),
  pickup_at timestamptz,
  delivery_zone_id uuid references public.delivery_zones (id),
  delivery_address text,
  delivery_notes text,
  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9 ]{9,15}$'),
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  status public.order_status not null default 'new',
  subtotal_kes integer not null check (subtotal_kes >= 0),
  delivery_fee_kes integer not null default 0 check (delivery_fee_kes >= 0),
  total_kes integer not null check (total_kes >= 0),
  mpesa_checkout_request_id text unique,
  mpesa_receipt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  constraint orders_dine_in check (mode <> 'dine_in' or table_id is not null),
  constraint orders_delivery check (mode <> 'delivery' or (delivery_zone_id is not null and length(trim(coalesce(delivery_address, ''))) > 0))
);
create index orders_board_idx on public.orders (status, created_at desc);
create index orders_day_idx on public.orders (((created_at at time zone 'Africa/Nairobi')::date));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  dish_id uuid not null references public.dishes (id),
  menu_entry_id uuid references public.menu_entries (id),
  option_id uuid references public.dish_options (id),
  name text not null,
  option_label text,
  unit_price_kes integer not null check (unit_price_kes >= 0),
  quantity integer not null check (quantity between 1 and 20),
  note text
);
create index order_items_order_idx on public.order_items (order_id);

-- ───────────────────────── triggers ─────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'orders' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create trigger dishes_touch before update on public.dishes
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- Cancelling an order gives its rotating-dish plates back for that day.
create or replace function public.release_plates_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.menu_entry_days md
       set plates_sold = greatest(md.plates_sold - x.qty, 0)
      from (select menu_entry_id, sum(quantity) qty from public.order_items
             where order_id = new.id and menu_entry_id is not null group by menu_entry_id) x
     where md.entry_id = x.menu_entry_id
       and md.day = (new.created_at at time zone 'Africa/Nairobi')::date;
  end if;
  return new;
end $$;

create trigger orders_release_plates after update of status on public.orders
  for each row execute function public.release_plates_on_cancel();

-- ───────────────────────── today's menu view ─────────────────────────
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
  e.auto_hide_sold_out
from public.menu_entries e
join public.dishes d on d.id = e.dish_id
left join public.menu_entry_days md on md.entry_id = e.id and md.day = public.nairobi_today()
where e.published
  and e.ended_early_at is null
  and public.nairobi_today() between e.starts_on and e.ends_on;

-- ───────────────────────── RLS ─────────────────────────
alter table public.staff enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_options enable row level security;
alter table public.menu_entries enable row level security;
alter table public.menu_entry_days enable row level security;
alter table public.dining_tables enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy staff_read_self on public.staff for select using (user_id = auth.uid() or public.is_owner());
create policy staff_owner_write on public.staff for all using (public.is_owner()) with check (public.is_owner());

create policy dishes_public_read on public.dishes for select using (not archived or public.is_staff());
create policy dishes_staff_write on public.dishes for all using (public.is_staff()) with check (public.is_staff());

create policy options_public_read on public.dish_options for select using (true);
create policy options_staff_write on public.dish_options for all using (public.is_staff()) with check (public.is_staff());

create policy entries_public_read on public.menu_entries for select using (published or public.is_staff());
create policy entries_staff_write on public.menu_entries for all using (public.is_staff()) with check (public.is_staff());

create policy entry_days_public_read on public.menu_entry_days for select using (true);
create policy entry_days_staff_write on public.menu_entry_days for all using (public.is_staff()) with check (public.is_staff());

create policy tables_staff on public.dining_tables for all using (public.is_staff()) with check (public.is_staff());

create policy zones_public_read on public.delivery_zones for select using (active or public.is_staff());
create policy zones_staff_write on public.delivery_zones for all using (public.is_staff()) with check (public.is_staff());

-- Customers never touch orders directly: they go through place_order / get_order_status.
create policy orders_staff on public.orders for all using (public.is_staff()) with check (public.is_staff());
create policy order_items_staff on public.order_items for all using (public.is_staff()) with check (public.is_staff());

-- ───────────────────────── customer RPCs ─────────────────────────
create or replace function public.resolve_table(p_token text)
returns table (id uuid, label text)
language sql stable security definer set search_path = public as $$
  select t.id, t.label from public.dining_tables t where t.qr_token = p_token and t.active
$$;

-- Places an order atomically: prices come from the database, never the client,
-- and rotating-dish plate counts are locked and decremented in the same transaction.
create or replace function public.place_order(p jsonb)
returns table (public_token uuid, code text, total_kes integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_mode public.order_mode := (p->>'mode')::public.order_mode;
  v_payment public.payment_method := (p->>'payment_method')::public.payment_method;
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
begin
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
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
          and public.nairobi_time() between e.show_from and e.show_until;
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
      if not (v_dish.is_regular and v_dish.regular_available) then
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
    subtotal_kes, delivery_fee_kes, total_kes)
  values (
    v_mode, v_table_id,
    case when v_mode = 'pickup' then nullif(p->>'pickup_at', '')::timestamptz end,
    case when v_mode = 'delivery' then v_zone.id end,
    case when v_mode = 'delivery' then left(trim(p->>'delivery_address'), 300) end,
    case when v_mode = 'delivery' then left(nullif(trim(p->>'delivery_notes'), ''), 300) end,
    left(trim(p->>'customer_name'), 80), trim(p->>'customer_phone'), v_payment,
    case when v_payment = 'on_handover' then 'unpaid'::public.payment_status else 'pending'::public.payment_status end,
    v_subtotal, v_fee, v_subtotal + v_fee)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, dish_id, menu_entry_id, option_id, name, option_label, unit_price_kes, quantity, note)
    values (v_order_id, (v_line->>'dish_id')::uuid, nullif(v_line->>'menu_entry_id', '')::uuid,
            nullif(v_line->>'option_id', '')::uuid, v_line->>'name', v_line->>'option_label',
            (v_line->>'unit_price_kes')::integer, (v_line->>'quantity')::integer, v_line->>'note');
  end loop;

  return query select o.public_token, o.code, o.total_kes from public.orders o where o.id = v_order_id;
end $$;

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
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes) order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;

-- ───────────────────────── staff RPCs ─────────────────────────
create or replace function public.copy_menu_day(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day,
                                   show_from, show_until, auto_hide_sold_out, published, sort_order)
  select dish_id, 'day', p_to, p_to, price_kes, plates_per_day,
         show_from, show_until, auto_hide_sold_out, true, sort_order
  from public.menu_entries
  where kind = 'day' and starts_on = p_from and ended_early_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.set_entry_sold_out(p_entry uuid, p_sold_out boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.menu_entry_days (entry_id, day, sold_out_manual)
    values (p_entry, public.nairobi_today(), p_sold_out)
  on conflict (entry_id, day) do update set sold_out_manual = excluded.sold_out_manual;
end $$;

create or replace function public.dashboard_stats(p_day date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with day_orders as (
    select * from public.orders
    where (created_at at time zone 'Africa/Nairobi')::date = p_day and status <> 'cancelled'
  )
  select jsonb_build_object(
    'revenue_kes', coalesce((select sum(total_kes) from day_orders), 0),
    'orders', (select count(*) from day_orders),
    'by_mode', coalesce((select jsonb_object_agg(mode::text, n) from (select mode, count(*) n from day_orders group by mode) m), '{}'::jsonb),
    'by_payment', coalesce((select jsonb_object_agg(payment_method::text, n) from (select payment_method, count(*) n from day_orders group by payment_method) m), '{}'::jsonb),
    'paid_online', (select count(*) from day_orders where payment_method in ('mpesa', 'card') and payment_status = 'paid'),
    'by_hour', coalesce((select jsonb_object_agg(h, n) from (
        select extract(hour from created_at at time zone 'Africa/Nairobi')::int h, count(*) n
        from day_orders group by 1) x), '{}'::jsonb),
    'rotating', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'sold', coalesce(md.plates_sold, 0), 'total', e.plates_per_day) order by coalesce(md.plates_sold, 0) desc)
      from public.menu_entries e
      join public.dishes d on d.id = e.dish_id
      left join public.menu_entry_days md on md.entry_id = e.id and md.day = p_day
      where e.published and p_day between e.starts_on and e.ends_on), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ───────────────────────── grants & realtime ─────────────────────────
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.get_order_status(uuid) to anon, authenticated;
grant execute on function public.resolve_table(text) to anon, authenticated;
grant execute on function public.copy_menu_day(date, date) to authenticated;
grant execute on function public.set_entry_sold_out(uuid, boolean) to authenticated;
grant execute on function public.dashboard_stats(date) to authenticated;
grant select on public.todays_menu to anon, authenticated;

alter publication supabase_realtime add table public.orders;
