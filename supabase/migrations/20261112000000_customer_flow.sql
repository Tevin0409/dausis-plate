-- Slice 2.8, customer flow (docs/plans/launch/plan-2.8-build.md step 1).
-- 1. The menu customers see: today's while the kitchen is open, otherwise the next open day's,
--    with that day's plate counts (customer_menu). todays_menu is unchanged for its callers.
-- 2. check_cart: each saved cart line against that menu, with server prices and plates.
-- 3. place_order: detail codes sold_out / over_plates / not_on_menu so checkout can recheck.
-- 4. get_order_status: where the order goes (kitchen address and directions, or the
--    customer's address and notes) and item notes.
-- 5. find_order: phone + order code -> status token, last 7 days, 5 wrong tries then 15 minutes.

-- The day the customer menu shows: today while open or before opening, else the next open day.
create or replace function public.menu_day()
returns date
language sql stable security definer set search_path = '' as $$
  select case when s->>'state' = 'open' then public.nairobi_today()
              else coalesce((s->>'next_open_date')::date, public.nairobi_today()) end
  from (select public.kitchen_status() as s) x
$$;
revoke all on function public.menu_day() from public;
grant execute on function public.menu_day() to anon, authenticated;

-- Same columns as todays_menu, plus menu_day, for menu_day(). Plates are counted for that day,
-- so a future day starts fresh. Choices and regulars marked out apply to today only.
create or replace function public.customer_menu()
returns table (
  menu_day date, entry_id uuid, kind public.entry_kind, starts_on date, ends_on date,
  show_from time, show_until time, sort_order integer, dish_id uuid, name text, description text,
  photo_key text, category public.dish_category, price_kes integer, plates_per_day integer,
  plates_sold integer, plates_left integer, sold_out boolean, open_now boolean,
  auto_hide_sold_out boolean, photo_url text, photo_thumb_url text)
language sql stable security definer set search_path = '' as $$
  with d as (select public.menu_day() as day, public.nairobi_today() as today)
  select d.day, e.id, e.kind, e.starts_on, e.ends_on, e.show_from, e.show_until, e.sort_order,
         dd.id, dd.name, dd.description, dd.photo_key, dd.category,
         coalesce(e.price_kes, dd.price_kes), e.plates_per_day, coalesce(md.plates_sold, 0),
         case when e.plates_per_day is null then null
              else greatest(e.plates_per_day - coalesce(md.plates_sold, 0), 0) end,
         coalesce(md.sold_out_manual, false)
           or (e.plates_per_day is not null and coalesce(md.plates_sold, 0) >= e.plates_per_day)
           or (d.day = d.today and public.choices_all_out(dd.id)),
         d.day = d.today and public.nairobi_time() between e.show_from and e.show_until,
         e.auto_hide_sold_out, dd.photo_url, dd.photo_thumb_url
  from d
  cross join public.menu_entries e
  join public.dishes dd on dd.id = e.dish_id and not dd.archived
  left join public.menu_entry_days md on md.entry_id = e.id and md.day = d.day
  where e.published and e.ended_early_at is null
    and d.day between e.starts_on and e.ends_on
    and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = d.day)
$$;
revoke all on function public.customer_menu() from public;
grant execute on function public.customer_menu() to anon, authenticated;

-- Read-only check of a saved cart. Input: [{key, dish_id, menu_entry_id?, option_id?, extra_ids?,
-- quantity}], at most 30 lines. Output, per line in order: {key, state, quantity, menu_entry_id,
-- unit_price_kes, plates_left}. States:
--   ok | capped (quantity lowered to what is left) | sold_out (quantity 0) | not_on_menu |
--   not_now (open, but outside the dish's serving hours) | option_out (a choice or extra is gone).
-- Lines of the same entry share its plates in line order. A line whose entry is from another day
-- moves to the same dish's entry on the menu day (menu_entry_id in the output is the one to use).
create or replace function public.check_cart(p_lines jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_today date := public.nairobi_today();
  v_day date := public.menu_day();
  v_open boolean := public.kitchen_status()->>'state' = 'open';
  v_is_today boolean;
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_used jsonb := '{}'::jsonb;
  v_dish public.dishes;
  v_entry public.menu_entries;
  v_given uuid;
  v_option public.dish_options;
  v_qty integer;
  v_asked integer;
  v_state text;
  v_price integer;
  v_left integer;
  v_room integer;
  v_sold integer;
  v_manual boolean;
  v_extras uuid[];
  v_extra_ok integer;
begin
  v_is_today := v_day = v_today;
  if coalesce(jsonb_typeof(p_lines), 'missing') <> 'array' or jsonb_array_length(p_lines) > 30
     or exists (select from jsonb_array_elements(p_lines) l
                where jsonb_typeof(l) <> 'object'
                   or coalesce(l->>'dish_id', '') !~* c_uuid
                   or (nullif(l->>'menu_entry_id', '') is not null and l->>'menu_entry_id' !~* c_uuid)
                   or (nullif(l->>'option_id', '') is not null and l->>'option_id' !~* c_uuid)
                   or coalesce(l->>'quantity', '') !~ '^[0-9]{1,3}$'
                   or (l->'extra_ids' is not null and jsonb_typeof(l->'extra_ids') not in ('array', 'null'))
                   or (jsonb_typeof(l->'extra_ids') = 'array'
                       and (jsonb_array_length(l->'extra_ids') > 8
                            or exists (select from jsonb_array_elements(l->'extra_ids') x
                                       where jsonb_typeof(x) <> 'string' or x #>> '{}' !~* c_uuid)))) then
    raise exception 'Refresh the page and try again' using errcode = 'P0001', detail = 'bad_cart';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_asked := (v_line->>'quantity')::integer;
    v_qty := least(greatest(v_asked, 1), 20);
    v_state := 'ok';
    v_entry := null;
    v_option := null;
    v_price := null;
    v_left := null;

    select * into v_dish from public.dishes where id = (v_line->>'dish_id')::uuid and not archived;
    v_given := nullif(v_line->>'menu_entry_id', '')::uuid;

    if v_dish.id is null then
      v_state := 'not_on_menu';
    elsif v_given is not null or not v_dish.is_regular then
      -- The entry asked for, if it is on the menu day; else this dish's entry on that day, but
      -- only when the one asked for is a real entry of this dish (a stale cart, not a made-up id).
      select * into v_entry from public.menu_entries e
        where e.id = v_given and e.dish_id = v_dish.id and e.published and e.ended_early_at is null
          and v_day between e.starts_on and e.ends_on
          and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = v_day);
      if v_entry.id is null and (v_given is null
           or exists (select 1 from public.menu_entries e where e.id = v_given and e.dish_id = v_dish.id)) then
        select * into v_entry from public.menu_entries e
          where e.dish_id = v_dish.id and e.published and e.ended_early_at is null
            and v_day between e.starts_on and e.ends_on
            and not exists (select 1 from public.menu_entry_off_days o where o.entry_id = e.id and o.day = v_day)
          order by (e.kind = 'day') desc, e.sort_order, e.id
          limit 1;
      end if;
      if v_entry.id is null then
        v_state := 'not_on_menu';
      else
        v_price := coalesce(v_entry.price_kes, v_dish.price_kes);
        select md.plates_sold, md.sold_out_manual into v_sold, v_manual
          from public.menu_entry_days md where md.entry_id = v_entry.id and md.day = v_day;
        v_sold := coalesce(v_sold, 0);
        if v_entry.plates_per_day is not null then
          v_left := greatest(v_entry.plates_per_day - v_sold, 0);
        end if;
        if v_open and v_is_today and not (public.nairobi_time() between v_entry.show_from and v_entry.show_until) then
          v_state := 'not_now';
        elsif coalesce(v_manual, false) or v_left = 0 then
          v_state := 'sold_out';
        end if;
      end if;
    else
      v_price := v_dish.price_kes;
      if v_dish.unavailable_on = v_day then
        v_state := 'sold_out';
      end if;
    end if;

    if v_state = 'ok' and v_is_today and public.choices_all_out(v_dish.id) then
      v_state := 'sold_out';
    end if;

    -- The choice, then the extras, as place_order checks them.
    if v_state = 'ok' then
      if nullif(v_line->>'option_id', '') is not null then
        select * into v_option from public.dish_options o
          where o.id = (v_line->>'option_id')::uuid and o.dish_id = v_dish.id and o.kind = 'choice';
        if v_option.id is null or v_option.archived or (v_is_today and public.option_out_today(v_option.out_on)) then
          v_state := 'option_out';
        else
          v_price := v_price + v_option.price_delta_kes;
        end if;
      elsif exists (select from public.dish_options o where o.dish_id = v_dish.id and o.kind = 'choice' and not o.archived) then
        v_state := 'option_out';
      end if;
    end if;
    if v_state = 'ok' and jsonb_typeof(v_line->'extra_ids') = 'array' and jsonb_array_length(v_line->'extra_ids') > 0 then
      select array_agg(distinct (x #>> '{}')::uuid) into v_extras from jsonb_array_elements(v_line->'extra_ids') x;
      select count(*), coalesce(sum(o.price_delta_kes), 0)::integer into v_extra_ok, v_sold
        from public.dish_options o
        where o.id = any (v_extras) and o.dish_id = v_dish.id and o.kind = 'extra' and not o.archived
          and not (v_is_today and public.option_out_today(o.out_on));
      if v_extra_ok <> cardinality(v_extras) then
        v_state := 'option_out';
      else
        v_price := v_price + v_sold;
      end if;
    end if;

    -- Plates: lines of one entry share what is left, first line first.
    if v_state = 'ok' and v_left is not null then
      v_room := v_left - coalesce((v_used->>v_entry.id::text)::integer, 0);
      if v_room <= 0 then
        v_state := 'sold_out';
      elsif v_qty > v_room then
        v_state := 'capped';
        v_qty := v_room;
      end if;
    end if;
    -- More than 20 on a line is lowered to 20 and says so, like a plate cap (RQA28-08).
    if v_state = 'ok' and v_asked > 20 then
      v_state := 'capped';
    end if;
    if v_state in ('ok', 'capped') and v_entry.id is not null then
      v_used := v_used || jsonb_build_object(v_entry.id::text, coalesce((v_used->>v_entry.id::text)::integer, 0) + v_qty);
    end if;
    if v_state not in ('ok', 'capped') then
      v_qty := 0;
    end if;

    v_out := v_out || jsonb_build_object(
      'key', v_line->'key', 'state', v_state, 'quantity', v_qty, 'menu_entry_id', v_entry.id,
      'unit_price_kes', v_price, 'plates_left', v_left);
  end loop;
  return v_out;
end $$;
revoke all on function public.check_cart(jsonb) from public;
grant execute on function public.check_cart(jsonb) to anon, authenticated;

-- place_order: unchanged behaviour, plus detail codes on the menu refusals. One message changes:
-- asking for more plates than are left now says how many are left (detail over_plates) instead of
-- "has sold out".
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
  v_item_id uuid;
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
  v_has_choices boolean;
  v_extra_ids jsonb;
  v_extra_count integer;
  v_extras jsonb;
  v_extra_sum integer;
  v_out_label text;
begin
  -- The key comes first: a retry must get its order back even if the menu, the
  -- plates or the clock have moved on since the first attempt.
  if v_key_text is null or v_key_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Refresh the page and try again' using errcode = 'P0001';
  end if;
  v_key := v_key_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  return query select o.public_token, o.code, o.total_kes, true from public.orders o where o.idempotency_key = v_key;
  if found then
    return;
  end if;

  v_status := public.kitchen_status();
  if v_status->>'state' <> 'open' then
    raise exception 'The kitchen is closed' using errcode = 'P0001', detail = 'kitchen_closed';
  end if;

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
      raise exception 'A dish in your order is no longer available' using errcode = 'P0001', detail = 'not_on_menu';
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
        raise exception '% is not on the menu right now', v_dish.name using errcode = 'P0001', detail = 'not_on_menu';
      end if;

      insert into public.menu_entry_days (entry_id, day) values (v_entry.id, v_today)
        on conflict do nothing;
      select plates_sold, sold_out_manual into v_sold, v_manual
        from public.menu_entry_days where entry_id = v_entry.id and day = v_today for update;
      if v_manual or (v_entry.plates_per_day is not null and v_sold >= v_entry.plates_per_day) then
        raise exception 'Sorry, % has sold out', v_dish.name using errcode = 'P0001', detail = 'sold_out';
      end if;
      if v_entry.plates_per_day is not null and v_sold + v_qty > v_entry.plates_per_day then
        raise exception 'Only % of % left. Change your order and try again.',
          case when v_entry.plates_per_day - v_sold = 1 then '1 plate' else (v_entry.plates_per_day - v_sold) || ' plates' end, v_dish.name
          using errcode = 'P0001', detail = 'over_plates';
      end if;
      update public.menu_entry_days set plates_sold = plates_sold + v_qty
        where entry_id = v_entry.id and day = v_today;
      v_price := coalesce(v_entry.price_kes, v_dish.price_kes);
    else
      if not v_dish.is_regular then
        raise exception '% is not available today', v_dish.name using errcode = 'P0001', detail = 'not_on_menu';
      end if;
      if not public.regular_on_sale(v_dish.unavailable_on) then
        raise exception '% is not available today', v_dish.name using errcode = 'P0001', detail = 'sold_out';
      end if;
      v_price := v_dish.price_kes;
    end if;

    -- The choice: exactly one when the dish has choices, none otherwise.
    v_has_choices := exists (select from public.dish_options o where o.dish_id = v_dish.id and o.kind = 'choice' and not o.archived);
    if v_has_choices and public.choices_all_out(v_dish.id) then
      raise exception 'Sorry, % has sold out', v_dish.name using errcode = 'P0001', detail = 'sold_out';
    end if;
    v_option := null;
    if nullif(v_item->>'option_id', '') is not null then
      select * into v_option from public.dish_options o
        where o.id = (v_item->>'option_id')::uuid and o.dish_id = v_dish.id and o.kind = 'choice';
      if v_option.id is null then
        raise exception 'Invalid choice for %', v_dish.name using errcode = 'P0001';
      end if;
      if v_option.archived then
        raise exception 'That choice isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'choice_gone';
      end if;
      if public.option_out_today(v_option.out_on) then
        raise exception 'Sorry, % has run out today. Choose another side for %.', v_option.label, v_dish.name
          using errcode = 'P0001', detail = 'option_out';
      end if;
      v_price := v_price + v_option.price_delta_kes;
    elsif v_has_choices then
      raise exception 'Choose a side for %', v_dish.name using errcode = 'P0001', detail = 'choice_missing';
    end if;

    -- Extras: any number up to 8, each once, each a live extra of this dish, none out today.
    v_extras := '[]'::jsonb;
    v_extra_sum := 0;
    v_extra_ids := v_item->'extra_ids';
    if v_extra_ids is not null and jsonb_typeof(v_extra_ids) <> 'null' then
      if jsonb_typeof(v_extra_ids) <> 'array'
         or jsonb_array_length(v_extra_ids) > 8
         or exists (select from jsonb_array_elements(v_extra_ids) x
                    where jsonb_typeof(x) <> 'string'
                       or x #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'That extra isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'extra_gone';
      end if;
      v_extra_count := jsonb_array_length(v_extra_ids);
      if v_extra_count > 0 then
        if (select count(distinct (x #>> '{}')::uuid) from jsonb_array_elements(v_extra_ids) x) <> v_extra_count
           or (select count(*) from public.dish_options o
               where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x)
                 and o.dish_id = v_dish.id and o.kind = 'extra' and not o.archived) <> v_extra_count then
          raise exception 'That extra isn''t available any more. Choose again.' using errcode = 'P0001', detail = 'extra_gone';
        end if;
        select o.label into v_out_label from public.dish_options o
          where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x)
            and public.option_out_today(o.out_on)
          order by o.sort_order, o.label limit 1;
        if v_out_label is not null then
          raise exception 'Sorry, % has run out today. Remove it from % and try again.', v_out_label, v_dish.name
            using errcode = 'P0001', detail = 'option_out';
        end if;
        select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'label', o.label, 'price_kes', o.price_delta_kes)
                                  order by o.sort_order, o.label), '[]'::jsonb),
               coalesce(sum(o.price_delta_kes), 0)
          into v_extras, v_extra_sum
          from public.dish_options o
          where o.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_extra_ids) x);
        v_price := v_price + v_extra_sum;
      end if;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_dish.id, 'menu_entry_id', v_entry.id, 'option_id', v_option.id,
      'name', v_dish.name, 'option_label', v_option.label, 'unit_price_kes', v_price,
      'quantity', v_qty, 'note', left(nullif(trim(v_item->>'note'), ''), 200),
      'extras', v_extras);
  end loop;

  -- The minimum counts the food only, before the delivery fee (Q1 A).
  if v_mode = 'delivery' and v_subtotal < v_zone.min_order_kes then
    raise exception 'Your order is under %''s KSh % minimum for delivery. Add more, or choose pickup.',
      v_zone.name, to_char(v_zone.min_order_kes, 'FM99,999')
      using errcode = 'P0001', detail = 'under_minimum';
  end if;

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
            (v_line->>'unit_price_kes')::integer, (v_line->>'quantity')::integer, v_line->>'note')
    returning id into v_item_id;
    insert into public.order_item_extras (order_item_id, option_id, label, price_kes, sort_order)
      select v_item_id, (x->>'option_id')::uuid, x->>'label', (x->>'price_kes')::integer, (n - 1)::smallint
      from jsonb_array_elements(v_line->'extras') with ordinality as e(x, n);
  end loop;

  return query select o.public_token, o.code, o.total_kes, false from public.orders o where o.id = v_order_id;
end $$;
-- Where the order goes. kitchen_settings gains the kitchen's address and a directions link.
alter table public.kitchen_settings
  add column address text check (length(address) between 1 and 200),
  add column maps_url text check (maps_url ~ '^https://\S+$' and length(maps_url) <= 500);

create or replace function public.set_kitchen_address(p_address text, p_maps_url text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_maps text := nullif(btrim(coalesce(p_maps_url, '')), '');
begin
  if not public.has_permission('settings') then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
  if length(v_address) > 200 then
    raise exception 'Keep the address under 200 characters.' using errcode = 'P0001', detail = 'address';
  end if;
  if v_maps is not null and (v_maps !~* '^https://\S+$' or length(v_maps) > 500) then
    raise exception 'Paste a maps link that starts with https://' using errcode = 'P0001', detail = 'maps_url';
  end if;
  update public.kitchen_settings set address = v_address, maps_url = v_maps where id;
end $$;
revoke all on function public.set_kitchen_address(text, text) from public, anon;
grant execute on function public.set_kitchen_address(text, text) to authenticated;

-- The menu's band and rail name the pickup address. Customers can't read kitchen_settings, so
-- this hands out the address and directions link only (both are public, on every pickup order).
create or replace function public.kitchen_place()
returns jsonb
language sql stable security definer set search_path = '' as $$
  -- The phone is the Settings one (2.6), for "Call us" when an order can't be found (question-2.8c).
  select jsonb_build_object('address', k.address, 'maps_url', k.maps_url, 'phone', k.phone) from public.kitchen_settings k where k.id
$$;
revoke all on function public.kitchen_place() from public;
grant execute on function public.kitchen_place() to anon, authenticated;

-- Same signature and return type, so `create or replace` keeps the grants.
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
    'phone', (select k.phone from public.kitchen_settings k where k.id),
    'delivery_address', case when o.mode = 'delivery' then o.delivery_address end,
    'delivery_notes', case when o.mode = 'delivery' then o.delivery_notes end,
    'kitchen_address', case when o.mode <> 'delivery' then (select k.address from public.kitchen_settings k where k.id) end,
    'maps_url', case when o.mode <> 'delivery' then (select k.maps_url from public.kitchen_settings k where k.id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes, 'note', i.note,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'price_kes', x.price_kes) order by x.sort_order)
                            from public.order_item_extras x where x.order_item_id = i.id), '[]'::jsonb))
        order by i.name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;
-- Order lookup by phone and code (Tevin, question-2.8b B: 7 days).
create or replace function public.order_lookup_days()
returns integer language sql immutable set search_path = '' as $$ select 7 $$;
grant execute on function public.order_lookup_days() to anon, authenticated;

-- A phone as one key: digits only, Kenyan local forms (07…, 7…) turned into 2547….
create or replace function public.phone_key(p_phone text)
returns text
language sql immutable set search_path = '' as $$
  select case when d ~ '^0[0-9]{9}$' then '254' || substr(d, 2)
              when d ~ '^[0-9]{9}$' then '254' || d
              else d end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x
$$;

-- Wrong tries per phone, for the 15-minute pause. Closed to every client role.
create table public.lookup_attempts (
  id bigint generated always as identity primary key,
  phone_key text not null,
  at timestamptz not null default now()
);
create index lookup_attempts_phone_at on public.lookup_attempts (phone_key, at);
alter table public.lookup_attempts enable row level security;
revoke all on public.lookup_attempts from public, anon, authenticated;

create index if not exists orders_phone_key_idx on public.orders (public.phone_key(customer_phone), created_at);

-- The status token for the order with this phone and code from the last 7 days, or null. After 5
-- wrong tries for a phone in 15 minutes it refuses (detail lookup_paused) until they age out. The
-- answer never says which part was wrong.
create or replace function public.find_order(p_phone text, p_code text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key text := public.phone_key(p_phone);
  v_digits text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  v_token uuid;
begin
  if length(v_key) not between 9 and 15 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('find_order:' || v_key, 0));
  if (select count(*) from public.lookup_attempts a
      where a.phone_key = v_key and a.at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many tries. Wait 15 minutes, then try again.' using errcode = 'P0001', detail = 'lookup_paused';
  end if;

  if v_digits <> '' and length(v_digits) <= 12 then
    select o.public_token into v_token from public.orders o
      where o.number = v_digits::bigint
        and public.phone_key(o.customer_phone) = v_key
        and o.created_at > now() - make_interval(days => public.order_lookup_days());
  end if;

  if v_token is null then
    insert into public.lookup_attempts (phone_key) values (v_key);
    delete from public.lookup_attempts a where a.at < now() - interval '1 day';
  end if;
  return v_token;
end $$;
revoke all on function public.find_order(text, text) from public;
grant execute on function public.find_order(text, text) to anon, authenticated;
