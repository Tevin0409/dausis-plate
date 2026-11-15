-- Preflight for migration 20261117000600_ad_price.sql (read-only). Run it against the target
-- database (staging, then production) BEFORE that migration, and keep its output with the go-live notes:
--   psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -f supabase/preflight/ad-price.sql
-- It reads only columns that exist before the migration and runs in a read-only transaction that is
-- rolled back; nothing is written.
--
-- The migration replaces an ad's weekly or monthly fee with one agreed price per run, and an approved
-- ad (scheduled, live, paused or ended) must have that price. Before the migration no ad has one,
-- so the migration STOPS if any ad was ever approved, naming them.
-- No rows = safe to apply. Any rows = each run's price is Tevin's decision (orch.lead asks). The old
-- fee is shown for reference only; it is not the run price and is never converted automatically.
-- Drafts (never approved) are not listed: they may wait for a price.

begin transaction read only;

select a.id, a.advertiser, a.space, a.starts_on, a.ends_on,
       case when a.ended_early_at is not null or a.ends_on < (now() at time zone 'Africa/Nairobi')::date
            then 'ended' else 'approved' end as state,
       a.fee_kes, a.fee_period, a.approved_at
from public.ads a
where a.approved_at is not null
order by a.starts_on, a.advertiser;

rollback;
