-- Applied to the live project as three steps (fk_indexes, restrict_staff_functions, tune_policies).

-- Foreign key indexes
create index if not exists menu_entries_dish_idx on public.menu_entries (dish_id);
create index if not exists order_items_dish_idx on public.order_items (dish_id);
create index if not exists order_items_entry_idx on public.order_items (menu_entry_id);
create index if not exists order_items_option_idx on public.order_items (option_id);
create index if not exists orders_zone_idx on public.orders (delivery_zone_id);
create index if not exists orders_table_idx on public.orders (table_id);

-- Staff-only RPCs: signed-in users only (they also check is_staff() inside).
-- Customer RPCs (place_order, get_order_status, resolve_table) stay public on purpose.
-- is_staff / is_owner stay executable because RLS policies evaluate them for every role.
revoke execute on function public.copy_menu_day(date, date) from public, anon;
revoke execute on function public.set_entry_sold_out(uuid, boolean) from public, anon;
revoke execute on function public.dashboard_stats(date) from public, anon;
revoke execute on function public.release_plates_on_cancel() from public, anon, authenticated;

-- Policies: write policies apply to signed-in users only; auth calls wrapped in (select …)
-- so Postgres evaluates them once per query instead of once per row.
alter policy staff_read_self on public.staff using (user_id = (select auth.uid()) or (select public.is_owner()));
alter policy staff_owner_write on public.staff to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

alter policy dishes_public_read on public.dishes using (not archived or (select public.is_staff()));
alter policy dishes_staff_write on public.dishes to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy options_staff_write on public.dish_options to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy entries_public_read on public.menu_entries using (published or (select public.is_staff()));
alter policy entries_staff_write on public.menu_entries to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy entry_days_staff_write on public.menu_entry_days to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy tables_staff on public.dining_tables to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy zones_public_read on public.delivery_zones using (active or (select public.is_staff()));
alter policy zones_staff_write on public.delivery_zones to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

alter policy orders_staff on public.orders to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
alter policy order_items_staff on public.order_items to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
