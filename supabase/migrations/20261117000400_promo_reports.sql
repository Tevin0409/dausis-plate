-- Slice 2.11 in Reports (spec-2.12, Tevin 2026-11-15 "Food A"): Food stays at menu value and a
-- Discounts column sits next to it, so Food − Discounts + Fees = Sales, in the sales table and in
-- Delivery by area. The order sheet and the orders CSV carry the discount and the code, and
-- report_promos_ads fills the Promos & ads tab: codes, combos and the ads for invoicing.

-- The sales table: 'discounts' per bucket. The rest of report_sales is as 2.12 wrote it.
create or replace function public.report_sales(p_from date, p_to date, p_cmp_from date default null, p_cmp_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_days integer := p_to - p_from + 1;
  v_grain text := case when p_to - p_from + 1 <= 62 then 'day' when p_to - p_from + 1 <= 182 then 'week' else 'month' end;
  v_first date;
  v_cmp jsonb;
  v_out jsonb;
begin
  perform public.report_guard(p_from, p_to);
  select min((created_at at time zone 'Africa/Nairobi')::date) into v_first from public.orders;
  if p_cmp_from is not null and p_cmp_to is not null then
    if p_cmp_from > p_cmp_to or p_cmp_to - p_cmp_from > 365 then
      raise exception 'The comparison range is not valid.' using errcode = 'P0001';
    end if;
    -- A comparison before the first order has no figures to compare with.
    if v_first is not null and p_cmp_to >= v_first then v_cmp := public.report_tiles(p_cmp_from, p_cmp_to); end if;
  end if;

  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'grain', v_grain, 'first_order_day', v_first,
    'tiles', public.report_tiles(p_from, p_to),
    'compare', v_cmp, 'compare_from', p_cmp_from, 'compare_to', p_cmp_to,

    'by_bucket', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'sales', s, 'orders', n, 'food', fo, 'discounts', di, 'fees', f) order by b), '[]')
      from (
        select date_trunc(v_grain, ((created_at at time zone 'Africa/Nairobi')::date)::timestamp)::date as b,
               sum(total_kes) as s, count(*) as n, sum(subtotal_kes) as fo, sum(discount_kes) as di, sum(delivery_fee_kes) as f
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'by_hour', case when v_days = 1 then (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', s, 'orders', n) order by h), '[]')
      from (
        select extract(hour from created_at at time zone 'Africa/Nairobi')::integer as h, sum(total_kes) as s, count(*) as n
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date = p_from
        group by 1) x) else '[]'::jsonb end,

    'by_payment_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', m, 'orders', n, 'paid', p, 'not_paid', n - p) order by m), '[]')
      from (
        select payment_method::text as m, count(*) as n, count(*) filter (where payment_status = 'paid') as p
        from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'by_mode', (
      select coalesce(jsonb_agg(jsonb_build_object('mode', m, 'orders', n, 'sales', s) order by m), '[]')
      from (
        select mode::text as m, count(*) as n, sum(total_kes) as s from public.orders
        where status <> 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) x),

    'cancellations', jsonb_build_object(
      'by_reason', (
        select coalesce(jsonb_agg(jsonb_build_object('reason', r, 'orders', n, 'kes', s) order by n desc, r), '[]')
        from (
          select coalesce(cancel_reason::text, 'none') as r, count(*) as n, sum(total_kes) as s from public.orders
          where status = 'cancelled' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) x),
      'orders', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', o.code, 'created_at', o.created_at, 'total', o.total_kes, 'reason', o.cancel_reason, 'note', o.cancel_note,
          'paid', o.payment_status = 'paid',
          'credit_note', (select public.credit_note_code(c.number) from public.credit_notes c where c.order_id = o.id and c.voided_at is null))
          order by o.created_at desc), '[]')
        from (select * from public.orders where status = 'cancelled'
                and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
              order by created_at desc limit 300) o)),

    'money_in', (
      select coalesce(jsonb_agg(row_to_json(m)::jsonb order by m.bucket), '[]')
      from (
        select date_trunc(v_grain, d::timestamp)::date as bucket,
          coalesce(sum(amt) filter (where kind = 'cash'), 0) as cash,
          coalesce(sum(amt) filter (where kind = 'mpesa'), 0) as mpesa,
          coalesce(sum(amt) filter (where kind = 'mpesa_online'), 0) as mpesa_online,
          coalesce(sum(amt) filter (where kind = 'card'), 0) as card,
          coalesce(sum(amt) filter (where kind = 'not_recorded'), 0) as not_recorded,
          count(*) filter (where kind = 'cash') as cash_n,
          count(*) filter (where kind = 'mpesa') as mpesa_n,
          coalesce(sum(amt) filter (where kind like 'cn\_%'), 0) as credit_notes,
          coalesce(sum(amt) filter (where kind = 'cn_cash'), 0) as cn_cash,
          coalesce(sum(amt) filter (where kind = 'cn_mpesa'), 0) as cn_mpesa,
          coalesce(sum(amt) filter (where kind like 'cnv\_%'), 0) as credit_notes_voided,
          coalesce(sum(amt) filter (where kind = 'cnv_cash'), 0) as cnv_cash,
          coalesce(sum(amt) filter (where kind = 'cnv_mpesa'), 0) as cnv_mpesa,
          coalesce(sum(amt) filter (where kind in ('cash','mpesa','mpesa_online','card','not_recorded')), 0)
            - coalesce(sum(amt) filter (where kind like 'cn\_%'), 0)
            + coalesce(sum(amt) filter (where kind like 'cnv\_%'), 0) as net,
          count(*) filter (where kind in ('cash','mpesa','mpesa_online','card','not_recorded') and legacy) as legacy_n
        from (
          select (coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date as d,
                 public.pay_kind(paid_with, payment_method) as kind, total_kes as amt, paid_at is null as legacy
          from public.orders
          where payment_status = 'paid' and (coalesce(paid_at, created_at) at time zone 'Africa/Nairobi')::date between p_from and p_to
          union all
          select (issued_at at time zone 'Africa/Nairobi')::date, 'cn_' || refunded_with::text, amount_kes, false
          from public.credit_notes where (issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          union all
          select (voided_at at time zone 'Africa/Nairobi')::date, 'cnv_' || refunded_with::text, amount_kes, false
          from public.credit_notes
          where voided_at is not null and (voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        ) ev group by 1) m),

    'to_collect', (
      select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'created_at', o.created_at, 'mode', o.mode,
        'table', t.label, 'total', o.total_kes) order by o.created_at), '[]')
      from (select * from public.orders
            where status <> 'cancelled' and payment_status <> 'paid'
              and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
            order by created_at limit 10) o
      left join public.dining_tables t on t.id = o.table_id),

    -- A follow-up list, not a period figure: every date.
    'paid_cancelled_open', (
      select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'paid_at', coalesce(o.paid_at, o.created_at),
        'total', o.total_kes, 'reason', o.cancel_reason, 'note', o.cancel_note) order by coalesce(o.paid_at, o.created_at)), '[]')
      from public.orders o
      where o.status = 'cancelled' and o.payment_status = 'paid'
        and not exists (select from public.credit_notes c where c.order_id = o.id and c.voided_at is null)),

    'credit_notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', public.credit_note_code(c.number), 'number', c.number, 'order', o.code, 'order_total', o.total_kes,
        'amount', c.amount_kes, 'kept', o.total_kes - c.amount_kes, 'refunded_with', c.refunded_with, 'reason', c.reason,
        'issued_at', c.issued_at, 'voided_at', c.voided_at, 'void_reason', c.void_reason) order by c.number), '[]')
      from public.credit_notes c join public.orders o on o.id = c.order_id
      where (c.issued_at at time zone 'Africa/Nairobi')::date between p_from and p_to
         or (c.voided_at is not null and (c.voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to))
  ) into v_out;
  return v_out;
end $$;

-- The order sheet: the discount and code; combos with their dishes; the order's own lines without them.
create or replace function public.report_order(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  if not public.is_owner() then raise exception 'Only the owner can see reports.' using errcode = '42501'; end if;
  select * into v_order from public.orders where code = upper(btrim(coalesce(p_code, '')));
  if v_order.id is null then return null; end if;
  return jsonb_build_object(
    'id', v_order.id, 'code', v_order.code, 'customer_name', v_order.customer_name, 'mode', v_order.mode,
    'created_at', v_order.created_at, 'pickup_at', v_order.pickup_at, 'status', v_order.status,
    'cancel_reason', v_order.cancel_reason, 'cancel_note', v_order.cancel_note,
    'total', v_order.total_kes, 'subtotal', v_order.subtotal_kes, 'fee', v_order.delivery_fee_kes,
    'discount', v_order.discount_kes, 'discount_code', v_order.discount_code,
    'payment_method', v_order.payment_method, 'payment_status', v_order.payment_status,
    'paid_with', v_order.paid_with, 'paid_at', v_order.paid_at,
    'table', (select label from public.dining_tables where id = v_order.table_id),
    'zone', (select name from public.delivery_zones where id = v_order.delivery_zone_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option_label, 'quantity', i.quantity,
        'unit', i.unit_price_kes) order by i.name), '[]') from public.order_items i where i.order_id = v_order.id and i.order_combo_id is null),
    -- 2.11: each combo at its price, its dishes under it (a dish's unit is its choice difference and extras).
    'combos', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'quantity', c.quantity,
        'unit', c.unit_price_kes + coalesce((select sum(i.unit_price_kes * i.quantity) from public.order_items i where i.order_combo_id = c.id), 0) / c.quantity,
        'dishes', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option_label, 'quantity', i.quantity / c.quantity)
                     order by (select min(ci.sort_order) from public.combo_items ci where ci.combo_id = c.combo_id and ci.dish_id = i.dish_id) nulls last, i.name), '[]')
                   from public.order_items i where i.order_combo_id = c.id)) order by c.sort_order), '[]')
      from public.order_combos c where c.order_id = v_order.id),
    'credit_notes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', public.credit_note_code(c.number), 'amount', c.amount_kes, 'kept', v_order.total_kes - c.amount_kes,
        'refunded_with', c.refunded_with, 'reason', c.reason, 'issued_at', c.issued_at, 'issued_by', public.person_label(c.issued_by),
        'voided_at', c.voided_at, 'voided_by', case when c.voided_by is not null then public.person_label(c.voided_by) end,
        'void_reason', c.void_reason) order by c.number desc), '[]')
      from public.credit_notes c where c.order_id = v_order.id)
  );
end $$;

-- Delivery by area: the discounts next to the food.
create or replace function public.report_delivery(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object('zones', (
    select coalesce(jsonb_agg(jsonb_build_object('zone', z, 'orders', n, 'fees', f, 'food', fo, 'discounts', di) order by n desc, z), '[]')
    from (select coalesce(zn.name, 'Deleted area') as z, count(*) as n, sum(o.delivery_fee_kes) as f, sum(o.subtotal_kes) as fo,
                 sum(o.discount_kes) as di
          from public.orders o left join public.delivery_zones zn on zn.id = o.delivery_zone_id
          where o.mode = 'delivery' and o.status <> 'cancelled'
            and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
          group by 1) x));
end $$;

-- The orders CSV gains the discount and the code (spec-2.12 CSV), and a combo reads as its name
-- with its dishes: "1× Lunch combo (Beef pilau, Masala chai)". Its return type changes, so it's
-- dropped and made again.
drop function public.report_orders_csv(date, date);
create function public.report_orders_csv(p_from date, p_to date)
returns table (
  code text, day date, at_time text, mode text, place text, items text, subtotal_kes integer, fee_kes integer,
  discount_kes integer, discount_code text, total_kes integer,
  payment_method text, payment_status text, paid_with text, paid_day date, paid_time text, status text, cancel_reason text,
  cancel_note text, customer_name text, credit_note text, credit_note_kes integer
)
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
begin
  perform public.report_guard(p_from, p_to);
  return query
  select o.code, (o.created_at at time zone 'Africa/Nairobi')::date, to_char(o.created_at at time zone 'Africa/Nairobi', 'HH24:MI'),
    o.mode::text, coalesce(t.label, z.name, ''),
    coalesce((select string_agg(x.line, '; ' order by x.sort, x.line) from (
        select 0 as sort, i.quantity || '× ' || i.name || coalesce(' (' || i.option_label || ')', '') as line
        from public.order_items i where i.order_id = o.id and i.order_combo_id is null
        union all
        select 1, c.quantity || '× ' || c.name || coalesce(' (' || (
            select string_agg(i.name, ', ' order by i.name) from public.order_items i where i.order_combo_id = c.id) || ')', '')
        from public.order_combos c where c.order_id = o.id) x), ''),
    o.subtotal_kes, o.delivery_fee_kes, o.discount_kes, coalesce(o.discount_code, ''), o.total_kes,
    o.payment_method::text, o.payment_status::text, coalesce(o.paid_with::text, ''),
    (o.paid_at at time zone 'Africa/Nairobi')::date, coalesce(to_char(o.paid_at at time zone 'Africa/Nairobi', 'HH24:MI'), ''),
    o.status::text, coalesce(o.cancel_reason::text, ''), coalesce(o.cancel_note, ''), o.customer_name,
    coalesce(public.credit_note_code(c.number), ''), c.amount_kes
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.delivery_zones z on z.id = o.delivery_zone_id
  left join public.credit_notes c on c.order_id = o.id and c.voided_at is null
  where (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  order by o.created_at;
end $$;

-- Promos & ads (spec-2.12 "Promos & ads"). Orders that aren't cancelled, placed in the period.
-- codes: every code, 0 when unused, with whether it's on; combos sold and their revenue (the combo
-- price plus its dishes' choices and extras, which a dish's unit_price_kes already holds); ads' views and taps from ad_daily_counts, in the period
-- or, with p_ads_whole_run, from each ad's start to its end (or today). Ads with no views are left out.
create or replace function public.report_promos_ads(p_from date, p_to date, p_ads_whole_run boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_today date := public.nairobi_today();
begin
  perform public.report_guard(p_from, p_to);
  return jsonb_build_object(
    'codes', (
      select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'active', d.active, 'uses', coalesce(u.n, 0),
          'discount', coalesce(u.di, 0), 'sales', coalesce(u.s, 0)) order by coalesce(u.n, 0) desc, d.code), '[]')
      from public.discount_codes d
      left join (
        select o.discount_code_id as id, count(*)::integer as n, sum(o.discount_kes)::integer as di, sum(o.total_kes)::integer as s
        from public.orders o
        where o.discount_code_id is not null and o.status <> 'cancelled'
          and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by 1) u on u.id = d.id),
    'combos', (
      select coalesce(jsonb_agg(jsonb_build_object('combo', x.name, 'sold', x.sold, 'revenue', x.revenue) order by x.sold desc, x.name), '[]')
      from (
        select coalesce(cb.name, c.name) as name, sum(c.quantity)::integer as sold,
               sum(c.unit_price_kes * c.quantity
                   + coalesce((select sum(i.unit_price_kes * i.quantity)
                               from public.order_items i where i.order_combo_id = c.id), 0))::integer as revenue
        from public.order_combos c
        join public.orders o on o.id = c.order_id
        left join public.combos cb on cb.id = c.combo_id
        where o.status <> 'cancelled' and (o.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
        group by coalesce(c.combo_id::text, c.name), coalesce(cb.name, c.name)) x),
    'ads_whole_run', p_ads_whole_run,
    'ads', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'advertiser', a.advertiser, 'space', a.space,
          'starts_on', a.starts_on, 'ends_on', a.ends_on, 'views', v.views, 'taps', v.taps) order by v.views desc, a.advertiser), '[]')
      from public.ads a
      join lateral (
        select coalesce(sum(n.views), 0)::integer as views, coalesce(sum(n.taps), 0)::integer as taps
        from public.ad_daily_counts n
        where n.ad_id = a.id
          and case when p_ads_whole_run then n.day between a.starts_on and least(a.ends_on, v_today)
                   else n.day between p_from and p_to end) v on true
      where v.views > 0)
  );
end $$;

revoke all on function public.report_orders_csv(date, date) from public, anon;
revoke all on function public.report_promos_ads(date, date, boolean) from public, anon;
grant execute on function public.report_orders_csv(date, date) to authenticated;
grant execute on function public.report_promos_ads(date, date, boolean) to authenticated;
