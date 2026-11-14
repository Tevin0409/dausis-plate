# 2.8 customer flow: build plan (dev.implementor)

> **Resume note (keep current):** 2026-11-14, step 1 DONE: `supabase/migrations/20261112000000_customer_flow.sql` (customer_menu, menu_day, check_cart, place_order detail codes, get_order_status address/notes, set_kitchen_address, find_order + lookup_attempts), `tests/db/customer-flow.test.ts` 17/17, full `bun run test` 362/362, types and seed updated. Three old tests updated: over-plates now says "Only N plates of X left…" (detail over_plates); status items carry `note`. Step 2 DONE: `src/lib/menu-words.ts` + `tests/unit/menu-words.test.ts` 21/21. Step 3 DONE (logic): `src/lib/cart-check.ts` (applyCheck, lineCap, inOrder) + `tableExpired` in `table-cookie.ts` (cookie now carries `at`), `(shop)/cart-actions.ts` (recheckCart, forgetTable), cart-provider rewritten (checks, caps, remove + 6 s undo, announce, recheck on load and on each kitchen status read; KitchenProvider now wraps CartProvider); `tests/unit/cart-check.test.ts` 17/17. Steps 4-5 DONE: `(shop)/page.tsx` reads `customer_menu()` + `kitchen_place()` (new anon reader for the address; test 18/18) into `buildMenu` (`src/lib/menu-model.ts`), rendered by `components/shop/menu/` (menu-view, band, section-nav JumpBar/Rail, dish-cards, pills); `cart-line.tsx` (CartLineItem with out states and notes, QtyStepper, UndoStrip, OrderAnnouncer in the shop layout); new `order-panel.tsx` (fit-height, saved note, OrderButton); phone cart page on the shared line; CartBar "Your saved order" when closed. Unit 131/131, typecheck and lint clean, checked at 375 and 1280 (closed, adds, remove + undo, off-menu line). Report notes: week aside "Mon–Sat" not shown (off-days not in customer_menu); option_out/not_now and the phone off-menu count note use provisional words for dev.designer; phone dish sheet not built (dish page stays). Step 6 DONE: `src/lib/menu-server.ts` (`loadMenu`, shared by menu and dish page), `MenuFrame` in menu-view (band, rail, panel kept on the dish page), `menu/return-to.ts` (back to the row, link focused), dish page rewritten in the frame (card, plate side, pills, hours, price 22/700), `dish-form.tsx` rewritten (48 px radio cards, buy row with plates stepper capped at room left, hint, cantAddReason priority, page stays after Add from 1024 and returns to the menu below it). `cantAddReason` now says "Not on <day>’s menu" open or closed. Checked at 1280, 1024, 375: add with option ×2 lands in the panel, stepper back to 1; off-menu dish shows the disabled reason; Back focuses `#dish-<entry>`. Unit 131/131, typecheck and lint clean. Report note: below 1024 Add returns to the menu (no panel there; DESIGN.md sheet closes after Add), spec says "the page stays", so flag it. Step 7 DONE: checkout rechecks at Place order (`changedOnCheck`); a change shows "Your order changed" with the touched lines (CartLineItem) and the new total, and doesn't place; a menu refusal from place_order (sold_out, over_plates, not_on_menu, option_out) rechecks the same way; only counted lines are sent; "Nothing left to order" when none count; inputs 16 px. `applyCheck` now counts a new price as a change (unit test added, 132/132). `actions.ts` maps all detail codes incl. under_minimum. Checked at 1280: 2 Mukimo, plates set to 1 mid-checkout, first press showed the lowered line and KSh 2,360, second press placed KSh 2,360. Not exercised in a browser: the refusal-then-recheck path (needs a sale between check and place). Provisional words for dev.designer: "Your order changed", "Check it, then press Place order again…", "Checking your order…". **LOCAL TEST STATE TO RESTORE before handoff:** `opening_hours` weekday 6 opens 08:00 (was 11:00); menu_entries 1706e78d… and 4ba462ae… show_from 08:00 (was 11:00); 1706e78d… plates_per_day 1 (was 20). A `$D reset` at step 11 restores all of it. Step 8 DONE: status page (`order/[token]/page.tsx`) per spec-2.8b §1: band headline (StatusHeadline, fades only on a refreshed status), where card per mode (pickup Directions, dine-in quiet line, delivery address/notes/area), `components/shop/save-link.tsx` (Copy with fallback select + note, Share when available, Find your order link; hidden when completed/cancelled), item notes, `components/shop/arrive.tsx` (markArrival + page fade on arrival from Place order / lookup), loading bones, not-found and error words. `declined` zod now nullish (a cancelled order without prev_status crashed the page). Owner-only Settings card `settings/address-card.tsx` + `saveKitchenAddress` (set_kitchen_address), staff read-only tile. Checked at 375/320/768: pickup with and without maps, no address, 200-char address, delivery with and without notes, dine-in, completed, cancelled, not found; no sideways scroll; settings client + server https refusal, save. Local test orders DP-0101..0105 were inserted by hand (reset clears them). Note for dev.designer: settings field values render semibold (inherited from the label; till and phone too). Step 9 DONE: `/order/find` (`order/find/page.tsx` noindex, days from `order_lookup_days()`; `find-form.tsx` with normaliseCode "dp 0100"→"DP-0100", empty/no match/paused/network per spec, markArrival then /order/<token>; `actions.ts` findOrder). "Call us" uses `NEXT_PUBLIC_RESTAURANT_PHONE` like not-found (kitchen_place keeps only address+maps; flag). Dev server now runs with NEXT_PUBLIC_RESTAURANT_PHONE=+254700123456 to show it. Checked at 375/320/768: empty, no match, found (DP-0100), paused after 5 misses, offline. Step 10 DONE: `/t/[token]` redirects relatively (303, stays on the scanned host), clears `dp_table` on an unknown/off/replaced code and sends `/?qr=unknown`; `menu/qr-notice.tsx` (no entrance, `.notice-out` fade on Dismiss, replaceState drops `qr`), wired through `(shop)/page.tsx` searchParams → MenuView `qrUnknown`. Checked at 375 and 1280: good scan sets the chip; bad code and a turned-off table clear it and show the notice; Dismiss and reload stay gone; closed kitchen shows both. Step 11 DONE: reset done (local test state restored), typecheck/lint/build pass, `bun run test` 411/411; critique 32/40, audit 17/20 (fixed duplicate live region on lookup, focus after QR Dismiss); report `docs/review/launch/2.8-report.md`. Fix 18:05Z DONE: Call us on Find my order and not-found uses the Settings phone via `kitchen_place().phone` behind `CALL_US_WHEN_NOT_FOUND` (`src/lib/call-us.ts`), test updated, reset + 411/411. Next: QA (uncommitted until it passes).

Branch `feature/customer-flow` from 2.6 (`1d7bee1`), worktree `../dausis-plate-worktrees/dev-implementor-2.8-customer-flow`, stack slot 0, port 3020.

**Sources:**
- `plan.md` row 2.8.
- `spec-2.8-menu-on-a-computer.md` (Rail, desktop; Build follow-ups).
- `DESIGN.md` :258-288 (menu, closed kitchen, saved cart, recheck).
- `question-2.8-sold-out-in-order.md` (Tevin A).
- `question-2.8b-order-lookup.md` (Tevin B).
- `brief-1.1-prototypes.md`, for the status page, Save this link, lookup and bad-QR screens.

## What exists today (code map at 4898d23 + 2.6)
- **Menu:** `todays_menu` is tied to `nairobi_today()`. There is no next-day menu, so the closed page shows today's dishes. The kitchen status already has `next_open_date` / `next_opens_at` (`src/lib/kitchen.ts`).
- **Cart:**
  - It is stored in localStorage under `dp-cart-v1` (`cart-provider.tsx`, `src/lib/cart-lines.ts`).
  - The table comes from the `dp_table` cookie, which lasts 4 h, and is never forgotten at closing.
  - There is no recheck, the only cap is 20, and there is no undo.
- **`place_order`:** it refuses both "sold out" and "over plates left" with the same message and no detail code. Checkout maps only `kitchen_closed` and `pickup_time`; everything else shows as bare text.
- **Delivery minimum:** enforced in the browser (`zone-minimum.ts`) and in the database (`under_minimum`). Checkout still needs to map it.
- **Status page:**
  - It reads `get_order_status`, which has no address, directions or notes.
  - There is no "Save this link".
  - There is no order lookup anywhere.
- **Bad QR:** `/t/[token]` with an unknown or inactive token silently redirects to `/` and keeps the old table cookie.
- **Polish gaps:**
  - Checkout and dish-note inputs are 15 px; DESIGN.md says 16.
  - AddButton has no 900 ms check.
  - The pages print "1 plates left".
  - There's no shared plural helper.
  - "Sold out last" ordering is missing.
- **Tests:** `tests/db/helpers.ts` has `inTx`, `seedFixtures`, `placeOrder`, `asOwner` and `attempt`.

## Steps (each ends with tests or a screenshot)
1. **Migration `20261112000000_customer_flow.sql`.** Tests come first, in `tests/db/customer-flow.test.ts`.
   - `customer_menu()` (built instead of `menu_for_day(p_day)`): `menu_day` plus the `todays_menu` columns for `menu_day()` (today while open or before opening, else the next open day), with plates counted for that day (fresh for a future day). `todays_menu` keeps serving today, unchanged for its callers.
   - `check_cart(p_lines jsonb)`: returns each line's state: `ok`, `sold_out`, `capped` (n), `not_on_menu` or `option_out`. It checks against today when open, otherwise the next open day. Counts come from the server only. Read-only; anon may call it.
   - `place_order`: add detail codes `sold_out` and `over_plates` (with the plates left). The messages stay the same.
   - `get_order_status`: add the kitchen address and maps link for pickup and dine-in; the customer's address and notes for delivery; and item notes. The token is the secret.
   - `find_order(p_phone, p_code)`: returns the token for a match within `ORDER_LOOKUP_DAYS = 7` days. After 5 wrong tries it pauses for 15 minutes. The tries are kept in a `lookup_attempts` table keyed by phone (RLS on, no grants).
2. **Shared wording:** `src/lib/menu-words.ts`, unit-tested:
   - `plates(n)` ("1 plate", "7 plates");
   - the plates-left pills and the cap notes;
   - the recheck notes ("Only 1 plate left, so we changed this to 1.").
3. **Cart provider:**
   - At closing, drop the table and keep the items.
   - Run the recheck on load, on menu refresh, on tab return (`visibilitychange`) and before placing.
   - Line states: not on <day>'s menu; sold out; lowered to n with a note.
   - Cap each line at the plates left.
   - Remove with a 6 s Undo.
4. **Menu (phone):**
   - Closed: the next open day's menu ("Friday's menu", "30 plates for Friday").
   - The not-planned note.
   - Sections: Today, This week, then the categories, with picks first and sold-out dishes last.
   - A jump bar with the active link.
   - The add button shows a check for 900 ms. Closed, the button says "Save · KSh".
5. **Menu on a computer (Rail):**
   - Build the spec's band, rail, tiles, rows and "Your order" panel.
   - The panel gets the sticky height fix, undo and a live region.
   - The panel stays beside the dish page.
6. **Dish page:**
   - Closed-kitchen wording.
   - The stepper is capped at the room left.
   - When a dish can't be added, follow the spec's priority list for the words.
   - The page stays after Add.
7. **Checkout:**
   - Recheck before placing. If lines changed, show them and don't place; a second press places the order.
   - A refusal from `place_order` re-runs the check.
   - Map `under_minimum`, `sold_out` and `over_plates`.
   - Inputs at 16 px.
8. **Status page:**
   - Pickup and dine-in: the kitchen address with a directions link. Delivery: the customer's address and their notes.
   - "Save this link": copy and share.
   - The quiet status chip from 2.1.
9. **Order lookup `/order/find`:** phone plus code opens the status page. Otherwise it shows a plain "We couldn't find that order", with no hint which part was wrong, and the pause message after 5 tries.
10. **Bad QR:** an unknown or inactive token clears the old table cookie and lands on the menu with a notice.
11. **Checks:**
   - `typecheck`, `lint`, `bun run test`, `build`, reset.
   - Screenshots of every state at 375, 1024, 1280 and 1440.
   - The spec's Large menu fixture.
   - Skills: break-ui, review-animations, impeccable critique and audit, mobile-native.

## Answers
**orch.lead, 2026-11-08 20:41Z:**
1. Build steps 8–10 from DESIGN.md and the 1.1 prototypes. dev.designer checks the words and screens afterwards, and QA covers them.
2. Wrong tries are a technical safety setting: 5 tries, then a 15-minute pause, in the database.
3. Pickup and dine-in show the kitchen address with a maps directions link. Delivery shows the customer's address and their notes.
4. Steps 1–7 first, then 8–10.

**Tevin, 2026-11-14 (`question-2.8b-order-lookup.md` B):** lookup covers 7 days. Invite links stay 24 h, as built.
