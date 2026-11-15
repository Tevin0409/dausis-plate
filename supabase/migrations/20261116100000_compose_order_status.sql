-- Wave 2 integration (RW2B-01): one get_order_status for the customer's page.
-- 2.8 (20261112000000_customer_flow) added the kitchen's phone, address and maps link, the delivery
-- address and notes, and each item's note and extras. 2.9 (20261113000000_table_requests) started
-- from 2.5's version and added placed_today and requests, so, running later, it dropped 2.8's fields.
-- This is 2.8's payload plus 2.9's two fields. Same signature, same token-only access: anyone with
-- the order's link sees that order and nothing else (requests are times only, never other orders).
-- create or replace keeps init's grant to anon and authenticated.
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
