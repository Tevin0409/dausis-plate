# Fix round, review wave 2a (RW2A-01 to 03): report (dev.implementor)

*2026-11-14. Brief `docs/plans/launch/fix-wave-2a.md`; findings `docs/review/launch/review-wave-2a.md` (main checkout). Branch `fix/menu-entry-guards` from `1d7bee1`, worktree `../dausis-plate-worktrees/dev-implementor-fix-wave-2a`, slot 0. Uncommitted, for review.r1's re-check.*

## Changes
| File | What |
|---|---|
| `supabase/migrations/20261111500000_menu_entry_guards.sql` (new) | **RW2A-01:** `menu_entries_dish_fixed` before-update trigger refuses any `dish_id` change, for every role and path (42501, detail `entry_dish_fixed`, "A menu entry’s dish can’t change. Remove it and add the dish again."). No planner RPC or later migration (2.8, 2.12 checked) updates `dish_id`. **RW2A-02:** `one_dish_once_a_day` replaced: takes `pg_advisory_xact_lock` on the dish before `entry_clash`, so the second writer waits and then sees the first one's committed row. The constraint trigger is recreated with `dish_id` among its columns. |
| `tests/db/menu-entry-guards.test.ts` (new) | Staff without Dishes and prices (no jobs, and Everyday menu) can't move a KSh 10 week entry onto a KSh 900 dish; owner and database owner refused too; same-dish no-op update and other columns still save; single-connection day + week clash still refused. |
| `scripts/check-menu-entry-race.ts` (new) | Two-connection proof, outside the rollback harness (like 2.12's counter check): as the owner, straight into the table, one connection adds a day entry and the other a week entry for the same dish today. Round 1: immediate check, 2 s held, second starts 300 ms later (the review's probe). Round 2: deferred, both commit at the same moment. Each round must give exactly one commit and one `23505` clash. Cleans up after itself. |
| `supabase/preflight/2.6-owner-screens.sql` (new) | **RW2A-03:** read-only preflight (runs in `begin transaction read only` … `rollback`), from the 2.6 go-live check: 1 fee outside 0–5,000; 2 option price outside 0–2,000; 3 duplicate normalised labels; 4 more than one default; 5–7 rows that behave differently after; 8–9 privileges (null before the migration, rerun after). The header lists every rule the migration adds and why the rest can't fail on existing rows. |
| `supabase/migrations/20261111000000_owner_screens.sql` | Comment only: the go-live line now names `supabase/preflight/2.6-owner-screens.sql` (it named a file that doesn't exist). |

## Checks
- typecheck, lint, build: pass (`/tmp/dev-implementor-fix2a-build.log`).
- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/dausis_test bun run test`: **348 pass, 0 fail** (345 before + 3 new) (`/tmp/dev-implementor-fix2a-test.log`).
- `DEV_STACK_REPO=<this worktree> $D reset`: done; the trigger is on the stack. (Slot 0 was then reset back to the 2.8 worktree for its QA fix round.)
- Race check, run twice: both rounds PASS each time — round 1 the week entry is refused at ~2,025 ms (it waited for the lock); round 2 one of the two simultaneous commits is refused (`/tmp/dev-implementor-fix2a-race1.log`, `race2.log`).
- **Control:** with the 2.5 trigger body (no lock) put back on the throwaway test database, the same script FAILS both rounds (two commits, two rows), as the review found (`/tmp/dev-implementor-fix2a-race-control.log`). The test database was rebuilt afterwards.
- Preflight on a database rebuilt from `origin/staging` (`01ddafd`, 12 migrations + its seed): checks 1–6 return 0 rows (`/tmp/dev-implementor-fix2a-preflight-clean.log`). With bad legacy rows added (an option at −50, a duplicate label " legacy DISCOUNT choice " at 2,500, two defaults on one dish, a zone fee of 6,000), checks 1–4 list each one (`/tmp/dev-implementor-fix2a-preflight-bad.log`).
- Upgrade from that staging rebuild through 2.2–2.6 and this migration: clean data applies all 8; with the −50 option it stops at `20261111000000` on `dish_options_price_limit`, the row check 2 lists. The scratch database was dropped.

## Notes
- The lock is per dish, so writes for different dishes don't wait on each other. One transaction that adds several dishes could deadlock with another adding the same dishes in the other order; Postgres then aborts one with a deadlock error. The planner adds one dish per call, so this isn't reachable from the dashboard.
- The fix relies on READ COMMITTED (PostgREST's default): the clash query takes a fresh snapshot after the lock. A REPEATABLE READ or SERIALIZABLE caller would get a serialization error instead, which still prevents the duplicate.
- **Go-live:** the go-live notes should point at `supabase/preflight/2.6-owner-screens.sql` (orch.lead's docs in the main checkout; I didn't edit them). Run it on staging before 2.6 and keep its output. If checks 1–4 list rows, they go to Tevin; nothing is clamped or deleted.
- 2.8, 2.9 and 2.12 sort after this migration; at integration it merges right after 2.6. 2.8's `customer_flow` migration doesn't touch `one_dish_once_a_day` or `dish_id`.
