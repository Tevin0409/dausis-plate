# 2.11 ads and promos: implementation report (dev.implementor)

*2026-11-15.*

## What this covers

- **Branch:** `feature/ads-promos`, in the worktree `../dausis-plate-worktrees/dev-implementor-2.11-ads-promos`.
- **Specs:** `docs/plans/launch/spec-2.11-ads-promos.md`, and spec-2.12's "Promos & ads" part.
- **Build plan:** `docs/plans/launch/plan-2.11-build.md`.
- **Base:** `chore/wave-2-integration` at `e9c1a72`, merged in as `40729d9`. Everything for 2.11 is uncommitted in the worktree. It gets committed after QA passes, under the standing rule.

**Size.** 36 changed files (+1161/−126) against e9c1a72, plus 33 new files: 5 migrations, 6 test files, 1 script and the source files below.

## What was built

### A. Neighbour ads and Mama's picks
- **Schema:** `20261117000000_ads_and_picks.sql` covers:
  - the ads table;
  - one `ad_action` RPC, which approves, pauses, resumes and ends an ad;
  - `live_ads()`;
  - daily view and tap counts;
  - `dishes.is_pick`.
- **Owner:** the Promos page has two tabs.
  - **Neighbour ads:** one card per space, the ad sheet (420 px panel or phone sheet) and the history.
  - **Your promos:** picks, combos and codes.
- **Customer:**
  - the "From our neighbours" card, after Mains and at the very end of the order page;
  - views are counted at `/api/ads/view`;
  - taps go through `/a/[id]`, which counts the tap and then redirects; an ended ad gets a plain "This offer has ended" page.
  - the Mama's pick pill.

### B. Combos
- **Schema:** `20261117000100_combos.sql` (`save_combo`, `customer_combos()`) and `…0300_promo_orders.sql` (`order_combos` and `place_order` combo parts).
- **Owner:** the combos card and sheet. Pricing is refused at or above the everyday price.
- **Customer:**
  - the combo card on the menu;
  - the `/combo/[id]` page;
  - cart lines;
  - the board ticket shows the combo with its dishes.

### C. Discount codes
- **Schema:** `20261117000200_discount_codes.sql`:
  - codes, with refusal reasons and a lock once a code is used;
  - `check_discount_code`;
  - once per phone through `phone_key`.
- **Ordering:** `place_order` reprices the discount from the database. It covers dishes only, never combos or the delivery fee.
- **Customer:**
  - the cart code row: chip, held-amber state and Discount line;
  - checkout: "can't be used" note plus "Place without the code".

### Reports (spec-2.12 and Tevin's Food A)
`20261117000400_promo_reports.sql` adds:
- **Food A:** a Discounts column after Food in the Sales table, in Delivery by area and in the CSV. Food − Discounts + Fees = Sales.
- **Order sheet:** a combo row with its dishes indented, and "Discount (CODE) −KSh n" before Total.
- **Orders CSV:** Discount and Code columns; the items list the combo with its dishes.
- **The "Promos & ads" tab:**
  - Codes table: Code · Uses · Discount given · Sales with the code. Unused codes show 0; a switched-off code is marked "Off".
  - Combos table: Combo · Sold · Revenue.
  - "Ads, for invoicing" table: Advertiser · Space · Runs · Views · Taps · Tap rate, with the This period / Each ad's whole run choice, "Ignoring the period above", the fair-guide note, a dash under 50 views, and ads with no views left out.

## Checks, all run after the last change

| Check | Result |
|---|---|
| `bun run typecheck` | clean |
| `bun run lint` | clean |
| `bun test` (unit and the db tests on `dausis_test`) | **602 pass, 0 fail** |
| `bun run build` | clean |
| `DEV_STACK_REPO=<worktree> $D reset` | clean; every seeded order adds up (mismatch 0) |
| `scripts/check-promo-races.ts` (two real connections) | PASS on all three: the last use of a code, a combo's last plate, and two overlapping ads approved at once. Rows are cleaned up. |

Logs are `/tmp/dev-implementor-2.11-{test,build,races,lint,tc}.log`.

## Screenshots

They're in `/private/tmp/claude-503/-Users-tevin-Developer-cash-dausis-plate/41018164-7d53-454e-ba38-33aac3fef038/scratchpad/shots/`.

**Final set, `fin211/`:**
- `menu-*`, `combo-*`, `promos-*`, `rpromos-*` and `rsales-*` at 320, 375, 768 and 1280;
- `promos-yours-375/1280`;
- `cart-empty-code-375`;
- the `rpromos-320/375-fix` crops;
- `break-rpromos-*`: worst-case data, described under Skills.

**Earlier, still valid:**
- A: `a211-*`, covering the ad sheet, menu and order-page ads, and picks;
- B: `b-*`, the combos sheet and card;
- C: `c-*`, covering the cart code, refusal, checkout, combo page and board ticket;
- Reports: `r-sheet-code-1280`, `r-sheet-combo-1280`, `r-sales-table-1280`, `r-delivery-table-1280`, `r-promos-*`, `r-ratings-after-merge-1280` and `r-dishes-after-merge-1280`.

## Fixed in this last pass

1. **320 px: the ad figures choice overflowed its card.** Only "Each ad's whole run" now wraps, inside its 44 px height (`src/components/reports/controls.tsx:20`).
2. **The cart's code reason was wrong.** With nothing orderable in the cart (it was emptied, or every line is off today's menu), the code chip said "Codes don't apply to combos" even with no combo. It now says "Add a dish to use CODE" (`src/lib/discount-words.ts:48`). That's new copy and provisional.
3. **Ad runs in another year showed no year.** "Sat 11 Oct – Fri 31 Oct" now reads "… 2025" when the run isn't all in this year, using the same rule as the period label. The helpers moved to `src/lib/reports/promos.ts`, with unit tests.

## Deviations and flags for QA and orch.lead

**Technical choices**
- Ads have one `ad_action` RPC rather than four. `live_ads` and `customer_combos` are functions, not views. Taps go through the `/a/[id]` route, and a `tel:` link's tap is counted there too.
- The ad sheet is 420 px. The logo preview shows after saving.
- Combos and codes are written only through RPCs. Combos may include everyday dishes.
- The migrations were renamed to 20261117* so they run after wave 2's 20261116*; orch.lead accepted this.
- There's no `order_line_check`. `order_items.quantity` goes up to 80, because a combo part is per × combo quantity. `order_combos.quantity` stays at 1–20.
- `check_cart`'s part ordering can over-reserve plates when one dish appears both on its own and inside a combo. It errs on the safe side.
- `orders.discount_code` keeps the code as text, so reports survive a deleted code.

**Customer behaviour**
- A code is locked once it's been used. The copy "Not on combos or the delivery fee" is used.
- The cart button total shows food − discount.
- Checkout shows the reason of any held code. After a refusal the summary drops the discount. Enter means "Place without the code".
- Combo dishes show their quantity per combo.

**Reports**
- The whole-run ads list includes every ad with views, not only those running in the period.
- The Discounts column shows "−n". The CSV discount is a positive number.
- The promos tab has no CSV export; the spec lists none.

**Copy**
- Provisional: the /combo page, the Codes and Combos card notes and empty texts, and "Add a dish to use CODE".

**Seed**
- The seed adds promo sample data: KARIBU10, PICKUP50, WELCOME (off), "Stew & chai lunch", and two ads.
- Sunrise Bakery is the menu ad and has ended, so **no ad shows on the menu** with seed data.
- Mama Mboga Greens is the live order-page ad, so QA will see it on order pages.

**Not verified locally**
- R2 (logo upload uses the stub), Realtime and real devices.

## Skills used

**impeccable critique**
- Two isolated subagents; the snapshot is not persisted, because `.impeccable/` isn't git-ignored and would add a stray file.
- **29/40 (Good).** The customer side is product-specific; the owner side is a competent but generic card grid.
- A's checkout P1 ("loses the reason") is wrong: the reason shows ("it isn't on right now", see `c-checkout-code-refused-375`), and "Back to cart" is there.
- Its remaining points are spec or business questions, not build defects:
  - a fee or amount due on the ads invoice table;
  - a "Try another code" button beside "Place without the code";
  - guidance in the empty ad space;
  - stacking the combo-card plates under 400 px;
  - chips for code limits.

**impeccable audit: 15/20 (Good).**

| Dimension | Score | Notes |
|---|---|---|
| Accessibility | 3 | Captions on all three tables. The run choice is a `role=group` with `aria-current`. "Off" is shown in words. Alerts use `role=alert/status`. |
| Performance | 3 | |
| Responsive | 3 | Tables scroll inside their cards with a "Swipe for more" cue at 320. |
| Theming | 3 | Light only, by design. The `/a` ended page is standalone HTML, with hard-coded colours that match the tokens. The cool-grey photo dropzone (`photo-upload.tsx:99`) is an existing P3; it was already in e9c1a72. |
| Integrity | 3 | |

**Detector**
- 25 CLI advisories, all font sizes (12/17/21/22/26/30/34). Every value is already used elsewhere in the app, so it's an existing ad-hoc scale, not new drift.
- In the browser: `edge-flush-cards` is a false positive (the sticky first column of the table). `nested-cards` is the ad preview inside its space card, which the spec asks for.

**review-animations: Approve.**
- Only the spec's Motion rows are built:
  - the code chip and Discount line: `.code-in`, 4 px rise plus fade, `--dur-small`/`--ease-out`;
  - the error and "can't be used" notes: `.fade-in`, opacity only;
  - shared `.press` feedback;
  - the existing sheets.
- Transitions are interruptible, with no `transition: all`, nothing on ads or totals, and reduced motion keeps the fade with no rise.
- One P3: `DiscountLine` also fades in when the cart or checkout page first renders, not only when a code is applied. It's 180 ms of opacity and 4 px; I left it alone.

**break-ui**
- Worst case at the schema limits:
  - a 32-character advertiser;
  - a 20-character code (KARIBUNAIROBIDEC2026);
  - a 40-character combo name;
  - 20 combos at KSh 12,500;
  - 1,284,321 views and 40,567 taps;
  - an ad run a year ago.
- Everything holds at 1280 and 320 (tables scroll in their cards). The one break, the missing year, is fixed (above).
- The test rows are removed and the order is restored.

**mobile-native**
- The code input is 16 px, with `autoCapitalize=characters`, autocorrect and spellcheck off, and `enterKeyHint=go`.
- Controls have press feedback, `touch-manipulation` and `select-none`. No new hover, and no `100vh`.
- The sheets reuse `PlannerSheet` (safe area and overscroll).
- A real phone is not tested.

**animate**
- Built the spec's Motion rows with the tokens. No extra motion.

## For QA

- **Depth:** one round over A, B and C. Standard for A and B, deep for C (codes).
- **Ports:** dev.qa uses its own port, 3030. Run `DEV_STACK_REPO=<worktree> $D reset` first if the stack holds other data.
- **Race proof:** run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/dausis_test bun scripts/check-promo-races.ts`.

---

## Fix round (fix-2.11.md), 2026-11-15

The fixes are made in place in the uncommitted 2.11 migrations. They haven't landed anywhere, so there's no new migration file. Any database that has already applied the five 20261117* migrations (r1's slot 7, the QA slots) needs a reset or a reapply.

| Item | Fix | Proof |
|---|---|---|
| **R211-01** | In `guard_ads` (`20261117000000_ads_and_picks.sql`), a later `ends_on` on an approved, unpaused, not-ended ad now takes `lock_ad_space` and then runs `ad_overlap_check`. It gives the spec's message, and `detail` is `ad_overlap`. Shortening the run, or editing a draft or a paused ad, isn't checked here, because approve and resume already check. The owner save action shows the refusal under the dates (`actions.ts`). | `ads.test.ts`, "a later end date can't run into another approved ad". The race script has a new case 4, the end-date edit against an approval, run each way round: PASS. |
| **R211-02** | A new private `combo_settle` function (`20261117000300_promo_orders.sql`). In `check_cart`, when one combo's parts are done, it keeps only `whole combos × per` plates for each part. If any part is out, that's 0. This happens before the next combo's parts are checked. | Two tests in `promo-orders.test.ts`. The first is r1's repro: C1 (2A+B ×2) is capped to 1 and C2 (A+B) is ok, and place_order takes that cart at KSh 1,400. The second covers an unavailable part giving back its plates, and a dish line of A plus a capped combo leaving the next combo sold out. |
| **RQA211-01** | `DishRow` shows the "Mama's pick" pill above the name. | `fix211/row-pick-375.png` |
| **RQA211-02** | Every whitespace character is stripped when a code is matched: in `check_discount_code` and `place_order` (`regexp_replace(…, '\s', '', 'g')`), in the cart's `applyCode` and in `checkCode`. | `promo-orders.test.ts`, "a code typed with spaces…": `" big 5\t00 "` gives BIG500. In the browser, "karibu 10" applied as KARIBU10 (`fix211/cart-chip-375.png`). |
| **Design 1** | Four copy edits: the combo sheet subtitle, "Every dish is already in this combo.", "The same dish twice counts." and Limits "No limits". | — |
| **Design 2** | `/combo` with nothing to choose: the form is `display: contents` and empty parts aren't rendered, so the stepper and Add follow the hero directly. | `fix211/combo-nochoice-375.png` and `-1280.png` |
| **Design 3** | The chip's text column is now `basis-24`. At 375 the amount and Remove stay on the first line. At 320 the 20-letter code wraps cleanly, with no horizontal scroll (scrollWidth 320). | `fix211/cart-chip-375.png` and `cart-chip-long-320.png` |
| **Design 4** | The cart context has `codeFresh`. It turns on when a code is applied and goes off after 1 s or on Remove. The chip and DiscountLine add `code-in` only while it's on. | Timed in the browser: both get `code-in` at 82 ms after Apply and lose it at about 1,080 ms. On reload and on checkout: 0 elements. |

Shots: `/private/tmp/claude-503/-Users-tevin-Developer-cash-dausis-plate/41018164-7d53-454e-ba38-33aac3fef038/scratchpad/shots/fix211/`.

**Checks after the fix round:**
- Typecheck: 0. Lint: 0.
- `bun run test`: **606 pass, 0 fail**.
- **The new tests fail without the fixes.** With both fixes switched off, the three new R211 tests fail. With the fixes back, they pass.
- Race script: 5/5 PASS, and the cleanup removed its rows.
- `bun run build`: 0.
- Slot 0 reset (`DEV_STACK_REPO=<worktree> $D reset`): 0. The temporary pick and long code used for the screenshots are removed again.

**Not changed:**
- RQA211-03 and the general over-reserve flag, per fix-2.11.
- The four questions waiting on Tevin.

## Follow-up: cancelled-only codes are editable (Tevin 2A, 2026-11-15)
- New migration `20261117000500_code_lock_live_uses.sql`. `save_discount_code` and the `discount_codes_guard` trigger now lock what a code gives only when an order that isn't cancelled used it. That's the same count as `discount_code_uses`, `code_figures` and the Promos screen, which already showed such a code as unlocked. A cancelled order is final (`guard_order_status`), and `place_order` and `save_discount_code` both lock the code row, so an edit and a new use can't overlap.
- The refusal now says "Used 1 time" instead of "Used 1 times".
- Tests in `tests/db/discount-codes.test.ts`: cancelled-only is editable through the save and directly; one live use beside a cancelled one stays locked; an edit refused while the order is live goes through after it's cancelled, and the cancelled order keeps its saving. All three failed on the old lock.
- Checks: 609 pass, 0 fail; typecheck, lint, build and the race script pass; slot 0 reset is clean.
