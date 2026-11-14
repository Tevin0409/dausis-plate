-- Slice 2.12: reports, credit notes and Money in (spec-2.12-reports.md, "Build notes").
-- Pieces that depend on tables from slices 2.9 (table requests), 2.10 (ratings) and 2.11 (ads,
-- codes, combos) are not here: those tables are not in this base. The Reports screen shows an
-- honest empty state for them until those slices are merged and their report RPCs added.

-- ───────────────────────── 1. when a dish sold out ─────────────────────────
alter table public.menu_entry_days add column sold_out_at timestamptz;

create or replace function public.set_entry_sold_out(p_entry uuid, p_sold_out boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.menu_entry_days (entry_id, day, sold_out_manual, sold_out_at)
    values (p_entry, public.nairobi_today(), p_sold_out, case when p_sold_out then now() end)
  on conflict (entry_id, day) do update set
    sold_out_manual = excluded.sold_out_manual,
    -- The first time that day is kept, so "then back on" still has its time.
    sold_out_at = case when excluded.sold_out_manual then coalesce(public.menu_entry_days.sold_out_at, now())
                       else public.menu_entry_days.sold_out_at end;
end $$;

-- place_order as in 20261110000000_menu_planner.sql, plus sold_out_at on the last plate.
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
      update public.menu_entry_days set plates_sold = plates_sold + v_qty,
          sold_out_at = case when v_entry.plates_per_day is not null and plates_sold + v_qty >= v_entry.plates_per_day
                             then coalesce(sold_out_at, now()) else sold_out_at end
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

-- ───────────────────────── 2. how an order was paid ─────────────────────────
create type public.paid_with as enum ('cash', 'mpesa', 'card');

-- No backfill: orders paid before this slice stay null and report as "Not recorded".
alter table public.orders
  add column paid_with public.paid_with,
  add constraint orders_paid_with_check check (paid_with is null or payment_status = 'paid');

create index orders_paid_at_idx on public.orders (((coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date))
  where payment_status = 'paid';

-- Replaces 2.4's mark_order_paid(uuid). A second tap on a paid order records nothing and returns
-- null (nothing to undo). A cancelled order can't be marked paid any more (Q1 A).
drop function public.mark_order_paid(uuid);
create function public.mark_order_paid(p_order uuid, p_with public.paid_with)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_version integer;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_with is null or p_with not in ('cash', 'mpesa') then
    raise exception 'Choose cash or M-Pesa.' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' then
    raise exception '% was cancelled, so it can''t be marked paid.', v_order.code using errcode = 'P0001';
  end if;
  if v_order.payment_status is distinct from 'paid' then
    update public.orders
      set payment_status = 'paid', paid_at = now(), paid_from = v_order.payment_status, paid_with = p_with
      where id = p_order
      returning version into v_version;
    perform public.log_change('orders', 'order.paid', v_order.id, public.order_label(v_order),
      jsonb_build_object('payment', v_order.payment_status),
      jsonb_build_object('payment', 'paid', 'with', p_with));
  end if;
  return v_version;
end $$;

-- As 2.4's, plus: it clears paid_with, and it refuses an order that has a live credit note.
create or replace function public.unmark_order_paid(p_order uuid, p_version integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if v_order.version is distinct from p_version
     or v_order.payment_status is distinct from 'paid' or v_order.paid_at is null
     or v_order.paid_at < now() - interval '10 seconds'
     or exists (select from public.credit_notes c where c.order_id = p_order and c.voided_at is null) then
    raise exception 'Too late to undo' using errcode = 'P0001';
  end if;
  update public.orders
    set payment_status = coalesce(v_order.paid_from, 'unpaid'), paid_at = null, paid_from = null, paid_with = null
    where id = p_order;
  perform public.log_change('orders', 'order.paid_undo', v_order.id, public.order_label(v_order),
    jsonb_build_object('payment', 'paid'), jsonb_build_object('payment', coalesce(v_order.paid_from, 'unpaid')));
end $$;

revoke all on function public.mark_order_paid(uuid, public.paid_with) from public, anon;
grant execute on function public.mark_order_paid(uuid, public.paid_with) to authenticated;

-- ───────────────────────── 3. credit notes ─────────────────────────
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  order_id uuid not null references public.orders (id) on delete restrict,
  amount_kes integer not null check (amount_kes > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 120),
  issued_at timestamptz not null default now(),
  issued_by uuid not null,                       -- as the History's actor: no foreign key, the person may go
  refunded_with public.paid_with not null check (refunded_with in ('cash', 'mpesa')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  constraint credit_notes_void_all_or_none check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 3 and 120)
  )
);
-- One live credit note per order.
create unique index credit_notes_one_live_idx on public.credit_notes (order_id) where voided_at is null;
create index credit_notes_issued_idx on public.credit_notes (issued_at);
create index credit_notes_voided_idx on public.credit_notes (voided_at) where voided_at is not null;

-- Numbers without gaps: a counter row that issue_credit_note locks inside its transaction. A failed
-- issue rolls the number back. Not a sequence: sequences skip numbers on a rollback.
create table public.credit_note_counter (
  id boolean primary key default true check (id),
  last_number integer not null default 0
);
insert into public.credit_note_counter (id) values (true);

alter table public.credit_notes enable row level security;
alter table public.credit_note_counter enable row level security;
create policy credit_notes_owner_read on public.credit_notes for select to authenticated using ((select public.is_owner()));
revoke all on public.credit_notes from anon, authenticated;
revoke all on public.credit_note_counter from anon, authenticated;
grant select on public.credit_notes to authenticated;

-- CN-0001 … CN-9999, then CN-10000 (lpad alone would cut it to "1000").
create function public.credit_note_code(p_number integer) returns text
language sql immutable set search_path = '' as $$
  select 'CN-' || case when p_number < 10000 then lpad(p_number::text, 4, '0') else p_number::text end
$$;
grant execute on function public.credit_note_code(integer) to authenticated;

create function public.issue_credit_note(p_order uuid, p_amount integer, p_reason text, p_refunded_with public.paid_with)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_live public.credit_notes;
  v_number integer;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Order not found' using errcode = 'P0001'; end if;
  if v_order.status <> 'cancelled' then
    raise exception 'Only a cancelled order can have a credit note.' using errcode = 'P0001';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception '% wasn''t paid, so there is nothing to refund.', v_order.code using errcode = 'P0001';
  end if;
  select * into v_live from public.credit_notes where order_id = p_order and voided_at is null;
  if v_live.id is not null then
    raise exception '% already has credit note %.', v_order.code, public.credit_note_code(v_live.number) using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 1 then raise exception 'Enter at least KSh 1.' using errcode = 'P0001'; end if;
  if p_amount > v_order.total_kes then
    raise exception 'The credit note can''t be more than was paid, KSh %.', v_order.total_kes using errcode = 'P0001';
  end if;
  if char_length(v_reason) not between 3 and 120 then
    raise exception 'Write a reason of 3 to 120 characters.' using errcode = 'P0001';
  end if;
  if p_refunded_with is null or p_refunded_with not in ('cash', 'mpesa') then
    raise exception 'Choose cash or M-Pesa.' using errcode = 'P0001';
  end if;
  update public.credit_note_counter set last_number = last_number + 1 returning last_number into v_number;
  insert into public.credit_notes (number, order_id, amount_kes, reason, issued_by, refunded_with)
    values (v_number, p_order, p_amount, v_reason, auth.uid(), p_refunded_with)
    returning id into v_id;
  perform public.log_change('orders', 'credit_note.issue', v_order.id, public.order_label(v_order), null,
    jsonb_build_object('code', public.credit_note_code(v_number), 'amount', p_amount, 'with', p_refunded_with, 'reason', v_reason));
  return jsonb_build_object('id', v_id, 'number', v_number, 'code', public.credit_note_code(v_number));
end $$;

create function public.void_credit_note(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note public.credit_notes;
  v_order public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into v_note from public.credit_notes where id = p_id for update;
  if v_note.id is null then raise exception 'Credit note not found' using errcode = 'P0001'; end if;
  if v_note.voided_at is not null then
    raise exception '% is already void.', public.credit_note_code(v_note.number) using errcode = 'P0001';
  end if;
  if char_length(v_reason) not between 3 and 120 then
    raise exception 'Write a reason of 3 to 120 characters.' using errcode = 'P0001';
  end if;
  update public.credit_notes set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  select * into v_order from public.orders where id = v_note.order_id;
  perform public.log_change('orders', 'credit_note.void', v_order.id, public.order_label(v_order), null,
    jsonb_build_object('code', public.credit_note_code(v_note.number), 'amount', v_note.amount_kes, 'reason', v_reason));
  return jsonb_build_object('id', p_id, 'number', v_note.number, 'code', public.credit_note_code(v_note.number));
end $$;

revoke all on function public.issue_credit_note(uuid, integer, text, public.paid_with) from public, anon;
revoke all on function public.void_credit_note(uuid, text) from public, anon;
grant execute on function public.issue_credit_note(uuid, integer, text, public.paid_with) to authenticated;
grant execute on function public.void_credit_note(uuid, text) to authenticated;

-- ───────────────────────── 4. report RPCs ─────────────────────────
-- Owner only (42501), a valid range (P0001 in plain words), 10 s statement timeout. Days are
-- Nairobi days. Internal helpers are not granted to anyone: only the definer RPCs call them.
create function public.report_guard(p_from date, p_to date) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can see reports.' using errcode = '42501'; end if;
  if p_from is null or p_to is null then raise exception 'Pick a start and an end date.' using errcode = 'P0001'; end if;
  if p_from > p_to then raise exception 'The end date is before the start date.' using errcode = 'P0001'; end if;
  if p_to - p_from > 365 then raise exception 'Pick 366 days or fewer.' using errcode = 'P0001'; end if;
  if p_to > public.nairobi_today() then raise exception 'The end date can''t be after today.' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.report_guard(date, date) from public, anon, authenticated;

-- How a paid order's money is listed: cash, mpesa (counter), mpesa_online, card, not_recorded.
create function public.pay_kind(p_with public.paid_with, p_method public.payment_method) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_with = 'cash' then 'cash'
    when p_with = 'mpesa' then case when p_method = 'mpesa' then 'mpesa_online' else 'mpesa' end
    when p_with = 'card' then 'card'
    when p_method = 'mpesa' then 'mpesa_online'
    when p_method = 'card' then 'card'
    else 'not_recorded' end
$$;
revoke all on function public.pay_kind(public.paid_with, public.payment_method) from public, anon, authenticated;

-- The five tiles for one period.
create function public.report_tiles(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with o as (
    select * from public.orders where (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  ),
  pay as (
    select coalesce(sum(total_kes), 0) as kes, count(*) as n from public.orders
    where payment_status = 'paid' and (coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date between p_from and p_to
  ),
  cn as (
    select coalesce(sum(amount_kes), 0) as kes from public.credit_notes
    where (issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  ),
  cnv as (
    select coalesce(sum(amount_kes), 0) as kes from public.credit_notes
    where voided_at is not null and (voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  )
  select jsonb_build_object(
    'sales', coalesce((select sum(total_kes) from o where status <> 'cancelled'), 0),
    'orders', (select count(*) from o where status <> 'cancelled'),
    'average', (select round(avg(total_kes))::integer from o where status <> 'cancelled'),
    'money_in', (select kes from pay) - (select kes from cn) + (select kes from cnv),
    'payments', (select kes from pay),
    'payments_n', (select n from pay),
    'credit_notes', (select kes from cn),
    'credit_notes_voided', (select kes from cnv),
    'to_collect_kes', coalesce((select sum(total_kes) from o where status <> 'cancelled' and payment_status <> 'paid'), 0),
    'to_collect_n', (select count(*) from o where status <> 'cancelled' and payment_status <> 'paid'),
    'cancelled_n', (select count(*) from o where status = 'cancelled'),
    'cancelled_kes', coalesce((select sum(total_kes) from o where status = 'cancelled'), 0),
    'cancelled_paid_n', (select count(*) from o where status = 'cancelled' and payment_status = 'paid'),
    'cancelled_with_note_n', (select count(*) from o where status = 'cancelled' and payment_status = 'paid'
        and exists (select from public.credit_notes c where c.order_id = o.id and c.voided_at is null))
  )
$$;
revoke all on function public.report_tiles(date, date) from public, anon, authenticated;

create function public.report_sales(p_from date, p_to date, p_cmp_from date default null, p_cmp_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_days integer := p_to - p_from + 1;
  v_grain text := case when p_to - p_from + 1 <= 62 then 'day' when p_to - p_from + 1 <= 182 then 'week' else 'month' end;
  v_first date;
  v_cmp jsonb;
  v_out jsonb;
begin
  perform public.report_guard(p_from, p_to);
  select min((created_at at time zone 'Africa/Nairobi')::date) into v_first from public.orders;
  if p_cmp_from is not null and p_cmp_to is not null then
    if p_cmp_from > p_cmp_to or p_cmp_to - p_cmp_from > 365 then
      raise exception 'The comparison range is not valid.' using errcode = 'P0001';
    end if;
    -- A comparison before the first order has no figures to compare with.
    if v_first is not null and p_cmp_to >= v_first then v_cmp := public.report_tiles(p_cmp_from, p_cmp_to); end if;
  end if;

  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'grain', v_grain, 'first_order_day', v_first,
    'tiles', public.report_tiles(p_from, p_to),
    'compare', v_cmp, 'compare_from', p_cmp_from, 'compare_to', p_cmp_to,

    'by_bucket', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'sales', s, 'orders', n, 'food', fo, 'fees', f) order by b), '[]')
      from (
        select date_trunc(v_grain, ((created_at at time zone 'Africa/Nairobi')::date)::timestamp)::date as b,
               sum(total_kes) as s, count(*) as n, sum(subtotal_kes) as fo, sum(delivery_fee_kes) as f
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'by_hour', case when v_days = 1 then (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', s, 'orders', n) order by h), '[]')
      from (
        select extract(hour from created_at at time zone 'Africa/Nairobi')::integer as h, sum(total_kes) as s, count(*) as n
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date = p_from
        group by 1) x) else '[]'::jsonb end,

    'by_payment_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', m, 'orders', n, 'paid', p, 'not_paid', n - p) order by m), '[]')
      from (
        select payment_method::text as m, count(*) as n, count(*) filter (where payment_status = 'paid') as p
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'by_mode', (
      select coalesce(jsonb_agg(jsonb_build_object('mode', m, 'orders', n, 'sales', s) order by m), '[]')
      from (
        select mode::text as m, count(*) as n, sum(total_kes) as s from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'cancellations', jsonb_build_object(
      'by_reason', (
        select coalesce(jsonb_agg(jsonb_build_object('reason', r, 'orders', n, 'kes', s) order by n desc, r), '[]')
        from (
          select coalesce(cancel_reason::text, 'none') as r, count(*) as n, sum(total_kes) as s from public.orders
          where status = 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) x),
      'orders', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', o.code, 'created_at', o.created_at, 'total', o.total_kes, 'reason', o.cancel_reason, 'note', o.cancel_note,
          'paid', o.payment_status = 'paid',
          'credit_note', (select public.credit_note_code(c.number) from public.credit_notes c where c.order_id = o.id and c.voided_at is null))
          order by o.created_at desc), '[]')
        from (select * from public.orders where status = 'cancelled'
                and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
              order by created_at desc limit 300) o)),

    'money_in', (
      select coalesce(jsonb_agg(row_to_json(m)::jsonb order by m.bucket), '[]')
      from (
        select date_trunc(v_grain, d::timestamp)::date as bucket,
          coalesce(sum(amt) filter (where kind = 'cash'), 0) as cash,
          coalesce(sum(amt) filter (where kind = 'mpesa'), 0) as mpesa,
          coalesce(sum(amt) filter (where kind = 'mpesa_online'), 0) as mpesa_online,
          coalesce(sum(amt) filter (where kind = 'card'), 0) as card,
          coalesce(sum(amt) filter (where kind = 'not_recorded'), 0) as not_recorded,
          count(*) filter (where kind = 'cash') as cash_n,
          count(*) filter (where kind = 'mpesa') as mpesa_n,
          coalesce(sum(amt) filter (where kind like 'cn\_%'), 0) as credit_notes,
          coalesce(sum(amt) filter (where kind = 'cn_cash'), 0) as cn_cash,
          coalesce(sum(amt) filter (where kind = 'cn_mpesa'), 0) as cn_mpesa,
          coalesce(sum(amt) filter (where kind like 'cnv\_%'), 0) as credit_notes_voided,
          coalesce(sum(amt) filter (where kind = 'cnv_cash'), 0) as cnv_cash,
          coalesce(sum(amt) filter (where kind = 'cnv_mpesa'), 0) as cnv_mpesa,
          coalesce(sum(amt) filter (where kind in ('cash','mpesa','mpesa_online','card','not_recorded')), 0)
            - coalesce(sum(amt) filter (where kind like 'cn\_%'), 0)
            + coalesce(sum(amt) filter (where kind like 'cnv\_%'), 0) as net,
          count(*) filter (where kind in ('cash','mpesa','mpesa_online','card','not_recorded') and legacy) as legacy_n
        from (
          select (coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date as d,
                 public.pay_kind(paid_with, payment_method) as kind, total_kes as amt, paid_at is null as legacy
          from public.orders
          where payment_status = 'paid' and (coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date between p_from and p_to
          union all
          select (issued_at at time zone 'Africa/Nairobi')::date, 'cn_' || refunded_with::text, amount_kes, false
          from public.credit_notes where (issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          union all
          select (voided_at at time zone 'Africa/Nairobi')::date, 'cnv_' || refunded_with::text, amount_kes, false
          from public.credit_notes
          where voided_at is not null and (voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        ) ev group by 1) m),

    'to_collect', (
      select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'created_at', o.created_at, 'mode', o.mode,
        'table', t.label, 'total', o.total_kes) order by o.created_at), '[]')
      from (select * from public.orders
            where status <> 'cancelled' and payment_status <> 'paid'
              and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
            order by created_at limit 10) o
      left join public.dining_tables t on t.id = o.table_id),

    -- A follow-up list, not a period figure: every date.
    'paid_cancelled_open', (
      select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'paid_at', coalesce(o.paid_at, o.created_at),
        'total', o.total_kes, 'reason', o.cancel_reason, 'note', o.cancel_note) order by coalesce(o.paid_at, o.created_at)), '[]')
      from public.orders o
      where o.status = 'cancelled' and o.payment_status = 'paid'
        and not exists (select from public.credit_notes c where c.order_id = o.id and c.voided_at is null)),

    'credit_notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', public.credit_note_code(c.number), 'number', c.number, 'order', o.code, 'order_total', o.total_kes,
        'amount', c.amount_kes, 'kept', o.total_kes - c.amount_kes, 'refunded_with', c.refunded_with, 'reason', c.reason,
        'issued_at', c.issued_at, 'voided_at', c.voided_at, 'void_reason', c.void_reason) order by c.number), '[]')
      from public.credit_notes c join public.orders o on o.id = c.order_id
      where (c.issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
         or (c.voided_at is not null and (c.voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to))
  ) into v_out;
  return v_out;
end $$;

-- The order sheet.
create function public.report_order(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  if not public.is_owner() then raise exception 'Only the owner can see reports.' using errcode = '42501'; end if;
  select * into v_order from public.orders where code = upper(btrim(coalesce(p_code, '')));
  if v_order.id is null then return null; end if;
  return jsonb_build_object(
    'id', v_order.id, 'code', v_order.code, 'customer_name', v_order.customer_name, 'mode', v_order.mode,
    'created_at', v_order.created_at, 'pickup_at', v_order.pickup_at, 'status', v_order.status,
    'cancel_reason', v_order.cancel_reason, 'cancel_note', v_order.cancel_note,
    'total', v_order.total_kes, 'subtotal', v_order.subtotal_kes, 'fee', v_order.delivery_fee_kes,
    'payment_method', v_order.payment_method, 'payment_status', v_order.payment_status,
    'paid_with', v_order.paid_with, 'paid_at', v_order.paid_at,
    'table', (select label from public.dining_tables where id = v_order.table_id),
    'zone', (select name from public.delivery_zones where id = v_order.delivery_zone_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option_label, 'quantity', i.quantity,
        'unit', i.unit_price_kes) order by i.name), '[]') from public.order_items i where i.order_id = v_order.id),
    'credit_notes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', public.credit_note_code(c.number), 'amount', c.amount_kes, 'kept', v_order.total_kes - c.amount_kes,
        'refunded_with', c.refunded_with, 'reason', c.reason, 'issued_at', c.issued_at, 'issued_by', public.person_label(c.issued_by),
        'voided_at', c.voided_at, 'voided_by', case when c.voided_by is not null then public.person_label(c.voided_by) end,
        'void_reason', c.void_reason) order by c.number desc), '[]')
      from public.credit_notes c where c.order_id = v_order.id)
  );
end $$;

create function public.report_dishes(p_from date, p_to date) returns jsonb
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
              (coalesce(md.sold_out_manual, false) or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)) as out,
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

create function public.report_times(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_days integer := p_to - p_from + 1;
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object(
    'days', v_days,
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', n, 'per_day', round(n::numeric / v_days, 2)) order by h), '[]')
      from (select extract(hour from created_at at time zone 'Africa/Nairobi')::integer as h, count(*) as n
            from public.orders
            where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
            group by 1) x),
    -- Orders per weekday-hour, averaged over the number of that weekday in the period.
    'by_weekday_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('weekday', w, 'hour', h, 'orders', n,
        'avg', round(n::numeric / greatest((select count(*) from generate_series(p_from, p_to, interval '1 day') g(d)
                                            where extract(isodow from g.d) = w), 1), 2)) order by w, h), '[]')
      from (select extract(isodow from created_at at time zone 'Africa/Nairobi')::integer as w,
                   extract(hour from created_at at time zone 'Africa/Nairobi')::integer as h, count(*) as n
            from public.orders
            where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
            group by 1, 2) x)
  );
end $$;

-- Delivery by area. Table requests are 2.9's: they join this RPC when that slice is merged.
create function public.report_delivery(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object('zones', (
    select coalesce(jsonb_agg(jsonb_build_object('zone', z, 'orders', n, 'fees', f, 'food', fo) order by n desc, z), '[]')
    from (select coalesce(zn.name, 'Deleted area') as z, count(*) as n, sum(o.delivery_fee_kes) as f, sum(o.subtotal_kes) as fo
          from public.orders o left join public.delivery_zones zn on zn.id = o.delivery_zone_id
          where o.mode = 'delivery' and o.status <> 'cancelled'
            and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) x));
end $$;

-- CSV rows. Customer name is in, phone number is not (Q4 A).
create function public.report_orders_csv(p_from date, p_to date)
returns table (
  code text, day date, at_time text, mode text, place text, items text, subtotal_kes integer, fee_kes integer, total_kes integer,
  payment_method text, payment_status text, paid_with text, paid_day date, paid_time text, status text, cancel_reason text,
  cancel_note text, customer_name text, credit_note text, credit_note_kes integer
)
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return query
  select o.code, (o.created_at at time zone 'Africa/Nairobi')::date, to_char(o.created_at at time zone 'Africa/Nairobi', 'HH24:MI'),
    o.mode::text, coalesce(t.label, z.name, ''),
    coalesce((select string_agg(i.quantity || '× ' || i.name || coalesce(' (' || i.option_label || ')', ''), '; ' order by i.name)
              from public.order_items i where i.order_id = o.id), ''),
    o.subtotal_kes, o.delivery_fee_kes, o.total_kes, o.payment_method::text, o.payment_status::text, coalesce(o.paid_with::text, ''),
    (o.paid_at at time zone 'Africa/Nairobi')::date, coalesce(to_char(o.paid_at at time zone 'Africa/Nairobi', 'HH24:MI'), ''),
    o.status::text, coalesce(o.cancel_reason::text, ''), coalesce(o.cancel_note, ''), o.customer_name,
    coalesce(public.credit_note_code(c.number), ''), c.amount_kes
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  left join public.credit_notes c on c.order_id = o.id and c.voided_at is null
  where (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  order by o.created_at;
end $$;

create function public.report_credit_notes_csv(p_from date, p_to date)
returns table (
  line text, code text, day date, at_time text, order_code text, order_day date, order_total_kes integer,
  amount_kes integer, kept_kes integer, refunded_with text, reason text, by_name text
)
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return query
  select u.line, u.code, u.day, u.at_time, u.order_code, u.order_day, u.order_total_kes, u.amount_kes, u.kept_kes,
         u.refunded_with, u.reason, u.by_name
  from (
    select 'Credit note'::text, public.credit_note_code(c.number), (c.issued_at at time zone 'Africa/Nairobi')::date,
      to_char(c.issued_at at time zone 'Africa/Nairobi', 'HH24:MI'), o.code, (o.created_at at time zone 'Africa/Nairobi')::date,
      o.total_kes, -c.amount_kes, o.total_kes - c.amount_kes, c.refunded_with::text, c.reason, public.person_label(c.issued_by), c.issued_at as ev
    from public.credit_notes c join public.orders o on o.id = c.order_id
    where (c.issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
    union all
    select 'Credit note voided', public.credit_note_code(c.number), (c.voided_at at time zone 'Africa/Nairobi')::date,
      to_char(c.voided_at at time zone 'Africa/Nairobi', 'HH24:MI'), o.code, (o.created_at at time zone 'Africa/Nairobi')::date,
      o.total_kes, c.amount_kes, o.total_kes - c.amount_kes, c.refunded_with::text, c.void_reason, public.person_label(c.voided_by), c.voided_at
    from public.credit_notes c join public.orders o on o.id = c.order_id
    where c.voided_at is not null and (c.voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  ) u(line, code, day, at_time, order_code, order_day, order_total_kes, amount_kes, kept_kes, refunded_with, reason, by_name, ev)
  order by u.ev, u.line;
end $$;

revoke all on function public.report_sales(date, date, date, date) from public, anon;
revoke all on function public.report_order(text) from public, anon;
revoke all on function public.report_dishes(date, date) from public, anon;
revoke all on function public.report_times(date, date) from public, anon;
revoke all on function public.report_delivery(date, date) from public, anon;
revoke all on function public.report_orders_csv(date, date) from public, anon;
revoke all on function public.report_credit_notes_csv(date, date) from public, anon;
grant execute on function public.report_sales(date, date, date, date) to authenticated;
grant execute on function public.report_order(text) to authenticated;
grant execute on function public.report_dishes(date, date) to authenticated;
grant execute on function public.report_times(date, date) to authenticated;
grant execute on function public.report_delivery(date, date) to authenticated;
grant execute on function public.report_orders_csv(date, date) to authenticated;
grant execute on function public.report_credit_notes_csv(date, date) to authenticated;
