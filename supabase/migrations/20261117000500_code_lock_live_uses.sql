-- 2.11 follow-up (Tevin, 2026-11-15, question 2A): a code whose only uses were cancelled orders
-- counts as unused, so what it gives can change again. The lock now counts the same uses as
-- everywhere else (discount_code_uses: orders that aren't cancelled). A cancelled order is final
-- (guard_order_status refuses to move one back), so a code can't become used again behind an edit;
-- place_order and save_discount_code both lock the code row, so a new use and an edit don't overlap.

create or replace function public.discount_codes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.code, new.kind, new.value, new.cap_kes) is distinct from (old.code, old.kind, old.value, old.cap_kes)
     and exists (select 1 from public.orders o where o.discount_code_id = old.id and o.status <> 'cancelled') then
    raise exception 'This code has been used, so what it gives can’t change. Make a new code instead.'
      using errcode = 'P0001', detail = 'code_used';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.save_discount_code(p jsonb) returns uuid
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
    v_used := public.discount_code_uses(v_id) > 0;
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
    raise exception 'Used %, so what it gives can’t change. Make a new code instead.',
      case public.discount_code_uses(v_id) when 1 then '1 time' else public.discount_code_uses(v_id) || ' times' end
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
