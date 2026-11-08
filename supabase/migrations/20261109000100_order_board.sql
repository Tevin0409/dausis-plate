-- Slice 2.4: the order board (spec-2.4-order-board.md, "Build notes").
-- On the way for deliveries, Decline and Cancel with a reason, a 5-second undo on moves and on
-- Mark paid (10 s on the server, for a slow connection), and the customer's 5-second delay.

-- ───────────────────────── steps ─────────────────────────
-- Delivery: ready → on_the_way → completed. Dine-in and pickup: ready → completed. The mode rule
-- is in the guard below, so it holds for every path, not just advance_order.
insert into public.order_transitions (from_status, to_status) values
  ('ready', 'on_the_way'),
  ('on_the_way', 'completed'),
  ('on_the_way', 'cancelled');

-- ───────────────────────── columns ─────────────────────────
create type public.cancel_reason as enum ('sold_out', 'too_busy', 'cant_deliver', 'customer_asked', 'no_show', 'other');

alter table public.orders
  add column cancel_reason public.cancel_reason,
  add column cancel_note text,
  -- The status before the last move: the customer sees it while the move is under 5 s old.
  add column prev_status public.order_status,
  -- Set by Mark paid only (not by a payment callback), with the payment it replaced, so its undo
  -- puts back exactly what was there.
  add column paid_at timestamptz,
  add column paid_from public.payment_status,
  -- Goes up by one on every change to the order. A move and Mark paid return it, and their Undo
  -- must send it back: any change since (another move, an undo and redo, a payment, a cancel)
  -- makes the Undo refuse, even if the order ended up in the same status (QA RQA24-01).
  add column version integer not null default 0,
  add constraint orders_cancel_note_check check (
    (cancel_reason is distinct from 'other' and cancel_note is null)
    or (cancel_reason = 'other' and char_length(cancel_note) between 3 and 120)
  );

-- ───────────────────────── triggers ─────────────────────────
-- undo_order_move sets dausis.undo for its one update: the only backward step, and only the exact
-- reverse of an allowed forward one. order_transitions stays forward-only.
create or replace function public.guard_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_undo boolean := coalesce(current_setting('dausis.undo', true), '') = 'on';
begin
  if new.status is distinct from old.status then
    if v_undo then
      if old.status = 'cancelled' or not exists (
        select from public.order_transitions t where t.from_status = new.status and t.to_status = old.status
      ) then
        raise exception 'Order can''t move back from % to %', old.status, new.status using errcode = 'P0001';
      end if;
    elsif not exists (
      select from public.order_transitions t where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'Order can''t move from % to %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status = 'on_the_way' and new.mode <> 'delivery' then
      raise exception 'Only a delivery goes on the way' using errcode = 'P0001';
    end if;
    if not v_undo and old.status = 'ready' and new.status = 'completed' and new.mode = 'delivery' then
      raise exception 'A delivery goes on the way first' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_order_status() from public, anon, authenticated, service_role;

create or replace function public.touch_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    -- An undo sets prev_status itself (to the status it restores), so the customer sees no change.
    if coalesce(current_setting('dausis.undo', true), '') <> 'on' then
      new.prev_status := old.status;
    end if;
  end if;
  return new;
end $$;

-- An undone move is logged as its own action, so the History says "undid moving … to Ready"
-- rather than showing a second move. before.status is the step that was undone.
create or replace function public.log_order_move() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'cancelled' then
    perform public.log_change('orders',
      case when coalesce(current_setting('dausis.undo', true), '') = 'on' then 'order.move_undo' else 'order.move' end,
      new.id, public.order_label(new),
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;

-- ───────────────────────── Decline and Cancel ─────────────────────────
-- Any open status (Tevin, Q2 B). p_from is the status the tap saw, as before. The reason checks
-- come after the stale check, so a tap on an order that moved on is refused as stale (P0001) and
-- goes to the strip; a bad reason is a form error (22023), which the app's own checks prevent.
drop function public.cancel_order(uuid, public.order_status);
create function public.cancel_order(
  p_order uuid, p_from public.order_status, p_reason public.cancel_reason, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_note text := nullif(btrim(p_note), '');
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- Locked so a cancel racing a final move sees that move's result.
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if v_order.status is distinct from p_from and v_order.status not in ('completed', 'cancelled') then
    raise exception 'Someone else already moved this order' using errcode = 'P0001';
  end if;
  if not exists (
    select from public.order_transitions t where t.from_status = v_order.status and t.to_status = 'cancelled'
  ) then
    raise exception 'This order is already %', v_order.status using errcode = 'P0001';
  end if;
  if p_reason is null then
    raise exception 'Choose a reason' using errcode = '22023';
  end if;
  if p_reason = 'other' then
    if v_note is null or char_length(v_note) not between 3 and 120 then
      raise exception 'Say why in a few words.' using errcode = '22023';
    end if;
  else
    v_note := null;
  end if;
  if p_reason = 'cant_deliver' and v_order.mode <> 'delivery' then
    raise exception 'Only a delivery can be refused for its area' using errcode = '22023';
  end if;
  if p_reason = 'no_show' and (v_order.mode = 'dine_in' or v_order.status not in ('ready', 'on_the_way')) then
    raise exception 'Only a pickup or delivery that is ready can be a no-show' using errcode = '22023';
  end if;
  update public.orders set status = 'cancelled', cancel_reason = p_reason, cancel_note = v_note where id = p_order;
  perform public.log_change('orders', 'order.cancel', v_order.id, public.order_label(v_order),
    jsonb_build_object('status', v_order.status),
    jsonb_strip_nulls(jsonb_build_object('status', 'cancelled', 'reason', p_reason, 'note', v_note)));
end $$;

-- ───────────────────────── moves ─────────────────────────
-- As 0.2's advance_order, now returning the order's version after the move, for its Undo.
drop function public.advance_order(uuid, public.order_status, public.order_status);
create function public.advance_order(p_order uuid, p_from public.order_status, p_to public.order_status)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_version integer;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_to = 'cancelled' or not exists (
    select from public.order_transitions t where t.from_status = p_from and t.to_status = p_to
  ) then
    raise exception 'Order can''t move from % to %', p_from, p_to using errcode = 'P0001';
  end if;
  update public.orders set status = p_to where id = p_order and status = p_from returning version into v_version;
  if not found then
    raise exception 'Someone else already moved this order' using errcode = 'P0001';
  end if;
  return v_version;
end $$;

-- ───────────────────────── undo ─────────────────────────
-- The tablet shows Undo for 5 s; the server allows 10 s, and only while the order is exactly as
-- that move left it: p_version is what advance_order returned, so any change since refuses it
-- (so not twice, never after someone else's change, and never a Decline or Cancel).
create function public.undo_order_move(p_order uuid, p_status public.order_status, p_version integer)
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
     or v_order.status is distinct from p_status
     or v_order.status = 'cancelled'
     or v_order.prev_status is null
     or v_order.prev_status = v_order.status
     or v_order.status_changed_at < now() - interval '10 seconds'
     or not exists (
       select from public.order_transitions t where t.from_status = v_order.prev_status and t.to_status = v_order.status
     ) then
    raise exception 'Too late to undo' using errcode = 'P0001';
  end if;
  perform set_config('dausis.undo', 'on', true);
  update public.orders set status = v_order.prev_status, prev_status = v_order.prev_status where id = p_order;
  perform set_config('dausis.undo', '', true);
end $$;

-- Mark paid now remembers when, and what it replaced, and returns the version its Undo needs.
-- A second tap still records nothing and returns null: there is nothing of this tap's to undo.
drop function public.mark_order_paid(uuid);
create function public.mark_order_paid(p_order uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_version integer;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if v_order.payment_status is distinct from 'paid' then
    update public.orders set payment_status = 'paid', paid_at = now(), paid_from = v_order.payment_status where id = p_order
      returning version into v_version;
    perform public.log_change('orders', 'order.paid', v_order.id, public.order_label(v_order),
      jsonb_build_object('payment', v_order.payment_status), jsonb_build_object('payment', 'paid'));
  end if;
  return v_version;
end $$;

-- p_version is what mark_order_paid returned: any change to the order since refuses the Undo.
create function public.unmark_order_paid(p_order uuid, p_version integer)
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
     or v_order.paid_at < now() - interval '10 seconds' then
    raise exception 'Too late to undo' using errcode = 'P0001';
  end if;
  update public.orders set payment_status = coalesce(v_order.paid_from, 'unpaid'), paid_at = null, paid_from = null
    where id = p_order;
  perform public.log_change('orders', 'order.paid_undo', v_order.id, public.order_label(v_order),
    jsonb_build_object('payment', 'paid'), jsonb_build_object('payment', coalesce(v_order.paid_from, 'unpaid')));
end $$;

revoke all on function public.cancel_order(uuid, public.order_status, public.cancel_reason, text) from public, anon;
revoke all on function public.advance_order(uuid, public.order_status, public.order_status) from public, anon;
revoke all on function public.undo_order_move(uuid, public.order_status, integer) from public, anon;
revoke all on function public.mark_order_paid(uuid) from public, anon;
revoke all on function public.unmark_order_paid(uuid, integer) from public, anon;
grant execute on function public.cancel_order(uuid, public.order_status, public.cancel_reason, text) to authenticated;
grant execute on function public.advance_order(uuid, public.order_status, public.order_status) to authenticated;
grant execute on function public.undo_order_move(uuid, public.order_status, integer) to authenticated;
grant execute on function public.mark_order_paid(uuid) to authenticated;
grant execute on function public.unmark_order_paid(uuid, integer) to authenticated;

-- ───────────────────────── the customer's page ─────────────────────────
-- A move shows only once it is 5 s old, so an undone move is never seen. A Decline or Cancel has
-- no undo and shows at once, with its reason.
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
    -- Declined (cancelled from New) and cancelled after Accept get different headlines.
    'declined', o.status = 'cancelled' and o.prev_status = 'new',
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
