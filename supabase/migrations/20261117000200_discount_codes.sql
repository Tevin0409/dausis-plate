-- 2.11 part C: discount codes (spec 2.11 "C. Discount codes"; Q1 A one code per order, Q2 A refuse at
-- placing and offer "Place without the code", Q3 B no first-order setting, Q4 A minimums on all food).
-- Owner-only table, written only through save_discount_code and discount_code_action (logged to History).
-- Customers reach a code only through check_discount_code (a preview) and, after the wave-2 merge,
-- place_order, which call the same discount_code_refusal and discount_for so the two can't drift.

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null,
  cap_kes integer check (cap_kes is null or cap_kes between 1 and 99999),
  starts_on date not null default public.nairobi_today(),
  ends_on date not null,
  max_uses integer check (max_uses is null or max_uses between 1 and 100000),
  once_per_phone boolean not null default true,
  min_order_kes integer check (min_order_kes is null or min_order_kes between 1 and 999999),
  modes public.order_mode[] not null default '{dine_in,pickup,delivery}',
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_value check (
    (kind = 'percent' and value between 1 and 90 and cap_kes is not null)
    or (kind = 'amount' and value between 10 and 5000 and cap_kes is null)),
  constraint discount_codes_dates check (ends_on >= starts_on),
  constraint discount_codes_modes check (cardinality(modes) between 1 and 3)
);

alter table public.discount_codes enable row level security;
create policy discount_codes_owner_read on public.discount_codes for select using ((select public.is_owner()));
revoke all on public.discount_codes from anon, authenticated;
grant select on public.discount_codes to authenticated;

-- Orders remember the code and the saving. A use is an order with the code that isn't cancelled.
alter table public.orders
  add column discount_code_id uuid references public.discount_codes (id),
  -- The code's text as placed, for the board ticket: staff can't read discount_codes (owner only).
  add column discount_code text,
  add column discount_kes integer not null default 0,
  add constraint orders_discount_kes check (discount_kes >= 0 and discount_kes <= subtotal_kes),
  add constraint orders_total check (total_kes = subtotal_kes - discount_kes + delivery_fee_kes);
create index orders_discount_code_idx on public.orders (discount_code_id) where discount_code_id is not null;

-- Once any order has used a code, what it gives (and the code itself) is fixed. save_discount_code
-- refuses first with a field detail; this is the backstop for any other path.
create function public.discount_codes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.code, new.kind, new.value, new.cap_kes) is distinct from (old.code, old.kind, old.value, old.cap_kes)
     and exists (select 1 from public.orders o where o.discount_code_id = old.id) then
    raise exception 'This code has been used, so what it gives can’t change. Make a new code instead.'
      using errcode = 'P0001', detail = 'code_used';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger discount_codes_guard before update on public.discount_codes
  for each row execute function public.discount_codes_guard();

-- "10% off, up to KSh 300" / "KSh 100 off".
create function public.discount_label(p_kind text, p_value integer, p_cap integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_kind = 'percent'
              then p_value || '% off, up to KSh ' || to_char(p_cap, 'FM999,999,999')
              else 'KSh ' || to_char(p_value, 'FM999,999,999') || ' off' end
$$;

-- The saving on the food a code covers (dishes, choices and extras outside combos).
create function public.discount_for(p_code public.discount_codes, p_covered_kes integer) returns integer
language sql immutable set search_path = '' as $$
  select case when coalesce(p_covered_kes, 0) <= 0 then 0
              when p_code.kind = 'percent' then least(floor(p_covered_kes * p_code.value / 100.0)::integer, p_code.cap_kes)
              else least(p_code.value, p_covered_kes) end
$$;

-- Uses so far: orders with the code that aren't cancelled (a declined or cancelled order gives its use back).
create function public.discount_code_uses(p_id uuid, p_phone text default null) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.orders o
  where o.discount_code_id = p_id and o.status <> 'cancelled'
    and (p_phone is null or public.phone_key(o.customer_phone) = public.phone_key(p_phone))
$$;
revoke all on function public.discount_code_uses(uuid, text) from public, anon, authenticated;

-- The first reason a code can't be used, or null. The checks the cart can make come first; order type
-- and phone are checked only when given. place_order calls this with the code row locked.
-- Keys: off, not_started, ended, used_up, min_order, combos_only, mode, phone_used.
create function public.discount_code_refusal(
  p_code public.discount_codes, p_food_kes integer, p_covered_kes integer,
  p_mode public.order_mode default null, p_phone text default null
) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.nairobi_today();
begin
  if not p_code.active then return 'off'; end if;
  if v_today < p_code.starts_on then return 'not_started'; end if;
  if v_today > p_code.ends_on then return 'ended'; end if;
  if p_code.max_uses is not null and public.discount_code_uses(p_code.id) >= p_code.max_uses then return 'used_up'; end if;
  if p_code.min_order_kes is not null and coalesce(p_food_kes, 0) < p_code.min_order_kes then return 'min_order'; end if;
  if coalesce(p_covered_kes, 0) <= 0 then return 'combos_only'; end if;
  if p_mode is not null and not (p_mode = any (p_code.modes)) then return 'mode'; end if;
  if p_phone is not null and p_code.once_per_phone
     and public.discount_code_uses(p_code.id, p_phone) > 0 then return 'phone_used'; end if;
  return null;
end;
$$;
revoke all on function public.discount_code_refusal(public.discount_codes, integer, integer, public.order_mode, text) from public, anon, authenticated;

-- The cart and checkout preview. The amounts are the client's estimate; place_order prices for real.
-- It returns only what a message needs: the start date, the minimum, the order types.
create function public.check_discount_code(
  p_code text, p_food_kes integer, p_covered_kes integer,
  p_mode public.order_mode default null, p_phone text default null
) returns table (ok boolean, code text, discount_kes integer, reason text, label text,
                 starts_on date, min_order_kes integer, modes text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  -- Codes are letters and numbers only, so every space is dropped: "qa pct" is QAPCT (RQA211-02).
  v_text text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_food integer := greatest(coalesce(p_food_kes, 0), 0);
  v_covered integer := least(greatest(coalesce(p_covered_kes, 0), 0), greatest(coalesce(p_food_kes, 0), 0));
  v_code public.discount_codes;
  v_reason text;
begin
  if v_text ~ '^[A-Z0-9]{3,20}$' then
    select * into v_code from public.discount_codes d where d.code = v_text;
  end if;
  if v_code.id is null then
    return query select false, v_text, 0, 'unknown'::text, null::text, null::date, null::integer, null::text[];
    return;
  end if;
  v_reason := public.discount_code_refusal(v_code, v_food, v_covered, p_mode, nullif(btrim(coalesce(p_phone, '')), ''));
  return query select v_reason is null, v_code.code,
    case when v_reason is null then public.discount_for(v_code, v_covered) else 0 end,
    v_reason, public.discount_label(v_code.kind, v_code.value, v_code.cap_kes),
    case when v_reason = 'not_started' then v_code.starts_on end,
    case when v_reason = 'min_order' then v_code.min_order_kes end,
    case when v_reason = 'mode' then v_code.modes::text[] end;
end;
$$;
revoke all on function public.check_discount_code(text, integer, integer, public.order_mode, text) from public;
grant execute on function public.check_discount_code(text, integer, integer, public.order_mode, text) to anon, authenticated;

-- What a code row looks like in History.
create function public.discount_code_snapshot(p public.discount_codes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'code', p.code, 'kind', p.kind, 'value', p.value, 'cap_kes', p.cap_kes,
    'starts_on', p.starts_on, 'ends_on', p.ends_on, 'max_uses', p.max_uses,
    'once_per_phone', p.once_per_phone, 'min_order_kes', p.min_order_kes, 'modes', to_jsonb(p.modes))
$$;
revoke all on function public.discount_code_snapshot(public.discount_codes) from public, anon, authenticated;

-- save_discount_code({id?, code, kind, value, cap_kes, starts_on, ends_on, max_uses, once_per_phone,
-- min_order_kes, modes}) → the code id. Refusals are P0001 with a detail naming the field:
-- code_code, code_taken, code_value, code_cap, code_dates, code_max_uses, code_min_order, code_modes,
-- code_used, code_missing.
create function public.save_discount_code(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_new public.discount_codes;
  v_old public.discount_codes;
  v_used boolean := false;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;

  if v_id is not null then
    select * into v_old from public.discount_codes where id = v_id for update;
    if not found then
      raise exception 'That code isn’t there any more.' using errcode = 'P0001', detail = 'code_missing';
    end if;
    v_used := exists (select 1 from public.orders o where o.discount_code_id = v_id);
  end if;

  begin
    v_new.code := upper(btrim(coalesce(p->>'code', '')));
    v_new.kind := p->>'kind';
    v_new.value := nullif(p->>'value', '')::integer;
    v_new.cap_kes := nullif(p->>'cap_kes', '')::integer;
    v_new.max_uses := nullif(p->>'max_uses', '')::integer;
    v_new.min_order_kes := nullif(p->>'min_order_kes', '')::integer;
  exception when others then
    raise exception 'Use whole numbers.' using errcode = 'P0001', detail = 'code_value';
  end;
  begin
    v_new.starts_on := coalesce(nullif(p->>'starts_on', '')::date, public.nairobi_today());
    v_new.ends_on := nullif(p->>'ends_on', '')::date;
  exception when others then
    raise exception 'Pick the dates again.' using errcode = 'P0001', detail = 'code_dates';
  end;
  v_new.once_per_phone := coalesce((p->>'once_per_phone')::boolean, true);
  begin
    select coalesce(array_agg(distinct m::public.order_mode), '{}') into v_new.modes
    from jsonb_array_elements_text(coalesce(p->'modes', '["dine_in","pickup","delivery"]'::jsonb)) m;
  exception when others then
    raise exception 'Pick at least one order type.' using errcode = 'P0001', detail = 'code_modes';
  end;

  -- A used code keeps what it gives; only the limits, the dates and on/off can change.
  if v_used and (v_new.code, v_new.kind, v_new.value, v_new.cap_kes) is distinct from (v_old.code, v_old.kind, v_old.value, v_old.cap_kes) then
    raise exception 'Used % times, so what it gives can’t change. Make a new code instead.', public.discount_code_uses(v_id)
      using errcode = 'P0001', detail = 'code_used';
  end if;

  if v_new.code !~ '^[A-Z0-9]{3,20}$' then
    raise exception 'A code is 3 to 20 letters and numbers.' using errcode = 'P0001', detail = 'code_code';
  end if;
  if exists (select 1 from public.discount_codes d where d.code = v_new.code and d.id is distinct from v_id) then
    raise exception '% is taken. Pick another code.', v_new.code using errcode = 'P0001', detail = 'code_taken';
  end if;
  if v_new.kind = 'percent' then
    if v_new.value is null or v_new.value not between 1 and 90 then
      raise exception 'A percentage is 1 to 90.' using errcode = 'P0001', detail = 'code_value';
    end if;
    if v_new.cap_kes is null or v_new.cap_kes not between 1 and 99999 then
      raise exception 'Enter the most one order can save, in shillings.' using errcode = 'P0001', detail = 'code_cap';
    end if;
  elsif v_new.kind = 'amount' then
    if v_new.value is null or v_new.value not between 10 and 5000 then
      raise exception 'A fixed amount is KSh 10 to 5,000.' using errcode = 'P0001', detail = 'code_value';
    end if;
    v_new.cap_kes := null;
  else
    raise exception 'Pick what the code gives.' using errcode = 'P0001', detail = 'code_value';
  end if;
  if v_new.ends_on is null then
    raise exception 'Pick an end date.' using errcode = 'P0001', detail = 'code_dates';
  end if;
  if v_new.ends_on < v_new.starts_on then
    raise exception 'The end date is before the start.' using errcode = 'P0001', detail = 'code_dates';
  end if;
  if v_id is null and v_new.ends_on < public.nairobi_today() then
    raise exception 'Pick an end date from today on.' using errcode = 'P0001', detail = 'code_dates';
  end if;
  if v_new.max_uses is not null and v_new.max_uses not between 1 and 100000 then
    raise exception 'Total uses is a number from 1.' using errcode = 'P0001', detail = 'code_max_uses';
  end if;
  if v_new.min_order_kes is not null and v_new.min_order_kes not between 1 and 999999 then
    raise exception 'Enter the minimum in shillings.' using errcode = 'P0001', detail = 'code_min_order';
  end if;
  if cardinality(v_new.modes) = 0 then
    raise exception 'Pick at least one order type.' using errcode = 'P0001', detail = 'code_modes';
  end if;

  if v_id is null then
    insert into public.discount_codes (code, kind, value, cap_kes, starts_on, ends_on, max_uses, once_per_phone, min_order_kes, modes)
    values (v_new.code, v_new.kind, v_new.value, v_new.cap_kes, v_new.starts_on, v_new.ends_on, v_new.max_uses,
            v_new.once_per_phone, v_new.min_order_kes, v_new.modes)
    returning * into v_new;
    perform public.log_change('promos', 'code.create', v_new.id, v_new.code, null, public.discount_code_snapshot(v_new));
  else
    update public.discount_codes set
      code = v_new.code, kind = v_new.kind, value = v_new.value, cap_kes = v_new.cap_kes,
      starts_on = v_new.starts_on, ends_on = v_new.ends_on, max_uses = v_new.max_uses,
      once_per_phone = v_new.once_per_phone, min_order_kes = v_new.min_order_kes, modes = v_new.modes
    where id = v_id returning * into v_new;
    if public.discount_code_snapshot(v_old) is distinct from public.discount_code_snapshot(v_new) then
      perform public.log_change('promos', 'code.edit', v_id, v_new.code,
        public.discount_code_snapshot(v_old), public.discount_code_snapshot(v_new));
    end if;
  end if;
  return v_new.id;
end;
$$;
revoke all on function public.save_discount_code(jsonb) from public, anon;
grant execute on function public.save_discount_code(jsonb) to authenticated;

-- Switch on / Switch off. A no-op (and no History line) when it's already that way.
create function public.discount_code_action(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code public.discount_codes;
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  select * into v_code from public.discount_codes where id = p_id for update;
  if not found then
    raise exception 'That code isn’t there any more.' using errcode = 'P0001', detail = 'code_missing';
  end if;
  if p_action not in ('on', 'off') then raise exception 'Unknown action.' using errcode = '22023'; end if;
  if v_code.active = (p_action = 'on') then return; end if;
  update public.discount_codes set active = (p_action = 'on') where id = p_id;
  perform public.log_change('promos', 'code.' || p_action, p_id, v_code.code);
end;
$$;
revoke all on function public.discount_code_action(uuid, text) from public, anon;
grant execute on function public.discount_code_action(uuid, text) to authenticated;

-- Figures per code (Promos now, Reports in 2.12): uses, discount given and sales, not counting
-- cancelled orders. security_invoker, so only the owner (who can read the codes) sees rows.
create view public.code_figures with (security_invoker = true) as
  select d.id as code_id, d.code,
    count(o.id)::integer as uses,
    coalesce(sum(o.discount_kes), 0)::integer as discount_given,
    coalesce(sum(o.total_kes), 0)::integer as sales
  from public.discount_codes d
  left join public.orders o on o.discount_code_id = d.id and o.status <> 'cancelled'
  group by d.id, d.code;
revoke all on public.code_figures from anon, authenticated;
grant select on public.code_figures to authenticated;
