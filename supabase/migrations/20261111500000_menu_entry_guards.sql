-- Review wave 2a fixes (docs/review/launch/review-wave-2a.md, brief docs/plans/launch/fix-wave-2a.md).
--   * RW2A-01: a menu entry's dish never changes (spec-2.5: "the dish itself can't be changed").
--     Refused for every role and path, so a special price can't be moved onto another dish. Moving
--     a dish means removing the entry and adding a new one.
--   * RW2A-02: the one-dish-once-a-day check is serialized per dish. Two transactions adding the
--     same dish for the same day (a day entry and a week entry, through the planner or straight
--     into the table) can no longer both commit: the second waits for the first, then sees it.

-- ───────────────────────── RW2A-01: the dish is fixed ─────────────────────────
create function public.menu_entry_dish_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.dish_id is distinct from old.dish_id then
    raise exception 'A menu entry’s dish can’t change. Remove it and add the dish again.'
      using errcode = '42501', detail = 'entry_dish_fixed';
  end if;
  return new;
end $$;
revoke all on function public.menu_entry_dish_fixed() from public, anon, authenticated;
create trigger menu_entries_dish_fixed
  before update of dish_id on public.menu_entries
  for each row execute function public.menu_entry_dish_fixed();

-- ───────────────────────── RW2A-02: serialize the clash check ─────────────────────────
-- As 20261110000000, plus a transaction-level advisory lock on the dish before looking for
-- overlaps. The lock is held to commit, and the clash query runs after it is granted, so under
-- READ COMMITTED (PostgREST's default) it sees any entry for the dish committed meanwhile.
create or replace function public.one_dish_once_a_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_dish uuid;
  v record;
begin
  if tg_table_name = 'menu_entries' then
    v_id := new.id;
    v_dish := new.dish_id;
  else
    v_id := old.entry_id;
    select dish_id into v_dish from public.menu_entries where id = v_id;
    if v_dish is null then return null; end if; -- the entry went with its days off
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dausis.menu_dish:' || v_dish::text, 0));
  select * into v from public.entry_clash(v_id);
  if v.clash_day is not null then
    perform public.raise_clash(v_dish, v.clash_day, v.other_kind);
  end if;
  return null;
end $$;
revoke all on function public.one_dish_once_a_day() from public, anon, authenticated;

-- dish_id joins the columns that fire the check. The guard above already refuses the change; this
-- keeps the clash check honest if that rule is ever relaxed.
drop trigger menu_entries_once_a_day on public.menu_entries;
create constraint trigger menu_entries_once_a_day
  after insert or update of dish_id, starts_on, ends_on, published, ended_early_at on public.menu_entries
  deferrable initially deferred
  for each row execute function public.one_dish_once_a_day();
