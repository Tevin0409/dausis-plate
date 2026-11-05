-- Order lifecycle in the database. Allowed status moves live in one table, a trigger holds every
-- role to it, and staff change orders only through the RPCs below.
-- completed and cancelled have no way out, so the release_plates_on_cancel trigger can fire at
-- most once per order. To add a step, add its enum value and rows here.

create table public.order_transitions (
  from_status public.order_status not null,
  to_status public.order_status not null,
  primary key (from_status, to_status)
);
insert into public.order_transitions (from_status, to_status) values
  ('new', 'preparing'),
  ('preparing', 'ready'),
  ('ready', 'completed'),
  ('new', 'cancelled'),
  ('preparing', 'cancelled'),
  ('ready', 'cancelled');

-- Read only by the definer functions below.
alter table public.order_transitions enable row level security;
revoke all on public.order_transitions from anon, authenticated, service_role;

create function public.guard_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and not exists (
    select from public.order_transitions t where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'Order can''t move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_order_status() from public, anon, authenticated, service_role;

create trigger orders_status_guard before update of status on public.orders
  for each row execute function public.guard_order_status();

-- A move on the board. p_from is the status the staff member saw, so two tablets tapping at once
-- can't skip a step. Cancelling has its own function.
create function public.advance_order(p_order uuid, p_from public.order_status, p_to public.order_status)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_to = 'cancelled' or not exists (
    select from public.order_transitions t where t.from_status = p_from and t.to_status = p_to
  ) then
    raise exception 'Order can''t move from % to %', p_from, p_to using errcode = 'P0001';
  end if;
  update public.orders set status = p_to where id = p_order and status = p_from;
  if not found then
    raise exception 'Someone else already moved this order' using errcode = 'P0001';
  end if;
end $$;

create function public.cancel_order(p_order uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.order_status;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- Locked so a cancel racing a final move sees that move's result.
  select status into v_status from public.orders where id = p_order for update;
  if v_status is null then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if not exists (
    select from public.order_transitions t where t.from_status = v_status and t.to_status = 'cancelled'
  ) then
    raise exception 'This order is already %', v_status using errcode = 'P0001';
  end if;
  update public.orders set status = 'cancelled' where id = p_order;
end $$;

-- Allowed in any status for now, cancelled included (Tevin, 2026-11-05; settled in slice 2.12).
create function public.mark_order_paid(p_order uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.orders set payment_status = 'paid' where id = p_order;
  if not found then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.advance_order(uuid, public.order_status, public.order_status) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.mark_order_paid(uuid) from public, anon;
grant execute on function public.advance_order(uuid, public.order_status, public.order_status) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.mark_order_paid(uuid) to authenticated;

-- Staff read orders; they no longer write them directly. place_order (definer) and the
-- payment callback (service role) are unaffected.
revoke insert, update, delete, truncate on public.orders, public.order_items from anon, authenticated;

drop policy orders_staff on public.orders;
create policy orders_staff on public.orders for select to authenticated using ((select public.is_staff()));
drop policy order_items_staff on public.order_items;
create policy order_items_staff on public.order_items for select to authenticated using ((select public.is_staff()));
