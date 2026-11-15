-- Slice 2.9: table requests (spec-2.9-table-requests.md, "Build notes"; Tevin 2026-11-07: Q1 B, Q2 A).
--
--   * table_requests: "Call waiter" and "Request bill". A request belongs to the table, not the
--     phone: one open request of each kind per table (a partial unique index), so two phones tapping
--     at once make one row.
--   * Customers write only through request_table_help (from an order page, by the order's token) and
--     request_waiter_at_table (from the menu, by the table's QR token). Staff read through
--     open_table_requests and write through clear_table_request / undo_clear_table_request.
--   * Requests end with the day: one still open at midnight Nairobi is closed by itself
--     (auto_cleared, cleared_at = that midnight) the next time anything reads or writes requests.
--     Reports (2.12) count it as unanswered; response time is cleared_at - created_at otherwise.
--   * mark_orders_paid / unmark_orders_paid: 2.4's Mark paid for a whole bill, in one transaction,
--     each order with its own History line, and one Undo for all.
--
-- Customer-facing refusals are P0001 with a fixed code word as the message; the app maps each to
-- the customer's sentence (src/lib/table-requests.ts).

create type public.table_request_kind as enum ('waiter', 'bill');

create table public.table_requests (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.dining_tables (id) on delete cascade,
  -- Null for a call from the menu, before ordering (Q1 B).
  order_id uuid references public.orders (id) on delete set null,
  kind public.table_request_kind not null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references auth.users (id) on delete set null,
  auto_cleared boolean not null default false,
  constraint table_requests_cleared_check check (cleared_at is not null or (cleared_by is null and not auto_cleared))
);

-- One open request of each kind per table.
create unique index table_requests_one_open on public.table_requests (table_id, kind) where cleared_at is null;
create index table_requests_table_created on public.table_requests (table_id, created_at);
create index table_requests_order on public.table_requests (order_id) where order_id is not null;

alter table public.table_requests enable row level security;
-- Every write goes through the functions below.
revoke insert, update, delete, truncate on public.table_requests from anon, authenticated;
revoke all on public.table_requests from anon;
create policy table_requests_staff_read on public.table_requests for select to authenticated using ((select public.is_staff()));

alter publication supabase_realtime add table public.table_requests;

-- ───────────────────────── helpers ─────────────────────────
-- The Nairobi day a moment falls on.
create function public.nairobi_day(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$ select (p_at at time zone 'Africa/Nairobi')::date $$;

-- Closes open requests from earlier days (all tables, or one), as of the midnight that ended them,
-- so yesterday's can't block today's unique index or show on today's board.
create function public.close_stale_table_requests(p_table uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.table_requests
     set cleared_at = ((public.nairobi_day(created_at) + 1)::timestamp at time zone 'Africa/Nairobi'),
         auto_cleared = true
   where cleared_at is null
     and public.nairobi_day(created_at) < public.nairobi_today()
     and (p_table is null or table_id = p_table)
$$;
revoke all on function public.close_stale_table_requests(uuid) from public, anon, authenticated;

-- Opens a request for a table, or finds the one already open. `p_order` is null for a menu call.
-- `p_limit_count` is how many requests this caller has made today; the 11th is refused.
create function public.open_table_request(
  p_table uuid, p_kind public.table_request_kind, p_order uuid, p_made_today integer,
  out asked_at timestamptz, out created boolean
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.close_stale_table_requests(p_table);
  -- Already open (from any phone at the table): nothing new, and it doesn't count against the limit.
  select r.created_at into asked_at from public.table_requests r
   where r.table_id = p_table and r.kind = p_kind and r.cleared_at is null;
  if found then
    created := false;
    return;
  end if;
  if p_made_today >= 10 then
    raise exception 'request_limit' using errcode = 'P0001';
  end if;
  insert into public.table_requests (table_id, kind, order_id) values (p_table, p_kind, p_order)
    on conflict (table_id, kind) where cleared_at is null do nothing
    returning table_requests.created_at into asked_at;
  if asked_at is not null then
    created := true;
    return;
  end if;
  -- Another phone's request landed between the check and the insert.
  select r.created_at into asked_at from public.table_requests r
   where r.table_id = p_table and r.kind = p_kind and r.cleared_at is null;
  created := false;
end $$;
revoke all on function public.open_table_request(uuid, public.table_request_kind, uuid, integer) from public, anon, authenticated;

-- ───────────────────────── customers ─────────────────────────
-- From an order's status page: a dine-in order placed today that isn't cancelled or declined.
create function public.request_table_help(p_token uuid, p_kind public.table_request_kind)
returns table (asked_at timestamptz, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_made integer;
begin
  select * into v_order from public.orders where public_token = p_token;
  if v_order.id is null or v_order.mode <> 'dine_in' or v_order.table_id is null then
    raise exception 'request_no_order' using errcode = 'P0001';
  end if;
  if public.nairobi_day(v_order.created_at) <> public.nairobi_today() then
    raise exception 'request_not_today' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'request_cancelled' using errcode = 'P0001';
  end if;
  -- Serialises one order's taps, so the limit can't be raced past.
  perform 1 from public.orders where id = v_order.id for update;
  select count(*) into v_made from public.table_requests r
   where r.order_id = v_order.id and public.nairobi_day(r.created_at) = public.nairobi_today();
  return query select o.asked_at, o.created from public.open_table_request(v_order.table_id, p_kind, v_order.id, v_made) o;
end $$;

-- From the menu at a table (Q1 B): no order needed. The QR token must still be the table's
-- current code, the table active, and the kitchen open.
create function public.request_waiter_at_table(p_qr_token text)
returns table (asked_at timestamptz, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_table uuid;
  v_made integer;
begin
  select t.id into v_table from public.dining_tables t where t.qr_token = p_qr_token and t.active for update;
  if v_table is null then
    raise exception 'request_table_gone' using errcode = 'P0001';
  end if;
  if public.kitchen_status() ->> 'state' is distinct from 'open' then
    raise exception 'request_kitchen_closed' using errcode = 'P0001';
  end if;
  -- Menu calls are counted apart from order-page requests.
  select count(*) into v_made from public.table_requests r
   where r.table_id = v_table and r.order_id is null and r.kind = 'waiter'
     and public.nairobi_day(r.created_at) = public.nairobi_today();
  return query select o.asked_at, o.created from public.open_table_request(v_table, 'waiter', null, v_made) o;
end $$;

-- The menu's button: the open waiter request at this table, else today's latest, as times only. Null if there's
-- none, or the code is no longer the table's.
create function public.table_waiter_status(p_qr_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('asked_at', r.created_at, 'answered_at', case when not r.auto_cleared then r.cleared_at end)
    from public.table_requests r
    join public.dining_tables t on t.id = r.table_id
   where t.qr_token = p_qr_token and t.active
     and r.kind = 'waiter' and public.nairobi_day(r.created_at) = public.nairobi_today()
   order by r.cleared_at is null desc, r.created_at desc
   limit 1
$$;

-- ───────────────────────── staff ─────────────────────────
-- Today's open requests, oldest first. A bill request carries the table's dine-in orders from
-- today that aren't cancelled and are unpaid, or were paid since the request (they stay listed as
-- paid until Done), and the unpaid sum. Closes earlier days' requests first.
create function public.open_table_requests()
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform public.close_stale_table_requests(null);
  return coalesce((
    select jsonb_agg(x.j order by x.created_at, x.id)
    from (
      select r.id, r.created_at, jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'table_id', r.table_id,
        'table_label', t.label,
        'created_at', r.created_at,
        'order_id', r.order_id,
        'orders', case when r.kind = 'bill' then coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', o.id, 'code', o.code, 'customer_name', o.customer_name, 'created_at', o.created_at,
              'status', o.status, 'total_kes', o.total_kes, 'paid', o.payment_status = 'paid',
              'asked', o.id = r.order_id) order by o.created_at, o.number)
            from public.orders o
           where o.table_id = r.table_id and o.mode = 'dine_in' and o.status <> 'cancelled'
             and public.nairobi_day(o.created_at) = public.nairobi_today()
             and (o.payment_status <> 'paid' or o.paid_at >= r.created_at)), '[]'::jsonb) end,
        'unpaid_kes', case when r.kind = 'bill' then (
          select coalesce(sum(o.total_kes), 0)
            from public.orders o
           where o.table_id = r.table_id and o.mode = 'dine_in' and o.status <> 'cancelled'
             and public.nairobi_day(o.created_at) = public.nairobi_today()
             and o.payment_status <> 'paid') end
      ) as j
      from public.table_requests r
      join public.dining_tables t on t.id = r.table_id
      where r.cleared_at is null
    ) x), '[]'::jsonb);
end $$;

-- Done. Returns true if this tap cleared it; false if someone else got there first (no error).
create function public.clear_table_request(p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.table_requests set cleared_at = now(), cleared_by = auth.uid()
   where id = p_id and cleared_at is null;
  return found;
end $$;

-- Done's Undo: 5 s on the tablet, 10 s here for a slow connection (as 2.4). Only by whoever
-- tapped Done, and refused if the table has asked again since.
create function public.undo_clear_table_request(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.table_requests;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v from public.table_requests where id = p_id for update;
  if v.id is null or v.cleared_at is null or v.auto_cleared
     or v.cleared_by is distinct from auth.uid() or v.cleared_at < now() - interval '10 seconds' then
    raise exception 'Too late to undo' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.table_requests r where r.table_id = v.table_id and r.kind = v.kind and r.cleared_at is null) then
    raise exception 'asked_again' using errcode = 'P0001';
  end if;
  update public.table_requests set cleared_at = null, cleared_by = null where id = p_id;
end $$;

-- Mark all paid: 2.4's Mark paid for each order, in one transaction. Returns the orders it changed
-- with the version each Undo needs; an order already paid is skipped (nothing of this tap's to undo).
create function public.mark_orders_paid(p_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_version integer;
  v_out jsonb := '[]'::jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 50 then
    raise exception 'Choose the orders to mark paid' using errcode = 'P0001';
  end if;
  foreach v_id in array (select array_agg(distinct i) from unnest(p_ids) i) loop
    v_version := public.mark_order_paid(v_id);
    if v_version is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'version', v_version));
    end if;
  end loop;
  return v_out;
end $$;

-- Its one Undo: all of them or none, each with its own History line (via unmark_order_paid).
create function public.unmark_orders_paid(p_items jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Too late to undo' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform public.unmark_order_paid((v_item ->> 'id')::uuid, (v_item ->> 'version')::integer);
  end loop;
end $$;

revoke all on function public.request_table_help(uuid, public.table_request_kind) from public;
revoke all on function public.request_waiter_at_table(text) from public;
revoke all on function public.table_waiter_status(text) from public;
revoke all on function public.open_table_requests() from public, anon;
revoke all on function public.clear_table_request(uuid) from public, anon;
revoke all on function public.undo_clear_table_request(uuid) from public, anon;
revoke all on function public.mark_orders_paid(uuid[]) from public, anon;
revoke all on function public.unmark_orders_paid(jsonb) from public, anon;
revoke all on function public.nairobi_day(timestamptz) from public;
grant execute on function public.nairobi_day(timestamptz) to anon, authenticated;
grant execute on function public.request_table_help(uuid, public.table_request_kind) to anon, authenticated;
grant execute on function public.request_waiter_at_table(text) to anon, authenticated;
grant execute on function public.table_waiter_status(text) to anon, authenticated;
grant execute on function public.open_table_requests() to authenticated;
grant execute on function public.clear_table_request(uuid) to authenticated;
grant execute on function public.undo_clear_table_request(uuid) to authenticated;
grant execute on function public.mark_orders_paid(uuid[]) to authenticated;
grant execute on function public.unmark_orders_paid(jsonb) to authenticated;

-- ───────────────────────── the customer's page ─────────────────────────
-- As 2.4's, plus `requests`: for a dine-in order, the latest of each kind at its table today, as
-- times only (never other orders' details), and whether this order made it.
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
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes) order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;
