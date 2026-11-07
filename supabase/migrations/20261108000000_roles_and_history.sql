-- Slice 2.3, roles, delegation and the change record (spec-2.3-roles.md; Tevin's answers 1A, 2, 3B, 4B).
--
--   * staff_grants: four jobs Mama can hand to one person. has_grant() is the one check; owners hold all.
--   * Guard triggers hold every API caller (the dashboard's actions and direct API calls alike) to
--     "The rules" table, raising 42501 with the text staff see. They only judge API callers
--     (auth.role() authenticated or anon): seed data, migrations and maintenance run without a JWT.
--   * change_log: one row per change, written in the same transaction by definer functions only.
--     Nobody can change or delete a row. Order moves are logged by a trigger (4B).
--   * The last owner can't be removed or demoted.
--   * dashboard_stats and delete_dish become owner only; close_early/reopen_today take the
--     close_early grant; copy_menu_day keeps a one-day price only for those who may set prices
--     (Tevin, 2.5 Q1 C, 2026-11-07).

-- ───────────────────────── who is asking ─────────────────────────
-- True for requests through the API. Seed, migrations and psql run with no JWT and are not judged
-- or recorded.
create function public.api_caller() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.role(), '') in ('authenticated', 'anon')
$$;

-- ───────────────────────── grants ─────────────────────────
create type public.staff_grant as enum ('everyday_menu', 'dishes_prices', 'tables_delivery', 'close_early');

create table public.staff_grants (
  user_id uuid not null references public.staff (user_id) on delete cascade,
  job public.staff_grant not null,
  granted_by uuid default auth.uid(), -- no foreign key: it still reads after that person leaves
  granted_at timestamptz not null default now(),
  primary key (user_id, job)
);
alter table public.staff_grants enable row level security;
create policy staff_grants_read on public.staff_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));
create policy staff_grants_owner_write on public.staff_grants for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.staff_grants from anon;

-- Owners hold every job. A grant on an owner changes nothing.
create function public.has_grant(p_job public.staff_grant) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner()
    or exists (select from public.staff_grants g where g.user_id = auth.uid() and g.job = p_job)
$$;
revoke all on function public.has_grant(public.staff_grant) from public, anon;
grant execute on function public.has_grant(public.staff_grant) to authenticated;

-- 2.2's single check: close early follows its grant; hours and till number stay with the owner.
create or replace function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_permission when 'close_early' then public.has_grant('close_early') else public.is_owner() end
$$;

-- ───────────────────────── the change record ─────────────────────────
create type public.change_area as enum ('menu', 'orders', 'tables', 'team', 'settings');

create table public.change_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tx bigint not null default txid_current(), -- lets one save write one line, however many rows it touched
  actor uuid,                                -- no foreign key: the row outlives the person
  actor_name text not null,
  area public.change_area not null,
  action text not null,                      -- a stable key such as 'dish.price'
  subject_id uuid,
  subject_label text,                        -- a copy, so the line reads after the dish or person is gone
  before jsonb,
  after jsonb
);
-- History pages newest first by id (keyset). All leaves out order moves (4B), hence the partial index.
create index change_log_all_idx on public.change_log (id desc) where action <> 'order.move';
create index change_log_area_idx on public.change_log (area, id desc);
create index change_log_actor_idx on public.change_log (actor, id desc);
create index change_log_tx_idx on public.change_log (tx);

alter table public.change_log enable row level security;
create policy change_log_owner_read on public.change_log for select to authenticated using ((select public.is_owner()));
revoke all on public.change_log from anon, authenticated;
grant select on public.change_log to authenticated;

-- Nobody edits or deletes a line, the owner included.
create function public.change_log_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The history can’t be changed.' using errcode = '42501';
end $$;
create trigger change_log_no_edit before update or delete on public.change_log
  for each row execute function public.change_log_frozen();
create trigger change_log_no_truncate before truncate on public.change_log
  for each statement execute function public.change_log_frozen();

-- Writes one line. The actor is whoever is signed in; with nobody signed in it is "The app".
create function public.log_change(
  p_area public.change_area, p_action text, p_subject_id uuid, p_subject_label text,
  p_before jsonb default null, p_after jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
begin
  if v_actor is not null then
    select coalesce(nullif(trim(s.display_name), ''), nullif(split_part(u.email, '@', 1), ''))
      into v_name
      from auth.users u left join public.staff s on s.user_id = u.id
      where u.id = v_actor;
  end if;
  insert into public.change_log (actor, actor_name, area, action, subject_id, subject_label, before, after)
    values (v_actor, coalesce(v_name, 'The app'), p_area, p_action, p_subject_id, p_subject_label, p_before, p_after);
end $$;
revoke all on function public.log_change(public.change_area, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- Row triggers log API changes, except inside a bulk change (copy day, deleting a dish), which
-- writes its own single line.
create function public.row_logging() returns boolean
language sql stable set search_path = '' as $$
  select auth.role() is not null and coalesce(current_setting('dausis.bulk', true), '') <> 'on'
$$;

-- True once this transaction has already written `p_action` (one of several) about `p_subject`.
create function public.logged_in_tx(p_subject uuid, p_actions text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.change_log c
    where c.tx = txid_current() and c.subject_id = p_subject and c.action = any (p_actions)
  )
$$;
revoke all on function public.logged_in_tx(uuid, text[]) from public, anon, authenticated;

create function public.dish_label(p_dish uuid) returns text
language sql stable security definer set search_path = '' as $$
  select name from public.dishes where id = p_dish
$$;
revoke all on function public.dish_label(uuid) from public, anon, authenticated;

create function public.person_label(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(s.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Someone')
  from auth.users u left join public.staff s on s.user_id = u.id
  where u.id = p_user
$$;
revoke all on function public.person_label(uuid) from public, anon, authenticated;

-- ───────────────────────── guards ─────────────────────────
-- Refusal texts (spec "Refused anyway"):
--   Only the owner can change the everyday menu.
--   Only the owner can change dishes and prices.
--   Only the owner can change tables and delivery zones.
--   Only the owner can close the kitchen early.
--   Only the owner can do this.

create function public.guard_dishes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.api_caller() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not public.has_grant('dishes_prices') then
      raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
    end if;
    if new.is_regular and not public.has_grant('everyday_menu') then
      raise exception 'Only the owner can change the everyday menu.' using errcode = '42501';
    end if;
    if new.archived and not public.is_owner() then
      raise exception 'Only the owner can do this.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.archived is distinct from old.archived and not public.is_owner() then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
  -- 3B: words and photo need Dishes and prices too.
  if (new.name, new.description, new.price_kes, new.photo_key, new.photo_url, new.photo_thumb_url, new.category, new.sort_order)
     is distinct from
     (old.name, old.description, old.price_kes, old.photo_key, old.photo_url, old.photo_thumb_url, old.category, old.sort_order)
     and not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  if new.is_regular is distinct from old.is_regular and not public.has_grant('everyday_menu') then
    raise exception 'Only the owner can change the everyday menu.' using errcode = '42501';
  end if;
  -- unavailable_on (on sale today) and last_served_on stay open to all staff.
  return new;
end $$;
create trigger dishes_guard before insert or update or delete on public.dishes
  for each row execute function public.guard_dishes();

create function public.guard_dish_options() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.api_caller() and not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger dish_options_guard before insert or update or delete on public.dish_options
  for each row execute function public.guard_dish_options();

-- Staff plan days and weeks; setting or changing an entry's own price needs Dishes and prices.
create function public.guard_menu_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.api_caller()
     and ((tg_op = 'INSERT' and new.price_kes is not null)
          or (tg_op = 'UPDATE' and new.price_kes is distinct from old.price_kes))
     and not public.has_grant('dishes_prices') then
    raise exception 'Only the owner can change dishes and prices.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger menu_entries_guard before insert or update on public.menu_entries
  for each row execute function public.guard_menu_entries();

create function public.guard_tables_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.api_caller() and not public.has_grant('tables_delivery') then
    raise exception 'Only the owner can change tables and delivery zones.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger dining_tables_guard before insert or update or delete on public.dining_tables
  for each row execute function public.guard_tables_delivery();
create trigger delivery_zones_guard before insert or update or delete on public.delivery_zones
  for each row execute function public.guard_tables_delivery();

-- staff and staff_grants keep their owner-only RLS. On top: there is always an owner.
create function public.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    -- Lock the owner rows, so two owners demoting each other at once can't both pass.
    perform from public.staff where role = 'owner' for update;
    if not exists (select from public.staff s where s.role = 'owner' and s.user_id <> old.user_id) then
      raise exception 'There has to be at least one owner. Make someone else owner first.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_keep_an_owner before update of role or delete on public.staff
  for each row execute function public.keep_an_owner();

-- ───────────────────────── logging: menu ─────────────────────────
create function public.log_dishes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('menu', 'dish.add', new.id, new.name, null,
      jsonb_build_object('price', new.price_kes, 'regular', new.is_regular));
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform public.log_change('menu', 'dish.delete', old.id, old.name);
    return null;
  end if;
  if new.archived is distinct from old.archived then
    -- Archiving also takes it off the everyday menu; that is part of the same line.
    perform public.log_change('menu', case when new.archived then 'dish.archive' else 'dish.restore' end, new.id, new.name);
  elsif new.is_regular is distinct from old.is_regular then
    perform public.log_change('menu', case when new.is_regular then 'dish.regular_on' else 'dish.regular_off' end, new.id, new.name);
  end if;
  if new.name is distinct from old.name then
    perform public.log_change('menu', 'dish.rename', new.id, new.name,
      jsonb_build_object('name', old.name), jsonb_build_object('name', new.name));
  end if;
  if new.price_kes is distinct from old.price_kes then
    perform public.log_change('menu', 'dish.price', new.id, new.name,
      jsonb_build_object('price', old.price_kes), jsonb_build_object('price', new.price_kes));
  end if;
  -- Description or photo: one line, no old text kept. The photo is its key, its URL and its
  -- thumbnail; a change to any of them is a photo change (RQA23-01).
  if new.description is distinct from old.description
     or (new.photo_key, new.photo_url, new.photo_thumb_url)
        is distinct from (old.photo_key, old.photo_url, old.photo_thumb_url) then
    perform public.log_change('menu', 'dish.words', new.id, new.name, null, jsonb_build_object(
      'description', new.description is distinct from old.description,
      'photo', (new.photo_key, new.photo_url, new.photo_thumb_url)
               is distinct from (old.photo_key, old.photo_url, old.photo_thumb_url)));
  end if;
  if new.category is distinct from old.category then
    perform public.log_change('menu', 'dish.category', new.id, new.name,
      jsonb_build_object('category', old.category), jsonb_build_object('category', new.category));
  end if;
  -- Where it sits on the menu customers see.
  if new.sort_order is distinct from old.sort_order then
    perform public.log_change('menu', 'dish.order', new.id, new.name,
      jsonb_build_object('order', old.sort_order), jsonb_build_object('order', new.sort_order));
  end if;
  -- On sale today: only a real change counts (an old date cleared is already on sale).
  if new.unavailable_on is distinct from old.unavailable_on and not new.archived then
    if new.unavailable_on = v_today then
      perform public.log_change('menu', 'dish.sale_off', new.id, new.name);
    elsif old.unavailable_on = v_today then
      perform public.log_change('menu', 'dish.sale_on', new.id, new.name);
    end if;
  end if;
  return null;
end $$;
create trigger dishes_log after insert or update or delete on public.dishes
  for each row execute function public.log_dishes();

-- A dish's options are saved together: one line per dish per save. Not logged for a dish added
-- or deleted in the same change.
create function public.log_dish_options() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dish uuid := coalesce(new.dish_id, old.dish_id);
  v_name text := public.dish_label(v_dish);
begin
  if not public.row_logging() or v_name is null
     or public.logged_in_tx(v_dish, array['dish.options', 'dish.add']) then
    return null;
  end if;
  perform public.log_change('menu', 'dish.options', v_dish, v_name);
  return null;
end $$;
create trigger dish_options_log after insert or update or delete on public.dish_options
  for each row execute function public.log_dish_options();

create function public.entry_json(e public.menu_entries) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('kind', e.kind, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
                            'price', e.price_kes, 'plates', e.plates_per_day)
$$;

create function public.log_menu_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dish uuid := coalesce(new.dish_id, old.dish_id);
  v_name text := public.dish_label(v_dish);
  v_id uuid := coalesce(new.id, old.id);
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('menu', 'entry.add', v_dish, v_name, null, public.entry_json(new));
  elsif tg_op = 'DELETE' then
    if old.published and old.ended_early_at is null then
      perform public.log_change('menu', 'entry.remove', v_dish, v_name, public.entry_json(old));
    end if;
  else
    if old.published and not new.published then
      perform public.log_change('menu', 'entry.remove', v_dish, v_name, public.entry_json(old));
      return null;
    end if;
    if old.ended_early_at is null and new.ended_early_at is not null then
      perform public.log_change('menu', 'entry.end_early', v_dish, v_name, null, public.entry_json(new));
    end if;
    if new.price_kes is distinct from old.price_kes then
      perform public.log_change('menu', 'entry.price', v_dish, v_name, public.entry_json(old), public.entry_json(new));
    end if;
    if new.plates_per_day is distinct from old.plates_per_day then
      perform public.log_change('menu', 'entry.plates', v_dish, v_name, public.entry_json(old), public.entry_json(new));
    end if;
    -- Anything else about the plan (its dish, days, show window, sold-out setting, order, putting
    -- it back on the menu or undoing an early end): one line, so no change goes unrecorded.
    if (new.dish_id, new.kind, new.starts_on, new.ends_on, new.show_from, new.show_until,
        new.auto_hide_sold_out, new.published, new.sort_order)
       is distinct from (old.dish_id, old.kind, old.starts_on, old.ends_on, old.show_from, old.show_until,
        old.auto_hide_sold_out, old.published, old.sort_order)
       or (old.ended_early_at is not null and new.ended_early_at is distinct from old.ended_early_at) then
      perform public.log_change('menu', 'entry.change', v_dish, v_name, public.entry_json(old), public.entry_json(new));
    end if;
  end if;
  return null;
end $$;
create trigger menu_entries_log after insert or update or delete on public.menu_entries
  for each row execute function public.log_menu_entries();

-- Planned dish marked sold out, or back. plates_sold is not a change anyone made.
create function public.log_menu_entry_days() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dish uuid;
begin
  if not public.row_logging() then return null; end if;
  if new.sold_out_manual is not distinct from (case when tg_op = 'INSERT' then false else old.sold_out_manual end) then
    return null;
  end if;
  select dish_id into v_dish from public.menu_entries where id = new.entry_id;
  perform public.log_change('menu', case when new.sold_out_manual then 'entry.sold_out' else 'entry.back' end,
    v_dish, public.dish_label(v_dish), null, jsonb_build_object('day', new.day));
  return null;
end $$;
create trigger menu_entry_days_log after insert or update on public.menu_entry_days
  for each row execute function public.log_menu_entry_days();

-- ───────────────────────── logging: orders ─────────────────────────
create function public.order_label(o public.orders) returns text
language sql immutable set search_path = '' as $$
  select o.code || ' (' || o.customer_name || ')'
$$;

-- Every move on the board (4B), by whatever path, including one made with nobody signed in
-- ("The app"). A cancel is logged by cancel_order instead.
create function public.log_order_move() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'cancelled' then
    perform public.log_change('orders', 'order.move', new.id, public.order_label(new),
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;
create trigger orders_log_move after update of status on public.orders
  for each row execute function public.log_order_move();

create or replace function public.cancel_order(p_order uuid, p_from public.order_status)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
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
  update public.orders set status = 'cancelled' where id = p_order;
  perform public.log_change('orders', 'order.cancel', v_order.id, public.order_label(v_order),
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled'));
end $$;

-- Allowed in any status for now (Tevin, 2026-11-05). A second tap on a paid order records nothing.
create or replace function public.mark_order_paid(p_order uuid)
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
  if v_order.payment_status is distinct from 'paid' then
    update public.orders set payment_status = 'paid' where id = p_order;
    perform public.log_change('orders', 'order.paid', v_order.id, public.order_label(v_order),
      jsonb_build_object('payment', v_order.payment_status), jsonb_build_object('payment', 'paid'));
  end if;
end $$;

-- ───────────────────────── logging: tables and delivery ─────────────────────────
create function public.log_dining_tables() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('tables', 'table.add', new.id, new.label);
  elsif tg_op = 'DELETE' then
    perform public.log_change('tables', 'table.delete', old.id, old.label);
  else
    if new.label is distinct from old.label then
      perform public.log_change('tables', 'table.rename', new.id, new.label,
        jsonb_build_object('label', old.label), jsonb_build_object('label', new.label));
    end if;
    if new.active is distinct from old.active then
      perform public.log_change('tables', case when new.active then 'table.on' else 'table.off' end, new.id, new.label);
    end if;
    if new.qr_token is distinct from old.qr_token then
      perform public.log_change('tables', 'table.new_code', new.id, new.label);
    end if;
  end if;
  return null;
end $$;
create trigger dining_tables_log after insert or update or delete on public.dining_tables
  for each row execute function public.log_dining_tables();

create function public.log_delivery_zones() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('tables', 'zone.add', new.id, new.name, null, jsonb_build_object('fee', new.fee_kes));
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
    if new.active is distinct from old.active then
      perform public.log_change('tables', case when new.active then 'zone.on' else 'zone.off' end, new.id, new.name);
    end if;
    -- Where it sits in the checkout's list.
    if new.sort_order is distinct from old.sort_order then
      perform public.log_change('tables', 'zone.order', new.id, new.name,
        jsonb_build_object('order', old.sort_order), jsonb_build_object('order', new.sort_order));
    end if;
  end if;
  return null;
end $$;
create trigger delivery_zones_log after insert or update or delete on public.delivery_zones
  for each row execute function public.log_delivery_zones();

-- ───────────────────────── logging: team ─────────────────────────
create function public.log_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('team', 'staff.add', new.user_id, public.person_label(new.user_id), null,
      jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform public.log_change('team', 'staff.remove', old.user_id,
      coalesce(nullif(trim(old.display_name), ''), public.person_label(old.user_id), 'Someone'));
  elsif new.role is distinct from old.role then
    perform public.log_change('team', 'staff.role', new.user_id, public.person_label(new.user_id),
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  return null;
end $$;
create trigger staff_log after insert or update or delete on public.staff
  for each row execute function public.log_staff();

-- A grant removed because the person left is covered by "removed from the team". A grant changed
-- in place (another job or another person) is the old one off and the new one on (RQA23-02);
-- who granted it and when are bookkeeping, not a change.
create function public.log_staff_grants() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'UPDATE' and (new.user_id, new.job) is not distinct from (old.user_id, old.job) then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (select from public.staff where user_id = old.user_id) then
    perform public.log_change('team', 'grant.off', old.user_id, public.person_label(old.user_id),
      jsonb_build_object('job', old.job), null);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.log_change('team', 'grant.on', new.user_id, public.person_label(new.user_id), null,
      jsonb_build_object('job', new.job));
  end if;
  return null;
end $$;
create trigger staff_grants_log after insert or update or delete on public.staff_grants
  for each row execute function public.log_staff_grants();

-- ───────────────────────── logging: settings ─────────────────────────
create function public.log_opening_hours() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if (new.is_open, new.opens, new.closes) is distinct from (old.is_open, old.opens, old.closes) then
    perform public.log_change('settings', 'hours.day', null,
      (array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])[new.weekday + 1],
      jsonb_build_object('is_open', old.is_open, 'opens', to_char(old.opens, 'HH24:MI'), 'closes', to_char(old.closes, 'HH24:MI')),
      jsonb_build_object('is_open', new.is_open, 'opens', to_char(new.opens, 'HH24:MI'), 'closes', to_char(new.closes, 'HH24:MI')));
  end if;
  return null;
end $$;
create trigger opening_hours_log after update on public.opening_hours
  for each row execute function public.log_opening_hours();

create function public.log_closed_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.row_logging() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_change('settings', 'closed_date.add', null, null, null,
      jsonb_build_object('day', new.day, 'note', new.note));
  elsif tg_op = 'DELETE' then
    perform public.log_change('settings', 'closed_date.remove', null, null,
      jsonb_build_object('day', old.day, 'note', old.note), null);
  elsif (new.day, new.note) is distinct from (old.day, old.note) then
    -- Moved to another day, or its note changed (RQA23-03).
    perform public.log_change('settings', 'closed_date.change', null, null,
      jsonb_build_object('day', old.day, 'note', old.note), jsonb_build_object('day', new.day, 'note', new.note));
  end if;
  return null;
end $$;
create trigger closed_dates_log after insert or update or delete on public.closed_dates
  for each row execute function public.log_closed_dates();

create function public.log_kitchen_settings() returns trigger
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
  if new.closed_early_on is not null and old.closed_early_on is distinct from new.closed_early_on then
    perform public.log_change('settings', 'kitchen.close_early', null, null, null,
      jsonb_build_object('at', new.closed_early_at));
  elsif new.closed_early_on is null and old.closed_early_on = public.nairobi_today() then
    perform public.log_change('settings', 'kitchen.reopen', null, null);
  end if;
  return null;
end $$;
create trigger kitchen_settings_log after update on public.kitchen_settings
  for each row execute function public.log_kitchen_settings();

-- ───────────────────────── RPCs that change hands ─────────────────────────
create or replace function public.close_early() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status jsonb;
begin
  if not public.has_permission('close_early') then
    raise exception 'Only the owner can close the kitchen early.' using errcode = '42501';
  end if;
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

create or replace function public.reopen_today() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('close_early') then
    raise exception 'Only the owner can close the kitchen early.' using errcode = '42501';
  end if;
  update public.kitchen_settings
    set closed_early_on = null, closed_early_at = null, closed_early_by = null
    where id and closed_early_on = public.nairobi_today();
  return public.kitchen_status();
end $$;

-- Copy day (Tevin, 2.5 Q1 C): a copied entry keeps its one-day price only when the person copying
-- may set prices; for other staff the dish goes on at its usual price. One History line, not one
-- per dish.
create or replace function public.copy_menu_day(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_prices boolean := public.has_grant('dishes_prices');
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('dausis.bulk', 'on', true);
  insert into public.menu_entries (dish_id, kind, starts_on, ends_on, price_kes, plates_per_day,
                                   show_from, show_until, auto_hide_sold_out, published, sort_order)
  select dish_id, 'day', p_to, p_to, case when v_prices then price_kes end, plates_per_day,
         show_from, show_until, auto_hide_sold_out, true, sort_order
  from public.menu_entries
  where kind = 'day' and starts_on = p_from and ended_early_at is null
  on conflict do nothing;
  get diagnostics v_count = row_count;
  perform set_config('dausis.bulk', '', true);
  if v_count > 0 then
    perform public.log_change('menu', 'menu.copy_day', null, null, null,
      jsonb_build_object('from', p_from, 'to', p_to, 'count', v_count));
  end if;
  return v_count;
end $$;

-- Deleting, archiving and restoring dishes are the owner's. The dish's line comes from its row
-- trigger; the menu entries it clears out are part of that line.
create or replace function public.delete_dish(p_dish uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_dish public.dishes;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into v_dish from public.dishes where id = p_dish for update;
  if v_dish.id is null then return jsonb_build_object('result', 'missing'); end if;

  if not exists (select 1 from public.order_items where dish_id = p_dish) then
    begin
      perform set_config('dausis.bulk', 'on', true);
      delete from public.menu_entries where dish_id = p_dish;
      perform set_config('dausis.bulk', '', true);
      delete from public.dishes where id = p_dish;
      return jsonb_build_object('result', 'deleted', 'photo_key', v_dish.photo_key);
    exception when foreign_key_violation then
      -- An order arrived after the check: keep the dish and archive it below.
      null;
    end;
  end if;

  update public.dishes set archived = true, is_regular = false where id = p_dish;
  perform set_config('dausis.bulk', 'on', true);
  update public.menu_entries set published = false where dish_id = p_dish and ends_on >= public.nairobi_today();
  perform set_config('dausis.bulk', '', true);
  return jsonb_build_object('result', 'archived');
end $$;

-- Sales figures are the owner's.
create or replace function public.dashboard_stats(p_day date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  with day_orders as (
    select * from public.orders
    where (created_at at time zone 'Africa/Nairobi')::date = p_day and status <> 'cancelled'
  )
  select jsonb_build_object(
    'revenue_kes', coalesce((select sum(total_kes) from day_orders), 0),
    'paid_kes', coalesce((select sum(total_kes) from day_orders where payment_status = 'paid'), 0),
    'unpaid_kes', coalesce((select sum(total_kes) from day_orders where payment_status <> 'paid'), 0),
    'orders', (select count(*) from day_orders),
    'by_mode', coalesce((select jsonb_object_agg(mode::text, n) from (select mode, count(*) n from day_orders group by mode) m), '{}'::jsonb),
    'by_payment', coalesce((select jsonb_object_agg(payment_method::text, n) from (select payment_method, count(*) n from day_orders group by payment_method) m), '{}'::jsonb),
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

-- Hours and the till number stay the owner's; the refusal now says so.
create or replace function public.save_opening_hours(p_days jsonb, p_last_orders_minutes integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day jsonb;
begin
  if not public.has_permission('hours') then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
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

create or replace function public.set_till_number(p_till text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_till text := nullif(trim(coalesce(p_till, '')), '');
begin
  if not public.has_permission('till_number') then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if v_till is not null and v_till !~ '^[0-9]{5,10}$' then
    raise exception 'A till number is 5 to 10 digits, with no spaces.' using errcode = 'P0001';
  end if;
  update public.kitchen_settings set till_number = v_till where id;
  return v_till;
end $$;

-- Trigger and helper functions are never called directly.
revoke all on function public.guard_dishes() from public, anon, authenticated;
revoke all on function public.guard_dish_options() from public, anon, authenticated;
revoke all on function public.guard_menu_entries() from public, anon, authenticated;
revoke all on function public.guard_tables_delivery() from public, anon, authenticated;
revoke all on function public.keep_an_owner() from public, anon, authenticated;
revoke all on function public.change_log_frozen() from public, anon, authenticated;
revoke all on function public.log_dishes() from public, anon, authenticated;
revoke all on function public.log_dish_options() from public, anon, authenticated;
revoke all on function public.log_menu_entries() from public, anon, authenticated;
revoke all on function public.log_menu_entry_days() from public, anon, authenticated;
revoke all on function public.log_order_move() from public, anon, authenticated;
revoke all on function public.log_dining_tables() from public, anon, authenticated;
revoke all on function public.log_delivery_zones() from public, anon, authenticated;
revoke all on function public.log_staff() from public, anon, authenticated;
revoke all on function public.log_staff_grants() from public, anon, authenticated;
revoke all on function public.log_opening_hours() from public, anon, authenticated;
revoke all on function public.log_closed_dates() from public, anon, authenticated;
revoke all on function public.log_kitchen_settings() from public, anon, authenticated;

-- History's "Everyone" select (spec-2.3): each person who appears in the record, with the name
-- they last had there, and whether they're still on the team. Invoker rights, so the change_log
-- policy (owners only) decides who gets rows; staff get none.
create function public.history_people()
returns table (actor uuid, actor_name text, on_team boolean)
language sql stable security invoker set search_path = '' as $$
  select p.actor, p.actor_name, exists (select from public.staff s where s.user_id = p.actor)
  from (
    select distinct on (c.actor) c.actor, c.actor_name
    from public.change_log c
    where c.actor is not null
    order by c.actor, c.id desc
  ) p
  order by lower(p.actor_name)
$$;
revoke all on function public.history_people() from public, anon;
grant execute on function public.history_people() to authenticated;

-- ───────────────────────── writes that would skip the record ─────────────────────────
-- Opening hours are changed only through save_opening_hours (each update logged); a row added or
-- removed directly would change the week with no line. Day rows (sold out, plates sold) are
-- written only by place_order, set_entry_sold_out and release_plates_on_cancel. Both stay
-- readable; nobody writes them directly through the API.
revoke insert, delete on public.opening_hours from anon, authenticated;
revoke insert, update, delete on public.menu_entry_days from anon, authenticated;
