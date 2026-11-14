# 2.8 fix round (design should-fix 1–2, RQA28-02 to 08): report (dev.implementor)

*2026-11-14. Brief `docs/plans/launch/fix-2.8.md`; findings `docs/review/launch/qa-2.8-customer-flow.md` and `design-check-2.8.md` (main checkout). Worktree `../dausis-plate-worktrees/dev-implementor-2.8-customer-flow`, branch `feature/customer-flow`, uncommitted, ready for the smoke re-test. Slot 0, app on 3020. RQA28-01 is closed by design and was not touched.*

## Changes
| Item | File | What |
|---|---|---|
| **Design 1:** input borders | `src/app/(shop)/order/find/find-form.tsx`, `src/components/shop/checkout-form.tsx` | `border-sand-deep` → `border-field` on the Find my order inputs and the checkout inputs (lines 29, 263). **Beyond the brief:** the checkout's unselected choice card (line 37) also used `border-sand-deep`, so it was changed too, to match. Browser: computed border `rgb(140,132,120)` (#8c8478). |
| **Design 2:** M-Pesa | `src/app/(shop)/order/[token]/page.tsx` | "M-Pesa" sits in a `whitespace-nowrap` span inside one shared `how` fragment, used by all four Pay strings. The Pay row is now a `ReactNode`. Browser: one line at 320 and 375. |
| **RQA28-02:** long unbroken words | `src/components/shop/menu/dish-cards.tsx`, `src/app/(shop)/dish/[id]/page.tsx`, `src/components/shop/cart-line.tsx` | `[overflow-wrap:anywhere]` on the card name and description, the row name and description, the dish page description, and the cart-line name. The dish page title already wrapped. Browser at 320, 375, 1024 and 1280 (an 80-character `_`-joined name and description): menu and dish page `scrollWidth` equals the viewport, and nothing is clipped. **The buy bar is still clipped at 320; see Open below.** |
| **RQA28-03:** focus after a keyboard submit | `find-form.tsx` | The button uses `aria-disabled` and `aria-disabled:opacity-60` instead of `disabled` while pending, and submit returns early if it is already pending. A disabled button drops focus to `<body>`; this one keeps it. Browser: focus the button, press Enter, no match → `document.activeElement` is still the "Find my order" button, and the error is announced. |
| **RQA28-04:** 44 px targets | `find-form.tsx` ("call us"), `src/components/shop/save-link.tsx` ("Find your order") | Vertical padding on the inline link (`py-[13px]` and `py-[14px]`) makes the tap area taller without moving the text; the line layout is unchanged. Browser: "call us" 44 px, "Find your order" 45 px. |
| **RQA28-05:** stale live region | `src/components/shop/cart-provider.tsx` | The announcement clears 7 s after it is set (it only clears if it is still the same announcement) and on every route change (`usePathname`). |
| **RQA28-06:** cancelled pickup | `order/[token]/page.tsx` | On a cancelled pickup, "Collect from" and Directions are hidden. **Beyond the brief:** the "Ready around …" row is hidden too, since a cancelled order is never ready. Browser at 320 and 375: the card shows only Pay. |
| **RQA28-07:** step 1 time | `order/[token]/page.tsx` | The created time under step 1 appears only when step 1 is not the active step. While it is active, its "In progress · since 23:28" line already gives the time. Browser: one time on a new order; a cancelled order shows "23:28" under step 1. |
| **RQA28-08:** `check_cart` cap | `supabase/migrations/20261112000000_customer_flow.sql`, `tests/db/customer-flow.test.ts` | Keeps the quantity asked for. When the line is otherwise `ok` but more than 20 was asked, the state is `capped`, with the quantity lowered to 20. Plate-limit states still win. New test: a regular dish 25 → `capped`/20, and 20 → `ok`/20; a dish with 3 plates left, 25 → `capped`/3, `plates_left` 3. |

## Checks
- `bun run typecheck`, `bun run lint`, `bun run build`: pass (`/tmp/dev-implementor-fix28-{typecheck,lint,build}.log`).
- `DEV_STACK_REPO=<this worktree> $D reset`: done; the stack is on this schema.
- `TEST_DATABASE_URL=… bun run test`: **407 pass, 4 skip, 1 fail**.
  - The 4 skips are time-gated opening-hours tests.
  - The 1 fail is `tests/db/history.test.ts` › close early, which raises "already closed for today". The run was at about 23:20 Nairobi time, after closing. It is the same clock-dependent test as in the 2.12 round: it has no `skipIf(!midDay)` guard like its neighbours. Not touched here; it should pass in a daytime run.
- **Contact sheet:** `/private/tmp/claude-503/-Users-tevin-Developer-cash-dausis-plate/41018164-7d53-454e-ba38-33aac3fef038/scratchpad/shots/sheet-fix28.png`. It covers Find my order (no match), a cancelled pickup, a new pickup, and the menu and dish page with the long word, each at 320 and 375. The 1024 and 1280 menu and dish shots are beside it (`fix28-{menu,dish}-{1024,1280}.png`).
- Test data was put back: the dish name and description are back to the seed values. The two test orders stay on the local stack.

## Open: the buy bar at 320 (needs a design decision)
On the dish page at 320, the submit button sticks out past the bar's right edge: by 18 px for "Add to order" and 23 px for "Save to order". This happens with **normal** data, not only long words. It is the clipped bar QA saw in RQA28-02; it remains now that the page no longer scrolls sideways.
- The row cannot fit: 280 px is available. The stepper needs at least 160 px (two 44 px buttons plus "20 plates" at 72 px). The label needs 135 px or more to stay on one line.
- Letting the label wrap gives a three-line, 86 px button.

The options are layout choices, so they go to dev.designer:
- (a) **Recommended:** below about 360 px, stack the stepper above a full-width button. Targets stay at 48 px and the label stays on one line.
- (b) Use a shorter label at narrow widths.
- (c) Use a smaller stepper. This doesn't fit on its own.

Nothing was changed for this.

## Not verified
- **Live region in the browser (RQA28-05):** the kitchen was closed during the run, so the menu had no add buttons and no announcement could be triggered. The region is empty on load. The clear-on-timeout and clear-on-route-change behaviour is checked from the code only.
- **The cart-line long name, in the browser:** same reason. The cart needs an add. The class is the same one proven on the menu and dish page.

## Noted, not changed
- On a cancelled pickup, the Pay row still reads "When you collect, cash or M-Pesa". The header already says "You haven't been charged". Whether the Pay row should go too is a question for dev.designer.

Motion: none added or changed.

Skills used: mobile-native — targets measured (call us 44, Find your order 45), focus kept on keyboard submit, no sideways scroll at 320/375; found the 320 buy-bar overflow above; break-ui — 80-char unbroken name and description at 320/375/1024/1280 on the menu and dish page now wrap; worst-case quantity (25) on `check_cart` now returns capped.

## Follow-up from dev.designer (20:38Z), built 20:49Z onwards
| Item | File | What |
|---|---|---|
| Buy bar below 360 px | `src/components/shop/dish-form.tsx`, `src/app/(shop)/dish/[id]/page.tsx` | Below 360 px (`max-[360px]:`, which Tailwind v4 compiles to `width < 360px`; `max-[359px]` would have left 359 on one row) the row becomes a column with an 8 px gap. Row 1 is the stepper at full width (`justify-between`, so minus is on the left, the count in the middle, plus on the right; 48 px buttons as before). Row 2 is the button at full width: 48 px, one line, label unchanged. From 360 px it's one row as before. The dish page's bottom padding is 196 px below 360 (140 px from 360). No motion. |
| Cancelled pickup | `src/app/(shop)/order/[token]/page.tsx` | The Pay row is hidden too. With no rows left, the "Pickup" card isn't rendered. Other modes and states are unchanged: a new pickup still shows the card with Pay. |

**Browser** (dish page scrolled to the bottom, worktree on 3020):

| Width | scrollWidth | Bar | Button (left–right, height) | Content ends / bar top |
|---|---|---|---|---|
| 320 | 320 | two rows | 20–300, 48 | 616 / 652 |
| 359 | 359 | two rows | 20–339, 48 | 616 / 652 |
| 360 | 360 | one row | 200–343, 64 (wraps before the price, as designed) | 672 / 692 |
| 375 | 375 | one row | 200–355, 64 | 672 / 692 |

- **At 360** the one-row button ends at 343 px, 3 px past the 20 px side gutter's inner edge. That's inside the screen with no sideways scroll, and it matches the "from 360 it stays one row" rule. Noting it only.
- **Cancelled pickup**, at 320 and 375: no Pickup card and no "When you collect" text, no sideways scroll. **New pickup:** the card and Pay row are still there.
- **Contact sheet:** `/private/tmp/claude-503/-Users-tevin-Developer-cash-dausis-plate/41018164-7d53-454e-ba38-33aac3fef038/scratchpad/shots/sheet-fix28b.png`.

**Checks:**
- typecheck, lint and build: pass (`/tmp/dev-implementor-fix28b-*.log`).
- Tests: **406 pass, 4 skip, 2 fail**. Both failures depend on the clock; the run was at 23:55 Nairobi time:
  - history close-early ("already closed for today"), as before;
  - `order-safety` › "accepts a later time", which asks for a pickup a few minutes from now and is past midnight closing ("We close at midnight").
- No SQL and no tests changed this round. The 2.8 dev server on 3020 was stopped for the build and not restarted.

Skills used: mobile-native — 48 px targets kept in both layouts, bar padding and safe-area padding unchanged, no sideways scroll and nothing under the bar at 320/359/360/375; break-ui — the boundary widths 359 and 360 on both sides of the switch.
