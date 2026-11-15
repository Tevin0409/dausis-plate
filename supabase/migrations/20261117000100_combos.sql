-- 2.11 part B: combos (spec 2.11 "B. Combos", Q5 A fixed dishes, Q6 A choices and extras on top).
-- A combo is a name, 2–4 fixed dishes (counting quantities) and a set price below their everyday total.
-- Writes go only through save_combo and combo_action (owner only, logged to History);
-- anyone can read active combos, as with dishes. place_order learns combos in a later migration,
-- built on the composed wave-2 definition.

create table public.combos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  price_kes integer not null check (price_kes > 0 and price_kes <= 99999),
  active boolean not null default true,
  archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.combo_items (
  combo_id uuid not null references public.combos (id) on delete cascade,
  dish_id uuid not null references public.dishes (id),
  quantity integer not null check (quantity between 1 and 4),
  sort_order integer not null default 0,
  primary key (combo_id, dish_id)
);
create index combo_items_dish_idx on public.combo_items (dish_id);

alter table public.combos enable row level security;
alter table public.combo_items enable row level security;
create policy combos_public_read on public.combos for select
  using (not archived or (select public.is_staff()));
create policy combo_items_public_read on public.combo_items for select
  using (exists (select 1 from public.combos c where c.id = combo_id and (not c.archived or (select public.is_staff()))));
revoke all on public.combos, public.combo_items from anon, authenticated;
grant select on public.combos, public.combo_items to anon, authenticated;

-- What a combo row looks like in History (before/after of an edit).
create function public.combo_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'price_kes', c.price_kes,
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('dish_id', i.dish_id, 'name', d.name, 'quantity', i.quantity)
                                         order by i.sort_order)
                        from public.combo_items i join public.dishes d on d.id = i.dish_id
                        where i.combo_id = c.id), '[]'::jsonb))
  from public.combos c where c.id = p_id
$$;
revoke all on function public.combo_snapshot(uuid) from public, anon, authenticated;

-- save_combo({id?, name, price_kes, items:[{dish_id, quantity}]}) → the combo id.
-- Refusals are P0001 with a detail: combo_name, combo_items, combo_dish, combo_price, combo_no_saving, combo_missing.
create function public.save_combo(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_price integer;
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_total integer := 0;
  v_count integer;
  v_distinct integer;
  v_everyday integer;
  v_before jsonb;
  v_after jsonb;
  v_combo public.combos;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Give the combo a name of up to 40 characters.' using errcode = 'P0001', detail = 'combo_name';
  end if;
  begin
    v_price := (p->>'price_kes')::integer;
  exception when others then v_price := null;
  end;
  if v_price is null or v_price <= 0 or v_price > 99999 then
    raise exception 'Enter a price in shillings.' using errcode = 'P0001', detail = 'combo_price';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Pick 2 to 4 dishes.' using errcode = 'P0001', detail = 'combo_items';
  end if;

  -- Each dish once, quantity 1–4, 2–4 in total.
  select count(*), coalesce(sum((x->>'quantity')::integer), 0), count(distinct x->>'dish_id')
    into v_count, v_total, v_distinct
  from jsonb_array_elements(v_items) x;
  if exists (select 1 from jsonb_array_elements(v_items) x
             where coalesce((x->>'quantity')::integer, 0) not between 1 and 4) then
    raise exception 'Each dish can be in a combo 1 to 4 times.' using errcode = 'P0001', detail = 'combo_items';
  end if;
  if v_distinct <> v_count then
    raise exception 'Each dish goes in once. Use its quantity for more.' using errcode = 'P0001', detail = 'combo_items';
  end if;
  if v_total not between 2 and 4 then
    raise exception 'A combo has 2 to 4 dishes in total.' using errcode = 'P0001', detail = 'combo_items';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) x
             left join public.dishes d on d.id = (x->>'dish_id')::uuid and not d.archived
             where d.id is null) then
    raise exception 'One of those dishes isn’t there any more.' using errcode = 'P0001', detail = 'combo_dish';
  end if;

  select sum(d.price_kes * (x->>'quantity')::integer) into v_everyday
  from jsonb_array_elements(v_items) x join public.dishes d on d.id = (x->>'dish_id')::uuid;
  if v_price >= v_everyday then
    raise exception 'Price it below % so it’s a deal.', 'KSh ' || to_char(v_everyday, 'FM999,999,999')
      using errcode = 'P0001', detail = 'combo_no_saving';
  end if;

  if v_id is null then
    insert into public.combos (name, price_kes, sort_order)
    values (v_name, v_price, coalesce((select max(sort_order) + 1 from public.combos), 0))
    returning * into v_combo;
  else
    select * into v_combo from public.combos where id = v_id for update;
    if not found or v_combo.archived then
      raise exception 'That combo isn’t there any more.' using errcode = 'P0001', detail = 'combo_missing';
    end if;
    v_before := public.combo_snapshot(v_id);
    update public.combos set name = v_name, price_kes = v_price, updated_at = now() where id = v_id returning * into v_combo;
    delete from public.combo_items where combo_id = v_id;
  end if;

  insert into public.combo_items (combo_id, dish_id, quantity, sort_order)
  select v_combo.id, (x->>'dish_id')::uuid, (x->>'quantity')::integer, (o - 1)::integer
  from jsonb_array_elements(v_items) with ordinality as t(x, o);

  v_after := public.combo_snapshot(v_combo.id);
  if v_id is null then
    perform public.log_change('promos', 'combo.create', v_combo.id, v_combo.name, null, v_after);
  elsif v_before is distinct from v_after then
    perform public.log_change('promos', 'combo.edit', v_combo.id, v_combo.name, v_before, v_after);
  end if;
  return v_combo.id;
end;
$$;
revoke all on function public.save_combo(jsonb) from public, anon;
grant execute on function public.save_combo(jsonb) to authenticated;

-- Switch on / Switch off / Archive. Archived combos leave the Promos list and the menu for good.
create function public.combo_action(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_combo public.combos;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into v_combo from public.combos where id = p_id for update;
  if not found or v_combo.archived then
    raise exception 'That combo isn’t there any more.' using errcode = 'P0001', detail = 'combo_missing';
  end if;
  if p_action = 'on' then
    if v_combo.active then return; end if;
    update public.combos set active = true, updated_at = now() where id = p_id;
    perform public.log_change('promos', 'combo.on', p_id, v_combo.name);
  elsif p_action = 'off' then
    if not v_combo.active then return; end if;
    update public.combos set active = false, updated_at = now() where id = p_id;
    perform public.log_change('promos', 'combo.off', p_id, v_combo.name);
  elsif p_action = 'archive' then
    update public.combos set archived = true, active = false, updated_at = now() where id = p_id;
    perform public.log_change('promos', 'combo.archive', p_id, v_combo.name);
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.combo_action(uuid, text) from public, anon;
grant execute on function public.combo_action(uuid, text) to authenticated;

-- customer_combos(): every active combo on customer_menu()'s day (today while open, the next open
-- day while closed), with its prices, whether it can be ordered, and the first reason it can't.
-- A dish can come from a menu entry that day or, for an everyday dish, from the everyday menu
-- (no entry, its own price, out when marked out for the day), as place_order takes them.
-- Each part takes the dish's best source: orderable first, then a day special, then an entry,
-- then sort order. `parts` carries what the cart and place_order need: dish, entry (null for the
-- everyday menu), name, quantity, today's price, the thumbnail and whether the dish has choices.
create function public.customer_combos()
returns table (
  combo_id uuid, name text, price_kes integer, sort_order integer, menu_day date,
  everyday_total integer, today_total integer, available boolean, reason text, parts jsonb)
language sql stable security definer set search_path = '' as $$
  with m as (select * from public.customer_menu()),
  day as (select coalesce((select menu_day from m limit 1), public.menu_day()) as d, public.nairobi_today() as today),
  src as (
    select m.dish_id, m.entry_id, m.kind::text as kind, m.sort_order, m.price_kes, m.sold_out, m.plates_left,
           m.open_now or m.menu_day <> day.today as serving
    from m cross join day
    union all
    select dd.id, null, 'regular', 0, dd.price_kes,
           dd.unavailable_on is not distinct from day.d or (day.d = day.today and public.choices_all_out(dd.id)), null, true
    from public.dishes dd cross join day
    where dd.is_regular and not dd.archived
  ),
  p as (
    select c.id as combo_id, i.dish_id, i.quantity, i.sort_order, dd.name as dish_name, dd.price_kes as everyday,
           dd.photo_thumb_url, e.entry_id, e.price_kes as today_price,
           exists (select 1 from public.dish_options o where o.dish_id = i.dish_id and o.kind = 'choice' and not o.archived) as has_choices,
           case
             when e.dish_id is null then dd.name || ' isn’t on the menu'
             when e.sold_out then dd.name || ' is sold out'
             when e.plates_left is not null and e.plates_left < i.quantity then dd.name || ' has too few plates left'
             when not e.serving then dd.name || ' isn’t being served now'
           end as reason
    from public.combos c
    join public.combo_items i on i.combo_id = c.id
    join public.dishes dd on dd.id = i.dish_id
    left join lateral (
      select src.* from src where src.dish_id = i.dish_id
      order by coalesce(not src.sold_out and (src.plates_left is null or src.plates_left >= i.quantity) and src.serving, false) desc,
               (src.kind = 'day') desc, (src.kind <> 'regular') desc, src.sort_order, src.entry_id
      limit 1
    ) e on true
    where c.active and not c.archived
  )
  select c.id, c.name, c.price_kes, c.sort_order, (select d from day),
         sum(p.everyday * p.quantity)::integer,
         sum(coalesce(p.today_price, p.everyday) * p.quantity)::integer,
         bool_and(p.reason is null),
         (array_agg(p.reason order by p.sort_order) filter (where p.reason is not null))[1],
         jsonb_agg(jsonb_build_object(
           'dish_id', p.dish_id, 'menu_entry_id', p.entry_id, 'name', p.dish_name, 'quantity', p.quantity,
           'price_kes', coalesce(p.today_price, p.everyday), 'photo_thumb_url', p.photo_thumb_url,
           'has_choices', p.has_choices) order by p.sort_order)
  from public.combos c
  join p on p.combo_id = c.id
  group by c.id
  order by c.sort_order, c.name
$$;
revoke all on function public.customer_combos() from public;
grant execute on function public.customer_combos() to anon, authenticated;

-- Combo lines on an order. place_order fills these (a later migration); each dish in the combo
-- is an order_items row pointing here, priced at its choice difference plus extras only.
create table public.order_combos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  combo_id uuid references public.combos (id) on delete set null,
  name text not null,
  unit_price_kes integer not null check (unit_price_kes >= 0),
  quantity integer not null check (quantity between 1 and 20),
  sort_order integer not null default 0
);
create index order_combos_order_idx on public.order_combos (order_id);
alter table public.order_items add column order_combo_id uuid references public.order_combos (id) on delete cascade;
create index order_items_combo_idx on public.order_items (order_combo_id) where order_combo_id is not null;

alter table public.order_combos enable row level security;
create policy order_combos_staff on public.order_combos for select to authenticated using ((select public.is_staff()));
revoke all on public.order_combos from anon, authenticated;
grant select on public.order_combos to authenticated;
