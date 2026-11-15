-- Preflight for 2.9 (read-only). Run before migration 20261113000100_table_label_length.sql.
-- That migration adds check (char_length(label) <= 40) on dining_tables; it fails if any label is longer.
-- No rows = safe to apply. Any rows = rename those tables (Dashboard → Tables) first, then migrate.
select id, label, char_length(label) as length, active
from public.dining_tables
where char_length(label) > 40
order by char_length(label) desc;
