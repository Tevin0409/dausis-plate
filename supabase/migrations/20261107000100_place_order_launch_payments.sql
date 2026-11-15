-- Slice 2.1, payments at launch (spec-2.1-payments.md). place_order as of
-- 20261105000100_place_order_safety.sql, with two changes:
--   * only on_handover and at_counter are accepted, and at_counter only for dine-in;
--   * both are stored as unpaid (the old rule marked anything but on_handover pending).
-- Same signature and return type, so `create or replace` keeps the grants.

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
      raise exception 'That pickup time has passed. Pick a later time.' using errcode = 'P0001';
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
