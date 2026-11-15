# Fix: a new dish from the planner saves despite an error, making duplicates

*dev.implementor, 2026-11-15. Brief: `docs/plans/launch/fix-planner-new-dish.md`. Worktree `../dausis-plate-worktrees/dev-implementor-fix-planner-new-dish`, branch `fix/planner-new-dish-duplicates` from `origin/main` (feb1bcb), uncommitted. Slot 0, port 3020. Round 1 had no migration; round 2 adds `20261118000000_create_planned_dish.sql`.*

## Root cause (reproduced on the local stack before any change)

Tevin's steps, on `/dashboard/dishes/new?day=2026-11-15` (the planner's "+ New dish"), produced 2 dishes from 2 saves, each with no menu entry. Each save showed "That dish can't be planned."

**The plate size isn't involved.** An empty "Plates a day" means no limit, and the database accepts it (`planner_values`).

**The trigger is the "On the everyday menu" switch:**
- Spec-2.5 keeps everyday dishes out of the planner: `add_menu_entry` refuses a regular dish (`planner_price`, `'That dish can''t be planned.'`).
- Spec-2.6 then put the everyday switch on the same new-dish form that the planner opens.
- Neither spec covered the two together.

**Why it saved anyway, and again on each retry:**
1. `saveDish` inserts the dish first and only then calls `add_menu_entry`, which refuses. The dish is already saved.
2. That error path calls `revalidatePath`. Next refreshes the page, and the page renders `newId={crypto.randomUUID()}` again, so the hidden `new_id` changes. The log showed it change from `2532e288…` to `93fd2b2a…` after one failed save.
3. The retry carries the new id. It no longer collides with the saved dish, so it inserts another one.

The existing duplicate guard (`new_id` plus the 23505 retry path) was right; it was just fed a fresh id on every refresh.

## Tevin's decision (A, qitem-20261115203221-6da086b6, 20:37Z)

A new dish opened from the planner ("+ New dish", "Add to Sunday") doesn't show the "On the everyday menu" switch. Everyday stays a setting on the Dishes screen. Until he answered, I built C (refuse with a message); it is now replaced by A.

## The fix

| Where | What |
|---|---|
| `dish-editor.tsx`, `DishEditor` | Keeps the first `newId` in state (`useState(props.newId)`), so a page refresh after a failed save can't change it. A retry continues from the dish already saved instead of creating a second one. |
| `dish-editor.tsx`, form | The everyday switch isn't offered when `planDay` is set (Tevin's A). The Dishes "Add a dish" form keeps it. |
| `lib/planner.ts` `newDishPlanProblem` | One check, used by both client and server, for what the menu step would refuse that the form can cause: everyday plus a planned day, and serving that ends before it starts. |
| `actions.ts` `saveDish` | Runs that check **before** inserting the dish, so these refusals save nothing. It returns `field`, so the editor shows the line next to the field. The database still checks everything. |
| `actions.ts` `addNewDishToMenu` | A refusal that can only come after the dish saved (the day closed or went past meanwhile) now says so: "Saved Repro Stew, but it isn't on the menu yet: The kitchen is closed that day." Save again continues from that dish. |
| `action-result.ts` | `ActionResult` gains an optional `field`. |
| `dish-editor.tsx`, the times | "Serving must end after it starts." shows under the times and in the save bar. Focus moves to "Until" (`aria-invalid`, `aria-describedby`), and the line scrolls above the sticky save bar. |

**Not fully atomic in round 1, and why (superseded by round 2 below).** The dish, its options and the menu entry are separate calls, and Supabase-js has no transaction. A real single transaction would need a new RPC that also takes the options. Instead:
- refusals the form can cause are checked before anything is saved;
- the one remaining case, a day closed or gone past between page load and Save, says the dish is saved;
- the retry never duplicates.

If QA or review wants full atomicity, it's a migration-sized follow-up.

## Tests (failing first)

`tests/unit/save-dish-plan.test.ts` runs `saveDish` against an in-memory Supabase stand-in. The stand-in keeps the rules the action depends on: dish id unique (23505), and `add_menu_entry` refusing an everyday dish and bad hours.

- **Before the fix:** 4 of 5 failed (log `/tmp/dev-implementor-planner-red.log` at the time):
  - everyday plus planned day saved a dish;
  - three saves saved dishes;
  - bad hours saved a dish;
  - the after-save refusal didn't say "Saved".
- **After the fix:** 5 of 5 pass.
- The test that kept passing: an empty plate limit makes one dish and one entry with `p_plates = null`.

## Browser proof (local stack, 3020, real path)

Scripts: `evidence/verify.sh` (the interim C build) and `evidence/verifyA.sh` (A).

| Path | Result |
|---|---|
| A (final): planner "+ New dish" | 0 switches, no "On the everyday menu" text. Dishes, "Add a dish" (`?regular=1`): 1 switch. |
| A: Tevin's steps without the switch (Rest of the week, from 12:00, no plates) | Saves once and returns to `/dashboard/menu?day=2026-11-15`. DB: 1 dish, `is_regular` false, 1 week entry, `plates_per_day` null, `show_from` 12:00. |
| Bad hours (Until 10:00, From 11:00 or 12:00) | Refused, 0 dishes, focus on Until, line under the times and in the bar. The line sits above the bar: 623 px vs the bar at 638 px at 375; at 1280, 798 vs 819. |
| Refusal after the dish saved (Sunday closed in `opening_hours` after page load, "Sun only") | "Saved Repro Stew, but it isn't on the menu yet: The kitchen is closed that day." `new_id` unchanged. After reopening Sunday, Save again: still **1** dish, now with **1** entry. |
| C (interim, now removed): switch on plus Save 3 times | 0 dishes. |
| 375 × 812 | Document width 375. |

Test rows were deleted afterwards and Sunday reopened (0 left, `is_open` true).

Evidence: `evidence/contact-sheet.png` (C build and the after-save refusal), `evidence/contact-sheet-A.png` (A at 1280 and 375, and the planner after save), plus the single captures.

## "Where's the add section?" (report only, nothing built)

**Where adding lives today:**
- **Planner, per day:** a "+ Day" button ("Add a dish to Sunday"), shown only on today and later days (`planner.tsx:456/508`).
- **Planner, whole week:** "+ Week" at the top right.
- **Panel:** the panel the planner opens has the dish search and, with Dishes and prices, "+ New dish". That opens the dish editor with an "Add to Sunday, 15 November" section: Sun only / Rest of the week, Plates a day, Show from, Until.
- **Dishes screen:** "Add a dish" for the everyday menu and the library.

**Most likely meaning:** Tevin tested on Sunday, the last day of the planner's week.
- The past days (Mon to Sat) show no "+ Day", so the only add points visible were Sunday's small "+ Day" and "+ Week".
- To plan next week he has to press the → arrow first.

So "the add section" most likely means a clear "add a dish to a day" place in the planner, and on a Sunday it is easy to miss. A second reading is the pre-2.5 dish page's "Add to the menu" section. That now appears only on a new dish opened from the planner (spec-2.5 moved it into the planner panel), so it isn't on an existing dish's page.

Worth asking him which one he meant. Both are small to surface; this report doesn't change either.

## Checks

Log: `/tmp/dev-implementor-planner.log`.
- `bun run typecheck`, `bun run lint` and `bun run build` all exit 0.
- `bun run test`: 619 pass, 1 fail.
  - **The failure is not this change.** It's `tests/db/order-safety.test.ts` "place_order: pickup time > accepts a later time", which books a pickup 30 minutes from now. At 23:41 Nairobi that falls after midnight, so `place_order` correctly refuses ("We close at midnight").
  - The test only touches the database, and this branch changes no SQL. It's a time-of-day flake that will pass outside 23:30–00:00 Nairobi; worth fixing separately so the suite doesn't depend on the clock.

No migration, so `$D reset` wasn't needed. The stack was left as found, apart from the deleted test rows.

## Skills used

- **systematic-debugging:** reproduced and found the root cause before any change (regenerated `new_id` plus refuse-after-insert, triggered by the everyday switch, not the plate size).
- **test-driven-development:** 4 failing tests first, then green.
- **impeccable audit, 19/20:** on real screenshots at 375 and 1280.
  - Detector: clean.
  - Fixed: the inline error was hidden under the sticky save bar at both widths, and the hours error was announced twice (`role="alert"` plus the bar's `role="status"`).
  - Theming: tokens only.
  - Touch targets: 44 px or more.
  - No horizontal scroll at 375.
- **mobile-native:** not needed. No new layout or input; the 375 width was checked.
- **animate:** not used; there's no motion. The error line reuses the existing `note-in`.

## Round 2: RQAPN-01, one transaction (2026-11-16)

**The finding.** dev.qa showed that the stable id isn't enough. After a refusal that comes once the dish is saved, a Reload or browser Back renders the form with a new `new_id`, and the next Save makes a second dish.

**Fix at the root.** "Save and add to menu" is now one database call, so a refusal at any step saves nothing. There was no same-name check: whether two dishes may share a name is Tevin's rule.

| Where | What |
|---|---|
| `supabase/migrations/20261118000000_create_planned_dish.sql` | New `create_planned_dish(id, name, description, price, category, photo keys/urls, options, kind, days, from, until, plates) returns uuid`. It inserts the dish (`is_regular` false, Tevin's A), runs `save_dish_options` when there are options, then returns `add_menu_entry(...)`. **Security invoker**, so RLS (`dishes_staff_write`), every `dishes` trigger, `save_dish_options`' owner grant and option checks, and all of `add_menu_entry`'s checks (staff, days, closed day, past, hours, plates, "can't be planned") apply unchanged. It composes the latest definitions and copies none of them. Revoked from public and anon; granted to authenticated. |
| `actions.ts` `saveDish` | The planner path runs the field checks (`newDishPlanProblem`), then `createPlannedDish`: it works out the week's open days from `opening_hours` as before, then makes one rpc and redirects to the planner. A 23505 on `dishes_pkey` (the same form sent again after it saved) counts as saved. Option refusals (P0001 not in `REFUSAL_FIELD`) return their own message; planner refusals go through `plannerFailed` (an hours refusal maps to `show_until`). |
| `actions.ts` | `addNewDishToMenu` and the "Saved X, but it isn't on the menu yet" message are gone. The Dishes screen's "Add a dish" path is unchanged. |
| `database.types.ts` | Hand-added `create_planned_dish` Functions entry (`db:types` needs Docker). |

**Tests first** (red log: `/tmp/dev-implementor-planner-red2.log`, 12 failing before the change).
- **New `tests/db/create-planned-dish.test.ts` (7):**
  - success gives 1 dish (not everyday), 2 options and 1 entry;
  - a closed day (refused after the dish part) gives **0 dishes**;
  - an options refusal gives 0 dishes;
  - bad hours give 0 dishes;
  - a refusal, then a retry with a new id, gives 1 dish and 1 entry;
  - the same id twice is a 23505, still 1 dish;
  - anon gets 42501.
- **`tests/unit/save-dish-plan.test.ts` (now 8):**
  - The fake `create_planned_dish` is all or nothing.
  - Round 1's 5th test asserted the "Saved Repro Stew, but…" state, which the brief removes. It is replaced by "a menu refusal saves nothing and doesn't say Saved".
  - New tests:
    - **Reload/Back then Save gives 1 dish and 1 entry**;
    - the same form sent again after it saved goes to the planner, still 1 dish;
    - the dish, its options and its entry go in one call.
  - The other 4 round-1 tests pass unchanged.

**`$D reset`.** I ran `DEV_STACK_REPO=<this worktree> dev-stack.sh reset`. Without that variable it reads Tevin's main checkout, which lacks this migration. Result: exit 0, no errors, the migration applied. `create_planned_dish` is security invoker (`prosecdef` f); `anon` can't execute it, `authenticated` can. **The shared stack now carries this branch's migrations** (main's plus this one, which only adds a function).

**Browser proof** (375 × 812, real path, 3020). Script: `evidence/verifyR2.sh`. Today (Monday) was closed after the page loaded, so the refusal is real:

| Path | `new_id` | Result |
|---|---|---|
| Refusal | `7f846441…` | "The kitchen is closed that day." DB: 0 dishes, 0 entries. |
| Reopen the day, **Reload**, Save | now `3d5cc1d0…` | Redirects to `/dashboard/menu?day=2026-11-16`. DB: **1 dish, 1 entry**. |
| Refusal | `a6e42bfe…` | Same message. 0 dishes. |
| Reopen the day, **Back** then Forward, Save | now `ba5dd3c9…` | Redirects to the planner. DB: **1 dish, 1 entry**. |

The test rows were deleted afterwards and Monday reopened (0 left, `is_open` true). Capture: `evidence/R2-refusal-375.png`. The error reads as the plain refusal, with no "Saved…" wording.

**Checks.** Logs are in `/tmp/dev-implementor-planner-*.log`.
- `bun run typecheck`, `bun run lint` and `bun run build` all exit 0.
- `bun run test`: **631 pass, 0 fail** (634 tests, 43 files). It ran at 00:08 Nairobi, so the midnight-window test passed this time.

**For review.r1:**
- the migration is a plain composition, security invoker;
- the `dishes_pkey` check in `createPlannedDish` relies on Postgres naming the constraint in the 23505 message;
- `add_menu_entry`'s clash 23505 can't occur for a brand-new dish.

Skills used: systematic-debugging — the root cause (non-atomic steps plus a fresh id per render) confirmed against QA's repro before changing; test-driven-development — 12 red, then 15 green; impeccable audit — refusal state at 375 rechecked: plain message in the save bar, no layout change, no new UI; mobile-native — no new layout, the 375 path rechecked; animate — not used, no motion.

## Round 3: RPN-01, a used id isn't proof of a save (2026-11-16)

**The finding (review.r1).** Round 2 counted any 23505 on `dishes_pkey` as "already saved". Two cases reported success with no menu entry:
- a form carrying another dish's id;
- a replay of a successful form after its entry was removed.

**Fix, in the database, in one place.** The migration `20261118000000_create_planned_dish.sql` is edited in place, since it's still uncommitted and unreleased. The dish insert now catches a unique violation on `dishes_pkey` only; any other constraint is re-raised. It then decides:

| Existing row | Result |
|---|---|
| Same name, not everyday, not archived, **and** a published, not-ended entry of the same kind that covers every requested day (no off day) | Returns that entry's id. A double submit is one save. |
| Same dish, but no such entry any more | P0001 `saved_not_planned`: "Repro Stew is already in the dish library, but it isn't on that day's menu any more. Add it from the planner." |
| Anything else (another dish's id, a name that differs, everyday or archived) | P0001 `stale_form`: "This form is out of date. Reload the page and try again." The other dish is untouched. |

- Because the check sits in the exception handler, two submits racing each other end the same way once the first commits.
- `actions.ts` `createPlannedDish` no longer looks at 23505 at all. These refusals pass through as their message.
- **Success now always means an entry.** If the function returns no entry id, the action reports "Couldn't save the dish. Nothing has changed. Try again." and doesn't redirect.

**Tests first.** The red log is `/tmp/dev-implementor-planner-red3.log`: 5 failing before the change.
- **DB (now 10):**
  - the same form twice returns the same entry, 1 dish;
  - **another dish's id** is refused as `stale_form`, that dish unchanged, 0 entries;
  - **a replay after the entry was removed** is refused as `saved_not_planned`, 0 entries;
  - the same id for a different day isn't counted as saved.
- **Unit (now 11):**
  - another dish's id gives no redirect and the honest error;
  - a replay after removal gives no redirect;
  - no entry returned means no redirect.
  - The stand-in now answers as the function does, so both action-level repros pass through the real code path. The no-entry guard was the failing one.

**Checks.** Logs are in `/tmp/dev-implementor-planner-*3.log`.
- `DEV_STACK_REPO=<worktree> dev-stack.sh reset`: exit 0, 0 errors.
- `bun run typecheck`, `bun run lint` and `bun run build` all exit 0.
- `bun run test`: **637 pass, 0 fail** (640 tests).

**Browser smoke** (375, local stack, 3020):
- `evidence/verifyR3.sh`: a double-click on "Save and add to menu" returns to the planner. DB: **1 dish, 1 entry**.
- `evidence/verifyR2.sh` rerun: a refusal, then Reload or Back, then Save gives 1 dish and 1 entry each time.
- Test rows were deleted afterwards, and the day reopened.

Skills used: systematic-debugging — r1's two repros reproduced as failing DB tests before the change; test-driven-development — 5 red, then 21 green; impeccable audit — no UI change beyond two refusal messages in the existing save bar (plain language, they say what to do next); mobile-native — 375 double-click and reload paths rechecked; animate — not used, no motion.
