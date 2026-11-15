# 2.11 order side: plan (dev.implementor, 2026-11-15)

Builds on the combined branch once step 3 (`20261116100300_ratings_compose`) is committed. orch.lead, 04:07Z: option b, stash then merge then unstash; no WIP commits.

## 1. Merge (option b)
1. `git stash -u` in the 2.11 worktree.
2. `git merge <step-3 hash>`: one merge commit, author Tevin, no AI mention.
3. `git stash pop`. Resolve conflicts in `database.types.ts`, `history.ts` (AREAS and lines), the nav (Ratings and Promos both go on More), `history/page.tsx` and the dashboard layout.

## 2. Migration order (found while planning)
- The combined branch has `20261114000000_ratings.sql`, which also redefines `todays_menu`. It sorts after my `20261114000000_ads_and_picks.sql`. It also has migrations dated 2026-11-16, and `20261116100300_ratings_compose` redefines `todays_menu`, `customer_menu` and `get_order_status`.
- Fix: rename my three migrations to run after it:
  - `20261117000000_ads_and_picks`
  - `20261117000100_combos`
  - `20261117000200_discount_codes`
  - plus a new `20261117000300_promo_orders`.
- `ads_and_picks` rebuilds `todays_menu` and `customer_menu` from the 100300 versions, adding only `is_pick`. Rating fields and the sold-out rule stay as they are.
- `customer_combos` reads `customer_menu()`, so it picks up the composed rule automatically. I'll check it again after the merge.

## 3. `20261117000300_promo_orders.sql`, starting from the combined branch's latest definitions
- **`order_line_check`.** One inner function that does the per-dish work for a line:
  - entry or everyday dish, serving window, plates locked and updated, choice and extras;
  - returns the unit price and the plate use.
  - `place_order` calls it for normal lines and for combo parts, so the two can't drift.
  - Its body is lifted unchanged from the current `place_order` loop. Behaviour is unchanged for existing lines, and the existing place-order and order-safety tests are the contract for that.
- **`place_order(p)`** accepts:
  - `combos: [{combo_id, quantity, parts:[{dish_id, menu_entry_id, option_id, extra_ids}]}]`. It locks the combo, checks it is active, and checks the parts are exactly its dishes and quantities. Each part runs through `order_line_check` × the combo quantity. The price is the combo price plus choice differences plus extras. The "Too many items" limit counts the parts.
  - `discount_code`. After all lines are priced, and before the area minimum:
    - lock the code row with `for update`;
    - call `discount_code_refusal` with food = all lines, covered = non-combo lines, plus the mode and phone;
    - on failure, raise P0001 with `hint = 'discount_code:<reason>'`;
    - write `discount_code_id` and `discount_kes`, with total = food − discount + fee.
  - The area minimum stays on food before the discount.
  - A replay with the same idempotency key returns the stored order.
- **`check_cart`** learns combo lines: per-part states, plus `combo_off` and `combo_parts`.
- **`get_order_status`**, from the 100300 version, adds:
  - `discount_kes`;
  - the code text;
  - `combos: [{name, unit_price_kes, quantity, parts:[…]}]`.
- **Contract tests** (`tests/db/promo-orders.test.ts`): every Combos and Codes item in the spec's Tests list, including:
  - two concurrent orders for the last use (a second connection);
  - cancelling an order frees the use;
  - the total constraint;
  - an idempotent retry;
  - the existing order-status contract test still passes with the added keys.

## 4. App, after the database
- **Menu:** a combo card (shown only when `available`), and a combo sheet for the parts' choices and extras.
- **Cart:**
  - cart v2 (`dp-cart-v2`, v1 migrated) with combo lines;
  - the code row ("Have a code?", the applied chip, the amber "below minimum" state) and the Discount line.
- **Checkout:** mode and phone checks; when `place_order` refuses the code, offer "Place without the code · KSh X" with a new attempt key.
- **Board ticket and order page:** combo lines and the discount.
- **Reports:** the "Promos & ads" tab (orch.lead, 04:07Z): code figures, combos sold, and ad views and taps.
- **Race check:** `scripts/check-promo-races.ts` covers the last use, a combo's last plates, and ad overlap approvals.

## 5. Then
- Run typecheck, lint, build, reset, the full DB tests and the race script.
- Take screenshots at 320, 375, 768 and 1280.
- Run the skills (impeccable critique and audit, review-animations, break-ui, mobile-native).
- Write the report, then hand off to QA (standard depth, with C at deep).

## Notes for orch.lead
- Reports (2.12) counts `subtotal_kes` as food. With codes, sales = `total_kes` stays right, but food before or after the discount needs one line in the Promos & ads tab. I'll show "Discounts given" separately rather than change 2.12's tiles.

## Progress (2026-11-15)
- **Merge:** bd64250 (step 3 `03b56cb` plus docs) merged as `594f5fb`; stash popped, 9 conflicts resolved. Ratings and Promos sit side by side in the history areas, More, the types and the menu model.
- **Migrations:**
  - `20261117000000_ads_and_picks` now starts from 100300's `todays_menu` and `customer_menu`, adding only `is_pick`.
  - `20261117000300_promo_orders` is written. One change from section 3: there is no separate `order_line_check` function. Combo parts are appended to the items loop and marked as parts by position, so the dish code is literally the same code. A client can't mark an item as a part.
  - `order_items.quantity` may reach 80 on combo rows (4 of a dish × 20 combos).
- **Tests:**
  - `tests/db/promo-orders.test.ts`: 13 tests.
  - The order-status contract keys now include `discount_kes`, `discount_code` and `combos`.
  - Full DB suite: 385 pass.
- **Race script:** `scripts/check-promo-races.ts` passes all three checks: last use, a combo's last plate, ad approvals.
