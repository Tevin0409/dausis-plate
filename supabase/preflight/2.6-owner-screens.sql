-- Preflight for slice 2.6 (20261111000000_owner_screens.sql). READ-ONLY: run it against the target
-- database (staging, then production) BEFORE that migration, and keep its output with the go-live
-- notes. It runs in a read-only transaction that is rolled back; nothing is written.
--   psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -f supabase/preflight/2.6-owner-screens.sql
-- It reads only tables and columns that exist before 2.6.
--
-- Checks 1-4 list rows the migration REFUSES: any row there makes the migration fail. Don't clamp,
-- change or delete them here; each one is a decision for Tevin (orch.lead asks), then a fix.
--   1. delivery_zones_fee_limit       fee_kes between 0 and 5000
--   2. dish_options_price_limit       price_delta_kes between 0 and 2000
--   3. dish_options_label_once        unique (dish_id, lower(btrim(label))) where not archived
--   4. dish_options_one_default       unique (dish_id) where is_default, not archived, kind 'choice'
-- The migration's other new rules can't fail on existing rows: min_order_kes, kind, archived,
-- out_on, kitchen_settings.phone and the staff columns are new columns with passing defaults, and
-- the extra-only checks apply to kind 'extra', which no existing row has (all become 'choice').
-- Checks 5-7 don't stop the migration; they list rows that behave differently after it.
-- Checks 8-9 are privileges the 2.6 functions need on the hosted project. Those functions arrive
-- with the migration, so before it they show null; run 8-9 again right after it.

begin transaction read only;

-- 1. A delivery fee over KSh 5,000 (new check: fee 0–5,000).
select z.id, z.name, z.fee_kes, z.active
from public.delivery_zones z
where z.fee_kes not between 0 and 5000
order by z.name;

-- 2. An option price outside 0–2,000 (new check).
select d.name as dish, o.id, o.label, o.price_delta_kes
from public.dish_options o join public.dishes d on d.id = o.dish_id
where o.price_delta_kes not between 0 and 2000
order by d.name, o.sort_order;

-- 3. Two options of one dish with the same label, ignoring case and spaces (new unique index).
select d.name as dish, lower(btrim(o.label)) as label, count(*) as how_many, array_agg(o.id) as ids
from public.dish_options o join public.dishes d on d.id = o.dish_id
group by d.name, o.dish_id, lower(btrim(o.label))
having count(*) > 1
order by d.name;

-- 4. A dish with more than one default option (new unique index: one default per dish).
select d.name as dish, count(*) as defaults, array_agg(o.label order by o.sort_order) as labels
from public.dish_options o join public.dishes d on d.id = o.dish_id
where o.is_default
group by d.name, o.dish_id
having count(*) > 1
order by d.name;

-- 5. A dish with exactly one option. Every existing option becomes a choice, and after 2.6 a dish
--    with choices can't be ordered without one, so customers must pick this single choice; the
--    editor also refuses to save a single choice. Mama turns it into an extra, adds a second
--    choice or removes it.
select d.name as dish, d.archived, o.label, o.price_delta_kes
from public.dish_options o join public.dishes d on d.id = o.dish_id
where (select count(*) from public.dish_options x where x.dish_id = o.dish_id) = 1
order by d.name;

-- 6. Option labels over 40 characters: kept, but the editor refuses to save the dish until shortened.
select d.name as dish, o.label, char_length(o.label) as length
from public.dish_options o join public.dishes d on d.id = o.dish_id
where char_length(btrim(o.label)) > 40
order by d.name;

-- 7. Zones as they will start: every minimum is 0 ("No minimum") until Mama sets one.
select z.name, z.fee_kes, z.active
from public.delivery_zones z
order by z.sort_order, z.name;

-- 8. Remove and Reset end the person's sessions at once through public.end_sessions, which deletes
--    from auth.sessions and auth.refresh_tokens as the function owner. Confirm the owner may do that
--    on the hosted project (expect two rows, both true; null means the table is missing). If not, Remove still takes them off the team,
--    but an open dashboard stays signed in until its token expires.
select t, case when to_regclass(t) is null then null else has_table_privilege(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.proname = 'team_remove' limit 1), t, 'DELETE') end as can_delete
from unnest(array['auth.sessions', 'auth.refresh_tokens']) t;

-- 9. The owner of clear_must_change_password can read auth.users.encrypted_password (expect true).
--    If false, nobody can finish a forced password change (the clear fails safe), so fix before launch.
select has_column_privilege(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.proname = 'clear_must_change_password' limit 1),
  'auth.users', 'encrypted_password', 'SELECT') as can_read_password_hash;

rollback;
