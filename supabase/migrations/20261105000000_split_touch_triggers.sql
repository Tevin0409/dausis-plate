-- Fix: every dish update failed with `record "new" has no field "status"`.
-- touch_updated_at read new.status in a compound condition that PL/pgSQL resolves
-- even on `dishes`, which has no status column. Split it in two:
--   touch_updated_at   generic, only stamps updated_at (dishes)
--   touch_order_update orders only, stamps updated_at and status_changed_at

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.touch_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

drop trigger orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_order_update();

