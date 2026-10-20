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

insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'day', public.nairobi_today(), public.nairobi_today(), 40, 1 from public.dishes where name = 'Coconut Fish Curry & Pilau';
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'day', public.nairobi_today(), public.nairobi_today(), 20, 2 from public.dishes where name = 'Mukimo & Beef Fry';
insert into public.menu_entries (dish_id, kind, starts_on, ends_on, plates_per_day, sort_order)
select id, 'week', date_trunc('week', public.nairobi_today())::date, (date_trunc('week', public.nairobi_today()) + interval '6 days')::date, 30, 3
from public.dishes where name = 'Matoke & Goat Stew';
