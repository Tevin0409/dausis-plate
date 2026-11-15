-- Preflight for migration 20261116100500_dish_name_length.sql (read-only).
-- That migration adds check (char_length(name) <= 80) on dishes; it fails if any name is longer.
-- No rows = safe to apply. Any rows = shorten those names in the dish editor (Dashboard → Dishes)
-- first, then migrate. Archived dishes count too: the check covers every row.
select id, name, char_length(name) as length, archived
from public.dishes
where char_length(name) > 80
order by char_length(name) desc;
