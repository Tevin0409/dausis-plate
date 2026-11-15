# 2.12 fix round (RQA212-01 to 04): report (dev.implementor)

*2026-11-14. Brief `docs/plans/launch/fix-2.12.md`; findings `docs/review/launch/qa-2.12-reports.md` (main checkout). Worktree `../dausis-plate-worktrees/builder-2.12-reports`, branch `feature/reports`, uncommitted, ready for the smoke re-test. Browser proof used slot 0 on port 3020 while 2.8 was waiting on QA. Slot 0 was then reset back to the 2.8 worktree, with the kitchen phone set again.*

## Changes
| Finding | File | What |
|---|---|---|
| **RQA212-01** (medium) | `src/app/dashboard/reports/page.tsx` (`Tiles`, `figureEm`) | Each tile is now a size container (`@container`), and the money figure is `whitespace-nowrap`. The figure keeps its size step by length (30/26/24/22, as before), set through `--fig`. Its size is then capped at `min(var(--fig), 100/figureEm(text) cqi)`. `figureEm` is the figure's exact width in em: "KSh " is 1.969em, plus each glyph's measured width, with 1% spare. In the browser the width proved linear, with no kerning, across 760 amounts. The result: where the step already fits, it is used unchanged; a figure that doesn't fit shrinks just enough. It never wraps and never spills. |
| **RQA212-02** (low) | `src/lib/reports/csv.ts`, `tests/unit/report-csv.test.ts` | The formula guard also tests the text after leading whitespace (`v.replace(/^\s+/, "")`), so `" =1+2"`, `"\t=cmd…"`, `"  +254700"`, `" \t@sum"` and `"\n-1"` all get the leading `'`. `"  plain"` is left alone. One new unit test. |
| **RQA212-03** (low) | none (finding only) | Not hard-coded. The middleware redirects with `request.nextUrl.clone()`. No `localhost` appears in `src/middleware.ts` or the export route. In `next dev`, Next builds `nextUrl` from its own dev hostname and ignores the Host header: `curl http://127.0.0.1:3020/dashboard` (Host `127.0.0.1:3020`) answers `307 http://localhost:3020/login?next=…`, even though the server runs with `-H 127.0.0.1`. That applies to every signed-out `/dashboard` route, not only the export. On Vercel, `nextUrl` carries the real host. So it is only the dev origin setting, and nothing was changed. |
| **RQA212-04** (low) | `src/lib/reports/rank.ts` (new), `src/components/reports/sections.tsx`, `tests/unit/report-rank.test.ts` (new) | The ranking moved out of the component into `rankDishes`. Best is sorted by per day, then dish name (`localeCompare(…, "en")`), then id, so the order never depends on the database. Slowest takes only dishes that sold **less** per day than the last Best dish, so equal scores never sit on both sides. It shows lowest first, up to 5, ties by name. In QA's month (four dishes level at 1.6 across the cut), Best ends with Beef Stew & Chapati and Biryani; Ugali and Chapati (2) are in neither list; Slowest shows only the dish below 1.6. When everything is level, Slowest shows its existing empty line, "Not enough dishes to rank a slowest list." Four unit tests: QA's case, input order doesn't matter, the 5 limit with lowest first and ties by name, and all level. |

## Proof for RQA212-01 (browser, `/dashboard/reports`, Today)
For the worst case, I set seed orders so that Money in = **KSh 10,058,479**, Still to collect = **KSh 9,999,999**, Sales = KSh 20,057,198 and Average = KSh 2,507,150. These were set directly in the local database with triggers off, then put back. Each cell below shows the figure size in px; every figure fits its tile, and the page never scrolls sideways.

| Width | Sales | Money in 10,058,479 | Still to collect 9,999,999 | Average |
|---|---|---|---|---|
| 320 | 24 | 15.8 | 16.4 | 17.1 |
| **375** | 24 | **20.0** | **20.7** | 21.7 |
| 600 | 22 | 22 | 22.8 | 24 |
| 768 | 24 | 24 | 24 | 24 |
| 1024 | 19.9 | 19.9 | 20.6 | 21.6 |
| 1280 | 22 | 22 | 22 | 22 |

- **Normal seed data** (KSh 6,980 / 6,280 / 1,980 / 873): exact steps at every width from 375 up (30, and 26 at 1024 and up), the same as before the fix.
- **Normal data at 320:** shrinks to fit (23.8 to 29.5). Before the fix, "KSh 6,280" at 30 px spilled out of a 104 px tile.
- **Before the fix:** the same worst case overflowed at 320, 375, 600 and 1024 (scrollWidth larger than clientWidth, e.g. 157 vs 132 px at 375), and the page scrolled sideways at 320.
- **Contact sheet:** `/private/tmp/claude-503/-Users-tevin-Developer-cash-dausis-plate/41018164-7d53-454e-ba38-33aac3fef038/scratchpad/shots/sheet-fix212.png` (worst and demo, at 375 and 320).

## Checks
- `bun run typecheck`, `bun run lint`, `bun run build`: pass (`/tmp/dev-implementor-fix212-{typecheck,lint,build}.log`).
- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/dausis_test bun run test`: **312 pass, 1 fail** (`/tmp/dev-implementor-fix212-test.log`).
  - The failure is `tests/db/history.test.ts` › "settings: … close early, reopen; closed dates", which raises "The kitchen is already closed for today". The run was at 23:23 Nairobi time, after closing.
  - The test calls `close_early()` against the real clock, so it fails late in the evening whatever the code. This round touched neither that test nor any migration.
  - Running the file on its own gives the same result (`/tmp/dev-implementor-fix212-history.log`). It should pass in a daytime run. **Flagging it as a time-of-day fragile test**; not fixed here (outside the brief).
- New unit tests: `bun test tests/unit/report-rank.test.ts tests/unit/report-csv.test.ts`, **12 pass**.

## Notes
- **Not changed (outside this round):** at 320 the Cancelled tile's "0 orders" (30 px, words, not a money figure) wraps onto two lines. If the same "never wraps" rule should cover it, it is the same `@container` cap with a word-width bound. That is a question for dev.designer.
- `GLYPH_EM` is tied to the display face, so remeasure it if the font changes. The comment says so. An unknown glyph counts as 0.6em, which is wider than any measured one.
- Motion: none added or changed.

Skills used: break-ui — worst-case amounts (8-digit, 7-digit, negative glyph in the table, 320 to 1280) at the data boundary; it found the overflow at 320, 600 and 1024 as well as 375, and that is now fixed; mobile-native — no new inputs or touch targets; the figure uses nowrap and a container-width cap, with no sideways scroll at 320 or 375; impeccable audit (responsive, tile only) — figures keep their type steps wherever they fit; the one finding left is the Cancelled tile wrap at 320, noted above.

## Follow-up: `sold_out_at` by trigger, not by `place_order` (orch.lead 20:40Z), 2026-11-15
Migrations run by timestamp, so 2.12's copy of `place_order` (20261116) would always run last and overwrite the `place_order` bodies from 2.6, 2.8 and 2.11. This slice no longer redefines `place_order`.

| File | What |
|---|---|
| `supabase/migrations/20261116000000_reports.sql` | The whole `create or replace function public.place_order` block is removed. In its place is `menu_entry_days_sold_out_at()`, a `before insert or update of plates_sold` trigger on `menu_entry_days`. When the entry has a plate limit and `plates_sold` reaches it, the trigger sets `sold_out_at := coalesce(sold_out_at, now())`. The first time that day is kept, and giving plates back (a cancel) never clears it. It runs `security definer` with `search_path = ''`, and execute is revoked from public, anon and authenticated. `set_entry_sold_out` (the manual switch) is unchanged. The whole migration no longer mentions `place_order`, so whichever `place_order` runs last (2.11's) keeps this behaviour. |
| `tests/db/reports.test.ts` | Two new tests. (1) The trigger exists, and `place_order`'s source no longer contains `sold_out_at`. Straight writes to the table: 2 of 3 leaves it null, 3 of 3 sets it; back to 1, then up to 3 again, keeps the first time; an entry with no limit at 500 stays null. (2) Through `place_order`: 2 plates, then the last 1 sets it. Cancelling the last order gives the plate back (3 → 2) and keeps the time. The existing "set by the last plate" test still passes, unchanged. |

**Checks:**
- `DEV_STACK_REPO=<this worktree> $D reset`: done. **The stack is now on the 2.12 schema.**
- `bun run test` (rebuilds `dausis_test` from this worktree): **316 pass, 3 skip, 0 fail** (`/tmp/dev-implementor-212trig-test.log`). The 3 skips are time-gated opening-hours tests.
- **Control:** with the trigger dropped on `dausis_test`, all three `sold_out_at` tests fail (17 pass, 3 fail; `/tmp/dev-implementor-212trig-control.log`). `dausis_test` was rebuilt afterwards.
- typecheck, lint, build: pass (`/tmp/dev-implementor-212trig-{typecheck,lint,build}.log`).
- No app code changed; the Reports screen reads `sold_out_at` as before.

**Notes:**
- The trigger catches any write to `plates_sold`, whichever `place_order` makes it. A future `place_order` only has to keep counting plates in `menu_entry_days.plates_sold`, which every version since `init` does.
- Not changed: `sold_out_at` still has one time per day row. Going over the limit and back under it doesn't record a second time, same as before.
