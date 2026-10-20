-- Tighten function exposure, simplify RLS (one policy per action), index foreign keys.

-- ───────── function privileges ─────────
-- Staff-only RPCs: signed-in users only (they also check is_staff() inside).
revoke execute on function public.copy_menu_day(date, date) from public, anon;
revoke execute on function public.set_entry_sold_out(uuid, boolean) from public, anon;
revoke execute on function public.dashboard_stats(date) from public, anon;
-- Trigger function: never called through the API.
revoke execute on function public.release_plates_on_cancel() from public, anon, authenticated;
-- Customer RPCs stay public on purpose: place_order, get_order_status, resolve_table.
-- is_staff / is_owner stay executable because RLS policies call them for every role;
-- they only reveal whether the caller themself is staff.

-- ───────── policies: one permissive policy per role/action ─────────
drop policy staff_read_self on public.staff;
drop policy staff_owner_write on public.staff;
create policy staff_select on public.staff for select
  using (user_id = (select auth.uid()) or (select public.is_owner()));
create policy staff_insert on public.staff for insert with check ((select public.is_owner()));
create policy staff_update on public.staff for update using ((select public.is_owner())) with check ((select public.is_owner()));
create policy staff_delete on public.staff for delete using ((select public.is_owner()));

drop policy dishes_public_read on public.dishes;
drop policy dishes_staff_write on public.dishes;
create policy dishes_select on public.dishes for select using (not archived or (select public.is_staff()));
create policy dishes_insert on public.dishes for insert with check ((select public.is_staff()));
create policy dishes_update on public.dishes for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy dishes_delete on public.dishes for delete using ((select public.is_staff()));

drop policy options_public_read on public.dish_options;
drop policy options_staff_write on public.dish_options;
create policy options_select on public.dish_options for select using (true);
create policy options_insert on public.dish_options for insert with check ((select public.is_staff()));
create policy options_update on public.dish_options for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy options_delete on public.dish_options for delete using ((select public.is_staff()));

drop policy entries_public_read on public.menu_entries;
drop policy entries_staff_write on public.menu_entries;
create policy entries_select on public.menu_entries for select using (published or (select public.is_staff()));
create policy entries_insert on public.menu_entries for insert with check ((select public.is_staff()));
create policy entries_update on public.menu_entries for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy entries_delete on public.menu_entries for delete using ((select public.is_staff()));

drop policy entry_days_public_read on public.menu_entry_days;
drop policy entry_days_staff_write on public.menu_entry_days;
create policy entry_days_select on public.menu_entry_days for select using (true);
create policy entry_days_insert on public.menu_entry_days for insert with check ((select public.is_staff()));
create policy entry_days_update on public.menu_entry_days for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy entry_days_delete on public.menu_entry_days for delete using ((select public.is_staff()));

drop policy tables_staff on public.dining_tables;
create policy tables_staff on public.dining_tables for all using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy zones_public_read on public.delivery_zones;
drop policy zones_staff_write on public.delivery_zones;
create policy zones_select on public.delivery_zones for select using (active or (select public.is_staff()));
create policy zones_insert on public.delivery_zones for insert with check ((select public.is_staff()));
create policy zones_update on public.delivery_zones for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy zones_delete on public.delivery_zones for delete using ((select public.is_staff()));

drop policy orders_staff on public.orders;
create policy orders_staff on public.orders for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy order_items_staff on public.order_items;
create policy order_items_staff on public.order_items for all using ((select public.is_staff())) with check ((select public.is_staff()));

-- ───────── foreign key indexes ─────────
create index menu_entries_dish_idx on public.menu_entries (dish_id);
create index order_items_dish_idx on public.order_items (dish_id);
create index order_items_entry_idx on public.order_items (menu_entry_id);
create index order_items_option_idx on public.order_items (option_id);
create index orders_zone_idx on public.orders (delivery_zone_id);
create index orders_table_idx on public.orders (table_id);
