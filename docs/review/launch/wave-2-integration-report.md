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
