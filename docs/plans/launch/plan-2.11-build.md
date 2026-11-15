# 2.11 ads and promos: build plan (dev.implementor)

*2026-11-14. Spec `docs/plans/launch/spec-2.11-ads-promos.md`; Tevin's answers in `question-2.11-discount-codes.md` (all A, except Q3 B: no "first order only" setting). The worktree is `../dausis-plate-worktrees/dev-implementor-2.11-ads-promos`, on branch `feature/ads-promos`. Use slot 0 and port 3020.*

**Base.** The branch was made from `feature/customer-flow` at `1d7bee1` (the 2.6 commit). 2.8 is not committed yet, so this plan is the only file here. Once 2.8 is committed, `git merge --ff-only feature/customer-flow` moves this branch onto 2.8's commit. That's a fast-forward, not a rebase, and nothing of mine is on the branch yet. Building starts only after that.

## 1. Where the spec meets the built code (decisions I'm taking, all technical)
| Spec says | Built code | Plan |
|---|---|---|
| `todays_menu` selects `is_pick`; a `todays_combos` view | Since 2.8, customers read `customer_menu()`, which is today's menu while open and the next open day's when closed. `todays_menu` is only for staff. | `is_pick` goes into `customer_menu()`, which changes its return type, so it is dropped and recreated with its grants. `todays_menu` gains it too, for the dashboard. Combos come from a `customer_combos()` function built on `customer_menu()`, so the closed menu gets the next day's combos for free, as the spec wants. |
| `subtotal = Σ order_items + Σ extras + Σ order_combos` | `place_order` puts the extras into `order_items.unit_price_kes`. `order_item_extras` is only a record of them. | `subtotal = Σ items (unit × qty) + Σ order_combos (price × qty)`. A combo part's `unit_price_kes` = its choice difference + its extras, which keeps the built model. The spec's formula would count extras twice. |
| A failed code raises `hint = 'discount_code:<reason>'` | The checkout action reads the reason from `error.details` (2.8's `reasonOf`) | Use `detail = 'discount_code:<reason>'`, the same pattern. |
| Once per phone uses "the same phone" | 2.8 added `phone_key()` and an index on it | Once per phone compares `phone_key(customer_phone)`, so 0712…, +254712… and 712… count as one phone. |
| The cart rechecks lines | 2.8's `check_cart(p_lines)` | It learns combo lines: `{key, kind:'combo', combo_id, quantity, parts:[…]}`. It returns the same states, plus `combo_off`. Parts share plates with dish lines in line order, as dishes do. |

## 2. Order of work (spec: A, then B, then C)
I'll build all three on this branch, with the three checks run at the end of each part. **QA (orch.lead, 20:40Z):** one round over A, B and C together: standard depth for A and B, deep for C (codes), since it handles money.

### A. Ads and picks
**Migration `20261114000000_ads_and_picks.sql`:**
1. `alter type change_area add value 'promos'`. It's used only inside function bodies, so it is safe in the same migration; nothing in this file inserts with it.
2. `dishes.is_pick` (default false). 2.3's owner-only column guard gets `is_pick`, and the dish log trigger writes `promo.pick` (area promos).
3. `customer_menu()` and `todays_menu` add `is_pick`.
4. The `ad_space` enum and the `ads` table, with the spec's columns and checks. Owner-only RLS. Delete is allowed only while a draft.
5. A before-update trigger:
   - an edit to a customer-visible column (advertiser, line, place, link label, link URL, logo, space, start date) clears `approved_at`;
   - an edit to the end date or the fee doesn't;
   - it writes to `change_log`.
6. The approval RPCs: `approve_ad`, `pause_ad`, `resume_ad` and `end_ad_now`.
   - They check `is_owner()`, are security definer, and lock the space with `pg_advisory_xact_lock(hashtextextended('dausis.ad_space:'||space,0))`.
   - An overlap is refused with P0001, detail `ad_overlap`, and the spec's message.
   - Resume runs the same overlap check.
   - The live test is `approved_at is not null and paused_at is null and nairobi_today() between starts_on and least(ends_on, ended_early_on)`, written once as a SQL function `ad_is_live(ads)`.
7. `live_ads` view, granted to anon:
   - no fee;
   - no `link_url` for web links;
   - a `tel:` link is given as the number, since the tap is counted by a beacon.
8. `ad_daily_counts`, owner select only. `count_ad_view(uuid[])` (anon, at most 2 ids, live ads only, upsert +1). `count_ad_tap(uuid)` returns the `link_url`, or null when the ad isn't live.

**App:**
- `src/components/shop/neighbour-ad.tsx`: the card (server-rendered), plus a client `AdViewCounter` (IntersectionObserver at 0.5 for 1 s, once per page load, then `sendBeacon('/api/ads/view')`).
- `src/app/a/[id]/route.ts`: `count_ad_tap`, then a 302 to the link, or a 404 page "This offer has ended". It never redirects anywhere not stored in `ads`.
- `src/app/api/ads/view/route.ts`: the beacon endpoint. It calls the RPC with the anon client.
- **Menu:** the menu ad after Mains, only when the table cookie is set and the kitchen is open.
- **Order page:** the order ad at the very end for dine-in and pickup orders that aren't cancelled.
- **Picks:** they sort first in `menu-model.ts` (the comment there already expects it), and `pills.tsx` gets the blush pill.
- **Dashboard:**
  - `/dashboard/promos` (owner only; staff go to the board, the same pattern as Team);
  - the rail item after Tables, a row in More after Ratings (after Team until 2.10 is merged), and a megaphone icon in `icons.tsx`;
  - the Neighbour ads tab: space cards, the list (20 per page), and the ad panel or sheet with a live preview;
  - the Your promos tab, picks card only for now;
  - History gets a Promos chip.
- **Logo:** `photo-upload.tsx` with a square crop. There's no dev R2 bucket, so it runs on the existing stub and is reported as not verified.

### B. Combos
**Migration `20261114000100_combos.sql`:**
- The `combos` and `combo_items` tables. Writes are owner only, and anon can read them, as with dishes.
- `save_combo(jsonb)`:
  - owner only;
  - 2–4 dishes in total, each quantity 1–4;
  - refuses a price at or above the sum of the dishes' `price_kes` (detail `combo_no_saving`);
  - logs to History.
- `customer_combos()`: for each active, unarchived combo, the `everyday_total`, the `today_total` (from `customer_menu()` prices), and `available` with its first `reason`. A combo is available when every dish is present on the menu day, `open_now` (or the kitchen is closed and it's the next day), not sold out, and has `plates_left` ≥ the quantity.
- `order_combos`, with `order_items.order_combo_id` (on delete cascade). RLS is the same as `order_items`.
- **`place_order`:**
  - The per-dish checks, from "find the dish" through extras, move into one internal function, `order_line_check(p_dish, p_entry, p_option, p_extra_ids, p_qty)`. It returns the line jsonb and updates the plates. Items and combo parts both call it, so the two can't drift.
  - Combos come in as `combos:[{combo_id, quantity, parts:[{dish_id, menu_entry_id, option_id, extra_ids}]}]`.
  - Each combo row is locked and checked as active. The parts must be exactly its dishes and quantities, otherwise detail `combo_changed`.
  - "Too many items" counts items plus the parts of each combo.
  - Error messages name the combo: "Sorry, Passion juice in the Lunch combo has sold out".
- `check_cart` handles combo lines, as in section 1.
- `get_order_status` and the board's ticket query return combo lines, with the dishes under them.

**App:**
- **Cart lines:**
  - Lines get `kind: 'dish' | 'combo'`.
  - A combo line holds `comboId`, `name`, `unitKes` and `parts`.
  - The storage key goes to `dp-cart-v2`, and v1 carts are read in as dish lines, so no cart is lost.
- **Menu:**
  - The combo card goes after today's dishes.
  - The add button opens the dish sheet as a combo sheet ("Comes with" for each dish with choices, then extras) when any part has choices. Otherwise one tap adds the combo.
- **Checkout:** the action sends `combos`, and the zod schema covers them.
- **Showing a combo:** the order page, board ticket and cart line show the combo name with its dishes indented under it.
- **Promos:** a combos card, a combo panel with the everyday price and the saving, and a switch.

### C. Discount codes
**Migration `20261114000200_discount_codes.sql`:**
- `discount_codes` as in the spec, without first-order-only (Q3 B):
  - owner-only RLS, with no anon read;
  - a trigger stops `kind`, `value` and `cap_kes` from changing once any order uses the code;
  - changes are logged.
- On `orders`:
  - new columns `discount_code_id` and `discount_kes`;
  - the total check becomes `total = subtotal − discount + fee`;
  - existing rows have a discount of 0, so the check holds for them.
- `check_discount_code(...)` (anon): returns `ok`, `discount_kes`, `reason` and `label`. It runs the same rule function that `place_order` uses: `code_refusal(code_row, food, covered, mode, phone)`, which returns the reason or null. Writing it once means the cart and the order can't disagree.
- **`place_order`:**
  - takes `discount_code`;
  - after pricing, before the area minimum: locks the code row with `for update`, then gets the refusal;
  - refusals use detail `discount_code:<reason>`;
  - discount = `floor(covered × pct / 100)` capped, or `min(amount, covered)`;
  - minimums use all the food before the discount (Q4 A);
  - uses count orders with status other than cancelled, so a cancel gives the use back with nothing more to do.
- `code_figures` view (owner).
- `get_order_status` returns the code text and `discount_kes`. So does the board ticket query.

**App:**
- **Cart:**
  - The cart stores the code.
  - A 300 ms debounced check runs on every line change.
  - A states chip for each state (applied, amber under the minimum, ended, failed check).
  - The Discount line.
  - "Checked again when you order" while the kitchen is closed.
- **Checkout:**
  - a check when the mode or phone changes;
  - Discount and Delivery lines;
  - when the code fails at placing (Q2 A): an amber note, "Place without the code · KSh …" with a new attempt key, and "Back to cart".
- **Elsewhere:**
  - the order page shows the Discount line;
  - the ticket shows "KARIBU10 −KSh 152" above the total;
  - Promos gets a codes card (a table from 1024, cards below), a code panel with the live "is free / is taken" check and the summary line, and "Show ended codes".
- **Motion:** only the spec's table. The chip and Discount line enter by fading in with a 4 px rise. Error notes fade in. Press feedback uses the existing classes. Panels use the existing sheet. All values are the existing tokens; nothing new.

## 3. Tests
Everything in the spec's Tests list goes in three files: `tests/db/ads.test.ts`, `combos.test.ts` and `discount-codes.test.ts`.

Two races are proven outside the rollback harness, the same way as `scripts/check-menu-entry-race.ts`, in a new `scripts/check-promo-races.ts`:
- two orders racing for the last use of a code (one placed, one refused);
- two approvals for the same space at the same moment (one approved, one refused with the overlap message).

Each part also gets a regression run of the 2.8 `place_order` and `check_cart` tests, since part B's shared line function changes their path.

## 4. Risks and integration (for orch.lead)
1. **`place_order` is redefined in several unmerged branches.** *Resolved (orch.lead, 20:40Z): 2.12 stops redefining `place_order`. Its `sold_out_at` is set by a trigger on `menu_entry_days`, in a `fix(reports)` commit on `feature/reports` made before this build. 2.11 then owns the last `place_order` body. The original note follows.*
   - 2.12's `20261116000000_reports.sql` rebuilds `place_order` from the **2.5** version, to add `sold_out_at`. Applied after 2.6, 2.8 and 2.11, it would silently remove extras, the area minimum, the 2.8 detail codes, combos and codes.
   - This is true today between 2.12 and 2.6 or 2.8, whatever 2.11 does.
   - Proposal: the last `place_order` merged must be rebuilt on all the earlier ones. 2.11's parts sort before 2.12 (20261114), so at integration 2.12's `place_order` needs 2.11's body plus the `sold_out_at` line.
   - Part B's shared `order_line_check` is the natural home for that line, which is one more reason to integrate 2.12 after 2.11.
2. **2.12's reports and combos.** Per-dish sales come from `order_items`. A combo's dishes there are priced only at their choice and extras difference, so dish revenue would be understated. Combo revenue is on `order_combos`. Sales totals stay right if 2.12 uses `orders.total_kes` or `subtotal_kes`, but codes make subtotal minus discount the real food money. 2.12 already says it adds 2.11 reports later; these are the two facts it needs.
3. **2.9 and 2.10 on the order page.** Ratings and table requests aren't in this base. The ad goes last, after "Back to the menu", and stays last when they merge.
4. **The cart storage key changes to v2.** Old carts are migrated on read, and tested.

## 5. Not verified (said now so nobody expects it)
- Logo upload to R2 (no dev bucket).
- The ad link from an in-app QR browser on a real phone.
- The keyboard over the cart code field and the sheets.
- View counting on a real scroll (it is proven with a headless scroll).

## 6. Checks at each handoff
- `bun run typecheck`, `bun run lint` and `bun run build`.
- `DEV_STACK_REPO=<worktree> $D reset`.
- `bun run test` with the slot 0 test URL.
- The race script.
- Screenshots at 375, 768 and 1280 for each screen in the spec, on one contact sheet. 320 for the cart code row and the combo card.
- Skills: `impeccable` critique and audit, `review-animations`, `break-ui` with the spec's worst-case data, and `mobile-native`.
