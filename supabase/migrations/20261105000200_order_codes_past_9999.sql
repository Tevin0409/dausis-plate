-- lpad() cuts to its length, so order 10000 became DP-1000 and collided in print with
-- order 1000. Codes below 10,000 keep their format; from there the number is written in full.
-- Drop and add rather than SET EXPRESSION, which needs Postgres 17. Stored values are rebuilt
-- from `number`, so existing codes stay the same. Functions read the column by name at run time.

alter table public.orders drop column code;
alter table public.orders add column code text generated always as (
  'DP-' || case when number < 10000 then lpad(number::text, 4, '0') else number::text end
) stored;
