# Name limit and tile wrap (step 3 break-ui follow-ups), dev.designer, 2026-11-15

Branch `fix/name-limit-and-tile-wrap` from 5d51059. Uncommitted, for review.

## 1. Special tile names at large text (break-ui #1)
**Call: stack, driven by the text size.** When the tile is narrower than 17em, the 150 px plate moves above the name, at 132 px. It still bleeds off the same edge (right, or left on flipped tiles), and the name gets the full tile width. The em is measured against the tile list's own font size, so the stacking follows the reader's text size or zoom, not the device.
- 100% text: every width keeps today's side layout. At 320 px the tile is 288 px against a 272 px breakpoint. Unchanged at 375 and 1280.
- 150% and 200% text: the tile stacks at 320, 375 and 1280.
- The name column at 375 and 200% grows from about 150 px to 275 px. "Coastal Coconut Fish Curry…" and "Mukimo & Beef Fry" now break only between words.
- Week tiles are untouched: their plate is 76 px, which leaves room.
- Hyphens were rejected. Swahili dish words aren't in the browser's hyphenation dictionary, and "Coco-nut" reads worse than a whole word on the next line.
- Shrinking the plate alone was rejected, because it still left about 200 px for a 48 px heading.

Files:
- `src/app/globals.css`: `.dish-tiles` container and `@container (width < 17em)`. Plain unlayered CSS, so it overrides the tile's utilities without `!important`.
- `src/components/shop/menu/dish-cards.tsx`: `dish-tile-special`, `is-flip` and `dish-tile-plate` hooks.
- `src/components/shop/menu/menu-view.tsx`: `dish-tiles` on the list.

No motion.

**Residual (edge case):** a 10-letter word ("Kachumbari") at 320 px and 200% text still splits ("Kachumb/ari"). The tile is already full width there, with a 220 px column for a 48 px heading. The only remedy is to cap the name's size below what the reader asked for, which I don't recommend: it works against 1.4.4 Resize Text. The `overflow-wrap:anywhere` fallback keeps it readable. Evidence: `tile-320-200-longword.png`.

## 2. Dish name length in the database (break-ui #2)
- Migration `supabase/migrations/20261116100500_dish_name_length.sql` adds `dishes_name_length check (char_length(name) <= 80)`. That matches the editor's `maxLength={80}` and the trimmed `.max(80)` in `dashboard/actions.ts`. JavaScript counts UTF-16 units, which is never fewer than Postgres characters, so the database never refuses a name the editor accepts.
- Preflight `supabase/preflight/name-limit.sql` is read-only. It lists names over 80, archived ones included. On slot 1 it returns 0 rows.
- Test `tests/db/dish-name-length.test.ts`: 80 characters with an accent are kept; 81 are refused (23514) on insert and on rename.

## Checks (slot 1, port 3010)
- `dev-stack.sh reset` applies the new migration.
- Tests: 539 pass, 0 fail.
- Typecheck, lint and build all pass.

Evidence is in `evidence-name-limit/`:
- `sheet.png`: 320 / 375 / 1280 at 100 / 150 / 200% text;
- `tile-375-200-flip.png`;
- `tile-320-200-longword.png`.

Not verified: a real phone's text-size setting (iOS aA zoom, Android text scaling). It was checked through a raised root font size in desktop Chrome.
