-- 2.11 B and C on the order side: place_order and check_cart learn combos, place_order learns
-- discount codes, and get_order_status returns both. Built on the composed wave-2 definitions:
-- check_cart and place_order from 20261112000000_customer_flow, get_order_status from
-- 20261116100300_ratings_compose. Everything else in them is unchanged.
--
-- A combo's dishes go through the very same per-dish code as items (they are appended to the
-- items loop, marked as combo parts), so the menu, plate and option checks can't drift apart.
-- Each dish of a combo is an order_items row pointing at its order_combos row, priced at its
-- choice difference plus extras; the combo row carries the combo's price. So
-- subtotal = Σ order_items + Σ order_combos (extras are in each item's unit price, as before).

-- A combo's dish rows hold its plates: up to 4 of a dish in a combo times 20 combos.
alter table public.order_items drop constraint order_items_quantity_check,
  add constraint order_items_quantity_check
    check (quantity between 1 and 20 or (order_combo_id is not null and quantity between 1 and 80));

-- True when the parts are exactly the combo's dishes, each once, with its quantity if one is given.
-- The caller checks each part is an object with a uuid dish_id first.
create function public.combo_parts_match(p_combo uuid, p_parts jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select jsonb_array_length(p_parts) = (select count(*) from public.combo_items i where i.combo_id = p_combo)
     and (select count(distinct (x->>'dish_id')::uuid) from jsonb_array_elements(p_parts) x) = jsonb_array_length(p_parts)
     and not exists (
       select from jsonb_array_elements(p_parts) x
       where not exists (select 1 from public.combo_items i
                          where i.combo_id = p_combo and i.dish_id = (x->>'dish_id')::uuid
                            and (x->'quantity' is null or jsonb_typeof(x->'quantity') = 'null'
                                 or x->>'quantity' = i.quantity::text)))
$$;
revoke all on function public.combo_parts_match(uuid, jsonb) from public, anon, authenticated;

-- check_cart: combo lines come back as {key, kind:'combo', state, quantity, unit_price_kes, parts}.
-- New states for a combo: combo_off (switched off or archived) and combo_parts (its dishes changed).
-- R211-02: a combo's parts each reserve their plates before the combo's whole number is known; a
-- part capped to fewer plates (or out) means fewer whole combos, so the others give back what those
-- combos won't use. Returns check_cart's plates-used map after combo p_n.
create function public.combo_settle(p_used jsonb, p_parts jsonb, p_combos jsonb, p_n jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_parts jsonb := coalesce((select jsonb_agg(x) from jsonb_array_elements(p_parts) x where x->'n' = p_n), '[]'::jsonb);
  v_asked integer := (select (c->>'asked')::integer from jsonb_array_elements(p_combos) c where c->'n' = p_n);
  v_whole integer := 0;
  v_used jsonb := p_used;
  v_p jsonb;
begin
  if not exists (select from jsonb_array_elements(v_parts) x where x->>'state' not in ('ok', 'capped')) then
    v_whole := least(least(greatest(coalesce(v_asked, 1), 1), 20),
                     (select min((x->>'quantity')::integer / (x->>'per')::integer) from jsonb_array_elements(v_parts) x));
  end if;
  for v_p in select x from jsonb_array_elements(v_parts) x
             where x->>'state' in ('ok', 'capped') and x->>'menu_entry_id' is not null loop
    v_used := v_used || jsonb_build_object(v_p->>'menu_entry_id',
      (v_used->>(v_p->>'menu_entry_id'))::integer - (v_p->>'quantity')::integer + coalesce(v_whole, 0) * (v_p->>'per')::integer);
  end loop;
  return v_used;
end $$;
revoke all on function public.combo_settle(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;

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
  v_lines jsonb;
  v_dish_count integer;
  v_part boolean;
  v_c jsonb;
  v_n bigint;
  v_combo public.combos;
  v_combos jsonb := '[]'::jsonb;
  v_parts_out jsonb := '[]'::jsonb;
  v_cparts jsonb;
  v_cstate text;
  v_cqty integer;
  v_cprice integer;
  v_settle_n jsonb;
begin
  v_is_today := v_day = v_today;
  if coalesce(jsonb_typeof(p_lines), 'missing') <> 'array' or jsonb_array_length(p_lines) > 30 then
    raise exception 'Refresh the page and try again' using errcode = 'P0001', detail = 'bad_cart';
  end if;
  -- 2.11: a combo line ({key, combo_id, quantity, parts}) becomes one line per dish, after the dish
  -- lines, so the dish checks below run on its parts unchanged. A part's quantity is its plates
  -- (the dish's quantity in the combo times the combos); its price starts at 0, since the combo's
  -- price stands in for the dishes', and adds only choice differences and extras.
  v_lines := coalesce((select jsonb_agg(l order by n) from jsonb_array_elements(p_lines) with ordinality x(l, n)
                       where not (jsonb_typeof(l) = 'object' and l ? 'combo_id')), '[]'::jsonb);
  v_dish_count := jsonb_array_length(v_lines);
  for v_c, v_n in select l, n from jsonb_array_elements(p_lines) with ordinality x(l, n)
                   where jsonb_typeof(l) = 'object' and l ? 'combo_id' loop
    if coalesce(v_c->>'combo_id', '') !~* c_uuid or coalesce(v_c->>'quantity', '') !~ '^[0-9]{1,3}$'
       or coalesce(jsonb_typeof(v_c->'parts'), 'missing') <> 'array' or jsonb_array_length(v_c->'parts') > 4
       or exists (select from jsonb_array_elements(v_c->'parts') x
                  where jsonb_typeof(x) <> 'object' or coalesce(x->>'dish_id', '') !~* c_uuid) then
      raise exception 'Refresh the page and try again' using errcode = 'P0001', detail = 'bad_cart';
    end if;
    v_cstate := null;
    select * into v_combo from public.combos c where c.id = (v_c->>'combo_id')::uuid;
    if v_combo.id is null or not v_combo.active or v_combo.archived then
      v_cstate := 'combo_off';
    elsif not public.combo_parts_match(v_combo.id, v_c->'parts') then
      v_cstate := 'combo_parts';
    end if;
    v_combos := v_combos || jsonb_build_array(jsonb_build_object(
      'n', v_n, 'key', v_c->'key', 'state', v_cstate, 'price', v_combo.price_kes, 'asked', (v_c->>'quantity')::integer));
    if v_cstate is null then
      v_lines := v_lines || (
        select jsonb_agg((x - 'quantity' - 'key') || jsonb_build_object(
                 'quantity', i.quantity * least(greatest((v_c->>'quantity')::integer, 1), 20),
                 'combo_n', v_n, 'per', i.quantity) order by i.sort_order)
        from jsonb_array_elements(v_c->'parts') x
        join public.combo_items i on i.combo_id = v_combo.id and i.dish_id = (x->>'dish_id')::uuid);
    end if;
  end loop;
  if jsonb_array_length(v_lines) > 30
     or exists (select from jsonb_array_elements(v_lines) l
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

  for v_line, v_n in select l, n from jsonb_array_elements(v_lines) with ordinality x(l, n) loop
    v_part := v_n > v_dish_count;
    -- R211-02: when one combo's parts are done, keep only the plates its whole combos use, before
    -- the next combo's parts are checked.
    if v_part and v_settle_n is not null and v_line->'combo_n' is distinct from v_settle_n then
      v_used := public.combo_settle(v_used, v_parts_out, v_combos, v_settle_n);
    end if;
    if v_part then v_settle_n := v_line->'combo_n'; end if;
    v_asked := (v_line->>'quantity')::integer;
    v_qty := least(greatest(v_asked, 1), case when v_part then 80 else 20 end);
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

    if v_part and v_price is not null then
      v_price := 0;
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
    if v_state = 'ok' and v_asked > 20 and not v_part then
      v_state := 'capped';
    end if;
    if v_state in ('ok', 'capped') and v_entry.id is not null then
      v_used := v_used || jsonb_build_object(v_entry.id::text, coalesce((v_used->>v_entry.id::text)::integer, 0) + v_qty);
    end if;
    if v_state not in ('ok', 'capped') then
      v_qty := 0;
    end if;

    if v_part then
      v_parts_out := v_parts_out || jsonb_build_array(jsonb_build_object(
        'n', v_line->'combo_n', 'per', v_line->'per', 'dish_id', v_line->'dish_id', 'state', v_state,
        'quantity', v_qty, 'menu_entry_id', v_entry.id, 'unit_price_kes', v_price, 'plates_left', v_left));
    else
      v_out := v_out || jsonb_build_object(
        'key', v_line->'key', 'state', v_state, 'quantity', v_qty, 'menu_entry_id', v_entry.id,
        'unit_price_kes', v_price, 'plates_left', v_left);
    end if;
  end loop;

  -- A combo line takes its parts' states: the first part that can't be had stops it; plates left
  -- cap it to whole combos. Its price is the combo's plus each part's choice and extras.
  for v_c in select * from jsonb_array_elements(v_combos) loop
    v_cparts := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_parts_out) x where x->'n' = v_c->'n'), '[]'::jsonb);
    v_cstate := v_c->>'state';
    v_cqty := 0;
    v_cprice := null;
    if v_cstate is null then
      select x->>'state' into v_cstate from jsonb_array_elements(v_cparts) x
        where x->>'state' not in ('ok', 'capped') limit 1;
    end if;
    if v_cstate is null then
      v_cqty := least(least(greatest((v_c->>'asked')::integer, 1), 20),
                      (select min((x->>'quantity')::integer / (x->>'per')::integer) from jsonb_array_elements(v_cparts) x));
      v_cstate := case when v_cqty = 0 then 'sold_out'
                       when v_cqty < (v_c->>'asked')::integer then 'capped' else 'ok' end;
      v_cprice := (v_c->>'price')::integer
        + (select sum((x->>'unit_price_kes')::integer * (x->>'per')::integer) from jsonb_array_elements(v_cparts) x);
    end if;
    v_out := v_out || jsonb_build_object(
      'key', v_c->'key', 'kind', 'combo', 'state', v_cstate, 'quantity', v_cqty, 'unit_price_kes', v_cprice,
      'parts', (select coalesce(jsonb_agg(jsonb_build_object(
                  'dish_id', x->'dish_id', 'state', x->'state', 'menu_entry_id', x->'menu_entry_id',
                  'plates_left', x->'plates_left')), '[]'::jsonb)
                from jsonb_array_elements(v_cparts) x));
  end loop;
  return v_out;
end $$;
revoke all on function public.check_cart(jsonb) from public;
grant execute on function public.check_cart(jsonb) to anon, authenticated;

-- place_order: also takes combos [{combo_id, quantity, parts}] and discount_code.
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
  v_items jsonb;
  v_combos_in jsonb;
  v_parts jsonb := '[]'::jsonb;
  v_combo_lines jsonb := '[]'::jsonb;
  v_combo_ids jsonb := '{}'::jsonb;
  v_combo public.combos;
  v_c jsonb;
  v_n bigint;
  v_part boolean;
  v_ocid uuid;
  v_covered integer := 0;
  v_code_text text := upper(regexp_replace(coalesce(p->>'discount_code', ''), '\s', '', 'g'));
  v_code public.discount_codes;
  v_reason text;
  v_discount integer := 0;
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

  -- 2.11: items and combos; either may be left out (anything but an array counts as none), not both.
  v_items := case when jsonb_typeof(p->'items') = 'array' then p->'items' else '[]'::jsonb end;
  v_combos_in := case when jsonb_typeof(p->'combos') = 'array' then p->'combos' else '[]'::jsonb end;
  if jsonb_array_length(v_items) + jsonb_array_length(v_combos_in) = 0 then
    raise exception 'Your order is empty' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_items) + jsonb_array_length(v_combos_in) > 30 then
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

  -- 2.11: each combo is locked (an owner edit waits for this order), switched on, and its parts
  -- exactly its dishes. Its dishes then follow the items through the same checks and plate update,
  -- each with its plates (quantity in the combo times the combos) and a price of choice differences
  -- and extras only; the combo's price is added after.
  for v_c, v_n in select x, n from jsonb_array_elements(v_combos_in) with ordinality e(x, n) loop
    v_qty := case when coalesce(v_c->>'quantity', '') ~ '^[0-9]{1,3}$' then (v_c->>'quantity')::integer end;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Invalid quantity' using errcode = 'P0001';
    end if;
    if coalesce(v_c->>'combo_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Refresh the page and try again' using errcode = 'P0001';
    end if;
    select * into v_combo from public.combos c where c.id = (v_c->>'combo_id')::uuid for share;
    if v_combo.id is null or not v_combo.active or v_combo.archived then
      raise exception '% isn’t available any more. Remove it and try again.', coalesce(v_combo.name, 'A combo in your order')
        using errcode = 'P0001', detail = 'combo_off';
    end if;
    if coalesce(jsonb_typeof(v_c->'parts'), 'missing') <> 'array' or jsonb_array_length(v_c->'parts') > 4
       or exists (select from jsonb_array_elements(v_c->'parts') x
                  where jsonb_typeof(x) <> 'object' or coalesce(x->>'dish_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       or not public.combo_parts_match(v_combo.id, v_c->'parts') then
      raise exception '% has changed. Remove it and add it again.', v_combo.name using errcode = 'P0001', detail = 'combo_parts';
    end if;
    v_parts := v_parts || (
      select jsonb_agg((x - 'quantity') || jsonb_build_object('quantity', i.quantity * v_qty, 'combo_n', v_n) order by i.sort_order)
      from jsonb_array_elements(v_c->'parts') x
      join public.combo_items i on i.combo_id = v_combo.id and i.dish_id = (x->>'dish_id')::uuid);
    v_combo_lines := v_combo_lines || jsonb_build_array(jsonb_build_object(
      'n', v_n, 'combo_id', v_combo.id, 'name', v_combo.name, 'price', v_combo.price_kes, 'quantity', v_qty));
  end loop;
  -- The limit counts each dish of a combo.
  if jsonb_array_length(v_items) + jsonb_array_length(v_parts) > 30 then
    raise exception 'Too many items in one order' using errcode = 'P0001';
  end if;

  for v_item, v_n in select x, n from jsonb_array_elements(v_items || v_parts) with ordinality e(x, n) loop
    v_part := v_n > jsonb_array_length(v_items);
    v_qty := case when v_item->>'quantity' ~ '^[0-9]{1,3}$' then (v_item->>'quantity')::integer end;
    if v_qty is null or v_qty < 1 or v_qty > (case when v_part then 80 else 20 end) then
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
    if v_part then
      v_price := 0;
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
    if not v_part then
      v_covered := v_covered + v_price * v_qty;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'combo_n', case when v_part then v_item->'combo_n' end,
      'dish_id', v_dish.id, 'menu_entry_id', v_entry.id, 'option_id', v_option.id,
      'name', v_dish.name, 'option_label', v_option.label, 'unit_price_kes', v_price,
      'quantity', v_qty, 'note', left(nullif(trim(v_item->>'note'), ''), 200),
      'extras', v_extras);
  end loop;

  v_subtotal := v_subtotal + coalesce((select sum((c->>'price')::integer * (c->>'quantity')::integer)
                                        from jsonb_array_elements(v_combo_lines) c), 0);

  -- The minimum counts the food only (combos too), before the delivery fee (Q1 A) and the discount (2.11 Q4 A).
  if v_mode = 'delivery' and v_subtotal < v_zone.min_order_kes then
    raise exception 'Your order is under %''s KSh % minimum for delivery. Add more, or choose pickup.',
      v_zone.name, to_char(v_zone.min_order_kes, 'FM99,999')
      using errcode = 'P0001', detail = 'under_minimum';
  end if;

  -- 2.11 C: the code, with its row locked so two orders can't both take its last use. Its refusals
  -- carry hint 'discount_code:<reason>' so checkout can offer "Place without the code".
  if v_code_text <> '' then
    if v_code_text ~ '^[A-Z0-9]{3,20}$' then
      select * into v_code from public.discount_codes d where d.code = v_code_text for update;
    end if;
    v_reason := case when v_code.id is null then 'unknown'
                     else public.discount_code_refusal(v_code, v_subtotal, v_covered, v_mode, trim(p->>'customer_phone')) end;
    if v_reason is not null then
      raise exception '% can’t be used: %.', v_code_text,
        case v_reason
          when 'unknown' then 'we don’t know that code'
          when 'off' then 'it isn’t on right now'
          when 'not_started' then 'it starts on ' || to_char(v_code.starts_on, 'FMDD Mon')
          when 'ended' then 'it has ended'
          when 'used_up' then 'it has run out'
          when 'min_order' then 'it is for orders of KSh ' || to_char(v_code.min_order_kes, 'FM99,999') || ' or more'
          when 'combos_only' then 'codes don’t apply to combos'
          when 'mode' then 'it isn’t for this kind of order'
          when 'phone_used' then 'this phone number has already used it'
          else 'it can’t be used on this order' end
        using errcode = 'P0001', detail = 'discount_code', hint = 'discount_code:' || v_reason;
    end if;
    v_discount := public.discount_for(v_code, v_covered);
  end if;

  insert into public.orders (
    mode, table_id, pickup_at, delivery_zone_id, delivery_address, delivery_notes,
    customer_name, customer_phone, payment_method, payment_status,
    subtotal_kes, delivery_fee_kes, total_kes, idempotency_key, discount_code_id, discount_code, discount_kes)
  values (
    v_mode, v_table_id,
    v_pickup_at,
    case when v_mode = 'delivery' then v_zone.id end,
    case when v_mode = 'delivery' then left(trim(p->>'delivery_address'), 300) end,
    case when v_mode = 'delivery' then left(nullif(trim(p->>'delivery_notes'), ''), 300) end,
    left(trim(p->>'customer_name'), 80), trim(p->>'customer_phone'), v_payment,
    'unpaid'::public.payment_status,
    v_subtotal, v_fee, v_subtotal - v_discount + v_fee, v_key, v_code.id, v_code.code, v_discount)
  returning id into v_order_id;

  for v_c in select * from jsonb_array_elements(v_combo_lines) loop
    insert into public.order_combos (order_id, combo_id, name, unit_price_kes, quantity, sort_order)
    values (v_order_id, (v_c->>'combo_id')::uuid, v_c->>'name', (v_c->>'price')::integer,
            (v_c->>'quantity')::integer, (v_c->>'n')::integer)
    returning id into v_ocid;
    v_combo_ids := v_combo_ids || jsonb_build_object(v_c->>'n', v_ocid);
  end loop;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, order_combo_id, dish_id, menu_entry_id, option_id, name, option_label, unit_price_kes, quantity, note)
    values (v_order_id, (v_combo_ids->>(v_line->>'combo_n'))::uuid, (v_line->>'dish_id')::uuid, nullif(v_line->>'menu_entry_id', '')::uuid,
            nullif(v_line->>'option_id', '')::uuid, v_line->>'name', v_line->>'option_label',
            (v_line->>'unit_price_kes')::integer, (v_line->>'quantity')::integer, v_line->>'note')
    returning id into v_item_id;
    insert into public.order_item_extras (order_item_id, option_id, label, price_kes, sort_order)
      select v_item_id, (x->>'option_id')::uuid, x->>'label', (x->>'price_kes')::integer, (n - 1)::smallint
      from jsonb_array_elements(v_line->'extras') with ordinality as e(x, n);
  end loop;

  return query select o.public_token, o.code, o.total_kes, false from public.orders o where o.id = v_order_id;
end $$;

-- get_order_status: adds discount_kes, discount_code and combos; items leave out combo dishes.
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
    'discount_kes', o.discount_kes,
    'discount_code', o.discount_code,
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
    'phone', (select k.phone from public.kitchen_settings k where k.id),
    'delivery_address', case when o.mode = 'delivery' then o.delivery_address end,
    'delivery_notes', case when o.mode = 'delivery' then o.delivery_notes end,
    'kitchen_address', case when o.mode <> 'delivery' then (select k.address from public.kitchen_settings k where k.id) end,
    'maps_url', case when o.mode <> 'delivery' then (select k.maps_url from public.kitchen_settings k where k.id) end,
    'rating', (select jsonb_build_object('sent_at', rt.created_at, 'stars', rt.stars,
                 'comment_sent', rt.comment is not null,
                 'reply', case when rt.reply is not null
                               then jsonb_build_object('text', rt.reply, 'replied_at', rt.replied_at) end)
                 from public.order_ratings rt where rt.order_id = o.id),
    'rate_dishes', coalesce((select jsonb_agg(s.name order by s.name) from (
        select distinct on (i.dish_id) i.name from public.order_items i
         where i.order_id = o.id order by i.dish_id, i.name) s), '[]'::jsonb),
    'rate_until', case when o.status = 'completed' then o.status_changed_at + interval '7 days' end,
    'google_review_url', case when o.status = 'completed'
                           then (select k.google_review_url from public.kitchen_settings k where k.id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity,
        'unit_price_kes', i.unit_price_kes, 'note', i.note,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'price_kes', x.price_kes) order by x.sort_order)
                            from public.order_item_extras x where x.order_item_id = i.id), '[]'::jsonb))
        order by i.name)
      from public.order_items i where i.order_id = o.id and i.order_combo_id is null), '[]'::jsonb),
    -- 2.11: a combo with its price each (the combo's plus its dishes' choices and extras) and its dishes,
    -- each with its quantity in one combo.
    'combos', coalesce((select jsonb_agg(jsonb_build_object(
        'name', c.name, 'quantity', c.quantity,
        'unit_price_kes', c.unit_price_kes
          + coalesce((select sum(i.unit_price_kes * i.quantity) from public.order_items i where i.order_combo_id = c.id), 0) / c.quantity,
        'parts', coalesce((select jsonb_agg(jsonb_build_object(
            'name', i.name, 'option_label', i.option_label, 'quantity', i.quantity / c.quantity, 'note', i.note,
            'extras', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'price_kes', x.price_kes) order by x.sort_order)
                                from public.order_item_extras x where x.order_item_id = i.id), '[]'::jsonb))
            -- The combo's own dish order (combo_items.sort_order); a deleted combo falls back to the name.
            order by (select min(ci.sort_order) from public.combo_items ci where ci.combo_id = c.combo_id and ci.dish_id = i.dish_id) nulls last, i.name)
          from public.order_items i where i.order_combo_id = c.id), '[]'::jsonb))
        order by c.sort_order)
      from public.order_combos c where c.order_id = o.id), '[]'::jsonb))
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  where o.public_token = p_token
$$;
