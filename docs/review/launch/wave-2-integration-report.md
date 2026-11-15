# Wave 2 integration, step 2: report (dev.designer)

Brief: `docs/plans/launch/fix-wave-2b.md` (main checkout), step 2. Review: `docs/review/launch/review-wave-2b.md`.
Worktree `../dausis-plate-worktrees/dev-designer-wave-2-integration`, branch `chore/wave-2-integration` from `1d7bee1`.

## Merges (committed, Tevin as author)

| Commit | Merge |
|---|---|
| 9a5d687 | fix/menu-entry-guards |
| ccb762f | feature/customer-flow (2.8) |
| 4cca19a | feature/table-requests (2.9) |
| 1a62365 | feature/reports (2.12) |

Each merge commit's body lists how its conflicts were resolved. 2.6's reduced-motion press fix is intact in `globals.css`. After the merges and before any fix: 491 pass, 3 skip, 12 fail, the failures the review named.

## Fixes (uncommitted, for review.r1's re-check)

### RW2B-01: get_order_status composed
- `supabase/migrations/20261116100000_compose_order_status.sql`: 2.8's full payload plus 2.9's `placed_today` and `requests`. That covers the kitchen phone, address and maps link, the delivery address and notes, and each item's note and extras.
  - The signature, `security definer`, `search_path` and the token-only filter are unchanged.
  - `create or replace` keeps init's grant.
- `tests/db/order-status-contract.test.ts`: asserts the exact key set for dine-in and delivery orders, every 2.8 field, each item's note and extras, and `requests` (empty, then a bill request, as times only).
  - It also checks that an unknown token returns null and that anon still has execute on a security-definer function.
  - Because it asserts the exact key set, a later migration that redefines the function from an older base fails it.

### RW2B-02: the bill's Mark all paid records the method
- `supabase/migrations/20261116100100_bill_paid_with.sql`: drops `mark_orders_paid(uuid[])` and adds `mark_orders_paid(uuid[], paid_with)`, which calls 2.12's `mark_order_paid(uuid, paid_with)` for each order.
  - It refuses card or no method before locking any row.
  - It is still one transaction: one refusal (for example, an order cancelled meanwhile) marks none.
  - `unmark_orders_paid` is unchanged. Through 2.12's `unmark_order_paid` it clears `paid_with`, and its Undo is still all or none.
- `markAllPaid(ids, paidWith)` in `src/app/dashboard/actions.ts`: a cancelled order's refusal names the order and says "Nothing has changed." `database.types.ts` is updated.
- UI (`src/components/dashboard/table-requests.tsx`):
  - "Mark all N paid" with two buttons, **All paid cash** and **All paid M-Pesa**: the board's choice, for the whole bill.
  - The notice reads "3 orders marked paid, M-Pesa." with the same Undo. The per-order Paid cash / Paid M-Pesa buttons stay, so a split bill is still recorded order by order.
  - No new questions for Tevin: nothing beyond one method per tap was needed.
- Layout fix from the merge: 2.12's two per-order buttons sat in the bill row's right column and squeezed the customer name to about 70 px at 375 (a name broke every few letters). Each order's buttons now share a full-width line with its time and wrap under it on a phone.
  - The two bill buttons sit side by side when both labels fit and stack at 320, so a label never wraps inside a pill.
- Tests (`tests/db/table-requests.test.ts`): the bill tests now use the final schema.
  - Methods are recorded per order and cleared by the group Undo.
  - Reports' `report_sales` M-Pesa total for today rises by the bill and returns to the earlier total after Undo.
  - A split bill: one order cash, the rest M-Pesa, with both totals right.
  - Card or no method is refused; a cancelled order marks none.
  - anon is refused; only one `mark_orders_paid` exists.
- Browser, on slot 1 with three orders on Table 1 asking for the bill:
  - All paid M-Pesa: all three rows in the database read paid / mpesa.
  - All paid cash, then Undo straight away: all three went back to unpaid with no method, and "3 orders not paid yet." showed.
  - Undo tapped after the window closed: the orders stayed paid, as designed.

### RW2B-03: sold-out days count a day that came back on
- `supabase/migrations/20261116100200_sold_out_days.sql`: `report_dishes` again, with one change.
  - A day counts as sold out if `sold_out_at` is set (kept after a switch back on, or after a cancel gave plates back), or, as a fallback for older rows with no time, if the dish is out now.
  - The usual sold-out time uses the same set.
- Regressions (`tests/db/reports.test.ts`, "report_dishes: sold-out days and the usual time"):
  - switched off then back on: the day counts, at the time it went off;
  - the last plate, then a cancel that gives one back: the day counts;
  - an older row with no time counts while it is out, with no usual time, and doesn't count once given back.

### RW2B-04: planner tests on Sundays
- In `tests/db/menu-planner.test.ts`, `dates()` deletes menu rows dated after today inside the test's transaction (rolled back afterwards) before any planner fixture is made. On a Sunday, seed.sql's tomorrow entry is the planner's Monday.
- The seed itself is unchanged, because the 2.8 tests use the tomorrow entry. Today is a Sunday in Nairobi, and the 6 planner failures are gone.

## Checks (06:47 Nairobi, Sunday 15 Nov)
- `$D reset` on slot 1 from this worktree: OK (27 migrations plus seed).
- `bun run typecheck`, `bun run lint` and `bun run build`: pass (build run with the dev server stopped).
- Full suite, `TEST_DATABASE_URL` on slot 1: **516 pass, 0 fail.** Before the fixes it was 491 pass, 3 skip, 12 fail.
  - No skips. The 3 earlier skips were opening-hours tests that run only between 01:01 and 22:59 Nairobi (`tests/db/opening-hours.test.ts:251`). The baseline ran after midnight; this run was at 06:47, so they ran and passed.
- Evidence: `docs/review/launch/evidence-wave-2-integration/contact-sheet.png`. It shows:
  - 375, unpaid (KSh 99,999 orders);
  - 375, after All paid M-Pesa, with the notice;
  - 375 at 200% text;
  - 320, stacked buttons;
  - 1280.
- Not verified: Realtime. The bill list re-fetches after each action, and the board's poll covers the rest.

## Step 3 (next)
feature/ratings is committed (695753d). Step 3 merges it and rebuilds 2.10's get_order_status on the composed one, in a migration after 20261116100200. The contract test then gains the rating fields. That waits for review.r1's re-check of this step.

---

# Step 3: 2.10 ratings on the combined branch

Step 2's fixes are committed: 8ab7dd9, 9802d6a, 4aaf77e, 62b5c7d, df71c7e (review.r1 approved).

## Merge (committed, Tevin as author)
**7254e08** merges `feature/ratings` (695753d). Its body lists the conflict resolutions:
- Menu and dish pages: 2.8's menu kept. The dish page shows 2.10's rating line under the name.
- Order page: 2.10's rating and Google cards sit right below the status band (spec-2.10), then 2.8's where card and save link. The page schema has every slice's fields.
- More and nav: Reports and Ratings each have their own row.
- Settings: the phone, address and Google link cards are all kept.
- globals.css: 2.10's block and `--ease-in-out` are added at the end; 2.8 and 2.12 motion is unchanged.

## Fixes (uncommitted, for review.r1's re-check)
2.10's migration (`20261114000000_ratings.sql`) started from 2.9's base, so it ran into the same problem as RW2B-01:
- **get_order_status:** 2.10's version runs before the composed one (`20261116100000`), so after the merge the rating fields were simply gone. The rating card would never have shown.
- **todays_menu:** 2.10's view dropped 2.7's rule that a dish is sold out when every one of its choices is out.
- **customer_menu:** the shop now reads 2.8's `customer_menu()`, not `todays_menu`, so 2.10's averages never reached the menu cards.

`supabase/migrations/20261116100300_ratings_compose.sql`:
1. `get_order_status`: the composed function plus `rating`, `rate_dishes`, `rate_until` and `google_review_url`, exactly as 2.10 defined them.
   - Same signature, `security definer` and token-only filter; `create or replace` keeps the grant.
   - The comment text and whether a rating is hidden are never returned.
2. `todays_menu`: owner_screens' view, plus 2.10's `rating_avg` and `rating_count` at the end. `choices_all_out` is back in `sold_out`.
3. `customer_menu()`: the same two columns at the end. Its return type changes, so the migration drops it, creates it again and re-grants execute to anon and authenticated.

App:
- `menu-model.ts`, `menu-server.ts` and `database.types.ts`: each menu dish carries `ratingAvg` and `ratingCount`. Specials take them from `customer_menu`; regulars use `dishAverage` on the dish's totals.
- `dish-cards.tsx`: 2.10's `RatingMeta` sits next to the price on tiles and rows, wrapping under it when there is no room.

Tests:
- `tests/db/order-status-contract.test.ts`:
  - KEYS now includes the four rating fields.
  - Before completion: `rating` is null, `rate_dishes` lists the dishes, and `rate_until` and the Google link are null.
  - A new test covers a completed, rated, replied-to and hidden order. 2.8's and 2.9's fields stay. `rating` keys are exactly `comment_sent, reply, sent_at, stars`, and the comment text appears nowhere in the payload.
  - A new test covers the menus: `rating_avg` from the 3rd rating on both menus (4.3, then null at 2), and every choice out makes the dish sold out on both.
- `tests/unit/menu-model.test.ts`: fixtures have the new fields, and a test checks that the averages reach specials and regulars.
- `tests/db/ratings.test.ts`: the "pilau twice" test passed the fixtures' option as a choice, but in the merged fixtures (2.6) it is an extra. It now passes it as an extra, which keeps two lines of the same dish.

## Checks (07:01 Nairobi, Sunday 15 Nov)
- `$D reset` on slot 1 from this worktree: OK (29 migrations plus seed). Reset again after the screenshots.
- `bun run typecheck`, `bun run lint` and `bun run build`: pass (build run with the dev server stopped).
- Full suite on slot 1: **533 pass, 0 fail, 0 skip.**
- Evidence: `docs/review/launch/evidence-wave-2-integration/step3-contact-sheet.png`.
  - Menu at 375, 320 and 1280, with ratings on tiles and rows.
  - Dish page at 375.
  - A completed, rated order with Mama's reply, at 375 and 1280.
  - More at 375; Ratings and Settings at 1280.
  - The "N" badge is Next's dev overlay.
- Not verified: Realtime.

## Open (not in this step)
- 2.12's Reports says ratings reports wait for 2.10 to be merged. No ratings report RPC exists yet, so Reports still shows its empty state for ratings.
- 2.11 merges last and builds on these composed versions of `get_order_status`, `customer_menu` and `todays_menu`.

## break-ui: menu cards with stars (07:10 Nairobi)
Worst-case data on slot 1, put in through the database the way real data arrives (no component edits):
- **Long names:**
  - a today's special and a regular, 95 characters each, both with "★ 5.0 (12,345)" (12,345 ratings);
  - a week dish, 98 characters, with "★ 4.6 (38)".
- **No rating:** a 94-character regular with 0 ratings, and a short-named special with none.

Checked at 320, 375, 375 with 200% root text, and 1280. Evidence: `evidence-wave-2-integration/step3-breakui-sheet.png`.

| # | Severity | Field | Worst case | What happens | Fix |
|---|---|---|---|---|---|
| 1 | Ugly (2.8, not the stars) | special tile name | "Coastal Coconut Fish Curry…" at 200% text, 375 | The text column beside the 150 px plate is about 150 px wide, so `overflow-wrap:anywhere` splits single words: "Coconu / t Fish", "Mukim / o &". | At large text, put the plate above the text, or shrink it, so the column is wide enough for a whole word. This is a 2.8 layout decision, so it's reported, not fixed here. `dish-cards.tsx` DishTile. |
| 2 | Fragile | dish name | 95 characters | The dish editor caps names at 80 (`dish-editor.tsx:183`), but the database has no limit (`init.sql:45` only checks for an empty name). Seed, SQL or a future import can save longer names. | A matching `check (length(name) <= 80)` in a migration. Nothing breaks today, since cards clamp to 3 lines. |

What held up:
- **"★ 5.0 (12,345)":** never wraps inside itself (`whitespace-nowrap`, tabular figures).
  - On a 320 tile it drops under the price.
  - On 375 tiles and phone rows it sits beside the price.
  - At 1280 it sits under the description. The price and + stay on the right.
- **No rating:** nothing renders, with no empty gap, no "0" and no orphaned star (tiles and rows at every width).
- **95-character names:** clamped to 3 lines with an ellipsis on tiles and rows. The full name is on the dish page.
  - The + button and "Sold out" never get pushed off (`flex-none`).
  - Plates keep their size.
- **Counts:** a count of 1 or 2 never shows, because the average needs 3 ratings. The screen-reader label still says "rating" or "ratings" correctly.

No break-ui fixes in code: #1 is a 2.8 layout decision and #2 is a schema rule, both open for orch.lead.
