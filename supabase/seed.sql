-- Sample data for local development only. Replace with her real menu.
insert into public.delivery_zones (name, fee_kes, sort_order) values
  ('Kilimani', 150, 1), ('Lavington', 200, 2), ('Westlands', 200, 3), ('CBD', 150, 4);

insert into public.dining_tables (label) select 'Table ' || g from generate_series(1, 10) g;

insert into public.dishes (name, description, price_kes, category, is_regular, sort_order) values
  ('Beef Stew & Chapati', 'Slow-cooked beef, two soft chapatis', 480, 'mains', true, 1),
  ('Ugali, Sukuma & Nyama Choma', 'Grilled goat, greens, kachumbari', 550, 'mains', true, 2),
  ('Chicken Biryani', 'Spiced rice, tender chicken', 600, 'mains', true, 3),
  ('Chapati (2)', 'Soft layered chapatis', 60, 'sides', true, 1),
  ('Passion juice', 'Fresh, 500 ml', 150, 'drinks', true, 1),
  ('Masala chai', 'Hot, with ginger', 80, 'drinks', true, 2);

insert into public.dishes (name, description, price_kes, category) values
  ('Coconut Fish Curry & Pilau', 'Tilapia simmered in coconut and tomato, with spiced pilau and kachumbari.', 650, 'mains'),
  ('Mukimo & Beef Fry', 'Mashed peas, potatoes and greens with pan-fried beef.', 520, 'mains'),
  ('Matoke & Goat Stew', 'Green bananas stewed with tender goat.', 580, 'mains'),
  ('Kienyeji Chicken Stew', 'Free-range chicken, slow stewed.', 700, 'mains');

insert into public.dish_options (dish_id, label, price_delta_kes, is_default, sort_order)
select id, o.label, o.delta, o.is_default, o.ord
from public.dishes,
  (values ('Spiced pilau', 0, true, 1), ('Two chapatis', 30, false, 2), ('Ugali', 0, false, 3)) as o(label, delta, is_default, ord)
where name = 'Coconut Fish Curry & Pilau';
-- Slice 2.6: extras the customer can add (any number, one of each per plate).
insert into public.dish_options (dish_id, kind, label, price_delta_kes, is_default, sort_order)
select id, 'extra', o.label, o.delta, false, o.ord
from public.dishes,
  (values ('Avocado', 50, 4), ('Extra kachumbari', 30, 5)) as o(label, delta, ord)
where name = 'Coconut Fish Curry & Pilau';

insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'day', public.nairobi_today(), public.nairobi_today(), 40, 1 from public.dishes where name = 'Coconut Fish Curry & Pilau';
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'day', public.nairobi_today(), public.nairobi_today(), 20, 2 from public.dishes where name = 'Mukimo & Beef Fry';
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'week', date_trunc('week', public.nairobi_today())::date, (date_trunc('week', public.nairobi_today()) + interval '6 days')::date, 30, 3
from public.dishes where name = 'Matoke & Goat Stew';

-- Slice 2.8: sample kitchen address and directions for the status page (the real ones are Tevin's
-- to give; set them in Settings), and tomorrow's dishes so the closed-kitchen menu has something.
update public.kitchen_settings
set address = 'Argwings Kodhek Rd, Kilimani, Nairobi',
    maps_url = 'https://maps.google.com/?q=Argwings+Kodhek+Rd+Kilimani+Nairobi'
where id;
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'day', public.nairobi_today() + 1, public.nairobi_today() + 1, 25, 1 from public.dishes where name = 'Mukimo & Beef Fry';

-- ───────────────────────── Reports sample data (slice 2.12) ─────────────────────────
-- The test database sets dausis.skip_report_seed (scripts/test-db-setup.ts) so these don't change counts in tests.
-- Six weeks of orders ending today, every mode, payment method, status and cancel reason, so the
-- Reports screen always has something to show. All dates are relative to today (Nairobi).
create function pg_temp.seed_order(
  p_day date, p_hour integer, p_min integer, p_mode public.order_mode, p_status public.order_status,
  p_method public.payment_method, p_paid boolean, p_with public.paid_with, p_paid_days integer,
  p_cancel public.cancel_reason, p_name text, p_dishes text[]
) returns uuid language plpgsql as $$
declare
  v_at timestamptz := ((p_day + make_time(p_hour, p_min, 0))::timestamp at time zone 'Africa/Nairobi');
  v_zone public.delivery_zones;
  v_sub integer;
  v_id uuid;
  v_paid_at timestamptz;
begin
  if v_at > now() then v_at := now() - interval '3 minutes'; end if;
  select * into v_zone from public.delivery_zones order by sort_order offset (p_hour % 4) limit 1;
  select sum(price_kes) into v_sub from public.dishes where name = any (p_dishes);
  v_paid_at := case when p_paid then least(v_at + make_interval(days => p_paid_days, mins => 20), now()) end;
  insert into public.orders (mode, table_id, delivery_zone_id, delivery_address, customer_name, customer_phone, payment_method,
      payment_status, status, subtotal_kes, delivery_fee_kes, total_kes, created_at, updated_at, status_changed_at, cancel_reason,
      paid_at, paid_with)
    values (p_mode,
      case when p_mode = 'dine_in' then (select id from public.dining_tables order by label offset (p_hour % 10) limit 1) end,
      case when p_mode = 'delivery' then v_zone.id end, case when p_mode = 'delivery' then 'Sample street 1' end,
      p_name, '0712345678', p_method, case when p_paid then 'paid' else 'unpaid' end::public.payment_status, p_status,
      v_sub, case when p_mode = 'delivery' then v_zone.fee_kes else 0 end,
      v_sub + case when p_mode = 'delivery' then v_zone.fee_kes else 0 end, v_at, v_at, v_at, p_cancel, v_paid_at, p_with)
    returning id into v_id;
  insert into public.order_items (order_id, dish_id, name, unit_price_kes, quantity)
    select v_id, d.id, d.name, d.price_kes, 1 + (length(p_name) % 2) from public.dishes d where d.name = any (p_dishes);
  return v_id;
end $$;

do $$
declare
  v_skip boolean := coalesce(current_setting('dausis.skip_report_seed', true), '') = 'on';
  v_today date := public.nairobi_today();
  v_dishes text[] := array['Beef Stew & Chapati', 'Ugali, Sukuma & Nyama Choma', 'Chicken Biryani', 'Chapati (2)', 'Passion juice',
    'Masala chai', 'Coconut Fish Curry & Pilau', 'Mukimo & Beef Fry', 'Matoke & Goat Stew', 'Kienyeji Chicken Stew'];
  v_names text[] := array['Amina', 'Kamau', 'Wanjiru', 'Otieno', 'Fatuma', 'Brian', 'Njeri', 'Hassan'];
  v_reasons public.cancel_reason[] := array['sold_out', 'too_busy', 'cant_deliver', 'customer_asked', 'no_show']::public.cancel_reason[];
  d integer; k integer; v_n integer; v_h integer; v_day date; v_mode public.order_mode; v_status public.order_status;
  v_paid boolean; v_with public.paid_with; v_cancel public.cancel_reason; v_id uuid; v_i integer := 0;
  v_cn integer := 0; v_dish text[];
begin
  if v_skip then return; end if;
  for d in 0..41 loop
    v_day := v_today - d;
    v_n := 3 + abs(hashtext(v_day::text)) % 6;
    for k in 1..v_n loop
      v_i := v_i + 1;
      v_h := 11 + abs(hashtext(v_day::text || k)) % 9;
      v_mode := (array['dine_in', 'pickup', 'delivery']::public.order_mode[])[1 + v_i % 3];
      v_dish := array[v_dishes[1 + v_i % 10], v_dishes[1 + (v_i * 3 + 1) % 10]];
      v_cancel := null; v_with := null;
      if v_i % 11 = 0 then
        v_status := 'cancelled'; v_cancel := v_reasons[1 + v_i % 5]; v_paid := false;
      elsif d = 0 and k > v_n - 2 then
        v_status := case when k = v_n then 'new' else 'preparing' end; v_paid := false;
      else
        v_status := 'completed'; v_paid := v_i % 7 <> 0;
      end if;
      if v_paid then v_with := case when d > 35 and v_i % 2 = 0 then null when v_i % 3 = 0 then 'mpesa' else 'cash' end::public.paid_with; end if;
      perform pg_temp.seed_order(v_day, v_h, abs(hashtext(v_day::text || k || 'm')) % 60, v_mode, v_status,
        case when v_i % 4 = 0 then 'on_handover' else 'at_counter' end::public.payment_method, v_paid, v_with,
        case when v_i % 9 = 0 and d > 0 then 1 else 0 end, v_cancel, v_names[1 + v_i % 8], v_dish);
    end loop;
  end loop;

  -- Paid, then cancelled: a full credit note (cash), a lowered one (M-Pesa, 150 kept), one voided on a later
  -- day and issued again, and one with none (it stays on the follow-up list).
  for d in 1..4 loop
    v_id := pg_temp.seed_order(v_today - (d + 1), 13, 5 * d, 'pickup', 'cancelled', 'at_counter', true,
      case when d % 2 = 0 then 'mpesa' else 'cash' end::public.paid_with, 0, 'customer_asked', 'Refund sample ' || d,
      array['Chicken Biryani', 'Masala chai']);
    if d <= 3 then
      v_cn := v_cn + 1;
      insert into public.credit_notes (number, order_id, amount_kes, reason, issued_at, issued_by, refunded_with, voided_at, voided_by, void_reason)
        select v_cn, v_id, case when d = 2 then total_kes - 150 else total_kes end, 'Refund: customer asked',
          paid_at + interval '2 hours', coalesce((select user_id from public.staff order by role limit 1), '00000000-0000-4000-8000-000000000001'::uuid), case when d = 2 then 'mpesa' else 'cash' end::public.paid_with,
          case when d = 3 then paid_at + interval '26 hours' end,
          case when d = 3 then coalesce((select user_id from public.staff order by role limit 1), '00000000-0000-4000-8000-000000000001'::uuid) end, case when d = 3 then 'Wrong amount' end
        from public.orders where id = v_id;
      if d = 3 then
        v_cn := v_cn + 1;
        insert into public.credit_notes (number, order_id, amount_kes, reason, issued_at, issued_by, refunded_with)
          select v_cn, v_id, total_kes, 'Refund: customer asked', paid_at + interval '27 hours', coalesce((select user_id from public.staff order by role limit 1), '00000000-0000-4000-8000-000000000001'::uuid), 'cash'
          from public.orders where id = v_id;
      end if;
    end if;
  end loop;
  update public.credit_note_counter set last_number = v_cn;
end $$;

-- Dishes that ran out: past days on the menu, one that sold out at a known time and one that came back.
do $$ begin if coalesce(current_setting('dausis.skip_report_seed', true), '') = 'on' then return; end if;
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, show_from, show_until)
select d.id, 'day', public.nairobi_today() - g, public.nairobi_today() - g, 12, '10:00', '21:00'
from public.dishes d, generate_series(1, 9, 2) g where d.name = 'Kienyeji Chicken Stew';
insert into public.menu_entry_days (entry_id, day, plates_sold, sold_out_manual, sold_out_at)
select e.id, e.starts_on, case when g % 4 = 1 then 12 when g % 4 = 3 then 9 else 7 end, false,
  case when g % 4 = 1 then ((e.starts_on + time '13:10')::timestamp at time zone 'Africa/Nairobi')
       when g = 7 then ((e.starts_on + time '12:40')::timestamp at time zone 'Africa/Nairobi') end
from (select e.*, (public.nairobi_today() - e.starts_on) as g from public.menu_entries e) e
join public.dishes d on d.id = e.dish_id
where d.name = 'Kienyeji Chicken Stew' and e.starts_on < public.nairobi_today();
end $$;

-- ───────────────────────── Promos sample data (slice 2.11, for Reports' Promos & ads) ─────────────────────────
-- Two codes used on some of the orders above and one switched off and never used; a combo on some
-- others; two ads with daily counts: one that ran on the menu and has ended, one live on the order page.
do $$
declare
  v_today date := public.nairobi_today();
  v_combo uuid;
  v_menu_ad uuid;
  v_order_ad uuid;
  v_oc uuid;
  o record;
begin
  if coalesce(current_setting('dausis.skip_report_seed', true), '') = 'on' then return; end if;
  insert into public.discount_codes (code, kind, value, cap_kes, starts_on, ends_on, once_per_phone, modes, active) values
    ('KARIBU10', 'percent', 10, 300, v_today - 42, v_today + 30, false, '{dine_in,pickup,delivery}', true),
    ('PICKUP50', 'amount', 50, null, v_today - 42, v_today + 30, false, '{dine_in,pickup}', true),
    ('WELCOME', 'amount', 100, null, v_today, v_today + 30, true, '{dine_in,pickup,delivery}', false);

  -- A code covers the order's dishes, never the delivery fee (or a combo; these orders have none).
  for o in select id, mode, subtotal_kes, row_number() over (order by created_at) n from public.orders loop
    if o.n % 5 = 0 then
      update public.orders set discount_code_id = (select id from public.discount_codes where code = 'KARIBU10'), discount_code = 'KARIBU10',
        discount_kes = least(300, o.subtotal_kes / 10), total_kes = total_kes - least(300, o.subtotal_kes / 10) where id = o.id;
    elsif o.n % 7 = 0 and o.mode <> 'delivery' then
      update public.orders set discount_code_id = (select id from public.discount_codes where code = 'PICKUP50'), discount_code = 'PICKUP50',
        discount_kes = least(50, o.subtotal_kes), total_kes = total_kes - least(50, o.subtotal_kes) where id = o.id;
    end if;
  end loop;

  insert into public.combos (name, price_kes) values ('Stew & chai lunch', 500) returning id into v_combo;
  insert into public.combo_items (combo_id, dish_id, quantity, sort_order)
    select v_combo, d.id, 1, case when d.name = 'Masala chai' then 1 else 0 end
    from public.dishes d where d.name in ('Beef Stew & Chapati', 'Masala chai');
  for o in select id, row_number() over (order by created_at) n from public.orders where discount_code_id is null loop
    if o.n % 6 = 0 then
      insert into public.order_combos (order_id, combo_id, name, unit_price_kes, quantity)
        values (o.id, v_combo, 'Stew & chai lunch', 500, 1) returning id into v_oc;
      insert into public.order_items (order_id, order_combo_id, dish_id, name, unit_price_kes, quantity)
        select o.id, v_oc, d.id, d.name, 0, 1 from public.dishes d where d.name in ('Beef Stew & Chapati', 'Masala chai');
      update public.orders set subtotal_kes = subtotal_kes + 500, total_kes = total_kes + 500 where id = o.id;
    end if;
  end loop;

  insert into public.ads (advertiser, line, place, link_label, link_url, space, starts_on, ends_on, fee_kes, fee_period, approved_at)
    values ('Sunrise Bakery', 'Fresh bread every morning', 'Next door', 'See today’s bread', 'https://sunrise.example/bread',
            'menu', v_today - 40, v_today - 15, 2000, 'month', now() - interval '41 days')
    returning id into v_menu_ad;
  insert into public.ads (advertiser, line, place, link_label, link_url, space, starts_on, ends_on, fee_kes, fee_period, approved_at)
    values ('Mama Mboga Greens', 'Sukuma and spinach, picked today', 'Two doors down', 'Order greens', 'https://mboga.example',
            'order', v_today - 14, v_today + 16, 500, 'week', now() - interval '15 days')
    returning id into v_order_ad;
  insert into public.ad_daily_counts (ad_id, day, views, taps)
    select v_menu_ad, d, 20 + abs(hashtext(d::text)) % 40, abs(hashtext(d::text || 't')) % 5
    from generate_series(v_today - 40, v_today - 15, interval '1 day') g(d0), lateral (select g.d0::date as d) x;
  insert into public.ad_daily_counts (ad_id, day, views, taps)
    select v_order_ad, d, 10 + abs(hashtext(d::text || 'o')) % 30, abs(hashtext(d::text || 'p')) % 3
    from generate_series(v_today - 14, v_today, interval '1 day') g(d0), lateral (select g.d0::date as d) x;
end $$;

-- Ratings (2.10) for the Reports Ratings tab (spec-2.12 seed: 2 hidden, 3 replied). About one in four
-- completed orders before today is rated, a couple of hours after it was placed (some the next day).
-- Days 14 to 21 ago have none, so "Ratings by week" shows a gap. The dishes' public totals are then
-- counted from the not-hidden ratings, as the rating RPCs would have left them.
do $$ begin if coalesce(current_setting('dausis.skip_report_seed', true), '') = 'on' then return; end if;
insert into public.order_ratings (order_id, stars, comment, created_at, hidden_at, reply, replied_at)
select o.id,
  (array[5, 4, 5, 3, 5, 4, 2, 5, 4, 5, 1, 4])[1 + o.n % 12],
  case o.n % 12
    when 0 then 'The pilau was just like home. Thank you Mama!'
    when 3 then 'Good food but it took a while to come out.'
    when 6 then 'Chapati was a bit hard today.'
    when 8 then 'Best kienyeji chicken in town, generous plate too.'
    when 10 then 'Cold when it reached me. Not happy.'
    when 11 then 'Nice.'
  end,
  o.created_at + case when o.n % 5 = 0 then interval '20 hours' else interval '2 hours' end,
  case when o.n in (22) then o.created_at + interval '1 day' end,
  case when o.n in (27, 30) then 'Thank you for telling us. We have spoken to the kitchen and it won''t happen again.' end,
  case when o.n in (27, 30) then o.created_at + interval '26 hours' end
from (
  select o.*, row_number() over (order by o.created_at) as n
  from public.orders o
  where o.status = 'completed' and (o.created_at at time zone 'Africa/Nairobi')::date < public.nairobi_today()
    and (o.created_at at time zone 'Africa/Nairobi')::date not between public.nairobi_today() - 21 and public.nairobi_today() - 14
) o
where o.n % 4 <> 1
on conflict do nothing;
-- One of each in the latest comments, so Reports' Recent comments shows the Hidden pill and a reply.
update public.order_ratings set hidden_at = created_at + interval '3 hours'
where order_id = (select order_id from public.order_ratings where stars = 1 and comment is not null and hidden_at is null order by created_at desc limit 1);
update public.order_ratings set reply = 'Sorry it took long. Saturdays are busy, we are adding a cook.', replied_at = created_at + interval '4 hours'
where order_id = (select order_id from public.order_ratings where stars = 3 and comment is not null and reply is null order by created_at desc limit 1);
update public.dishes d set rating_count = coalesce(t.n, 0), rating_total = coalesce(t.s, 0)
from (select dd.id, x.n, x.s from public.dishes dd left join (
        select i.dish_id, count(*) as n, sum(r.stars) as s
        from public.order_ratings r join (select distinct order_id, dish_id from public.order_items) i on i.order_id = r.order_id
        where r.hidden_at is null group by 1) x on x.dish_id = dd.id) t
where t.id = d.id;
end $$;
