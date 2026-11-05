---
name: Dausis Plate
description: Mama's Flavour. A kitchen's daily menu on warm cream, where every dish is a plate.
colors:
  teal-deep: "#006b66"
  teal-deeper: "#004e4a"
  teal: "#009e96"
  teal-tint: "#e6f6f5"
  on-teal-soft: "#d4ecea"
  coral: "#e56b6f"
  coral-text: "#b4474b"
  coral-ink: "#8a3a3d"
  blush: "#fbe8e6"
  blush-deep: "#f3d3cf"
  pink: "#e99d99"
  cream: "#fbf7f1"
  paper: "#ffffff"
  sand: "#ece5da"
  sand-deep: "#d9d2c7"
  field: "#8c8478"
  ink: "#1a202c"
  ink-soft: "#4a5568"
  amber-tint: "#fef3c7"
  amber-ink: "#78350f"
  amber: "#b45309"
typography:
  display-xl:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.05
  display-lg:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.1
  display-md:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.12
  display-sm:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.15
  script:
    fontFamily: "Parisienne, Snell Roundhand, cursive"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.15
  body-lg:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "10px"
  md: "16px"
  lg: "24px"
  sheet: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.teal-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.teal-deeper}"
  button-primary-disabled:
    backgroundColor: "{colors.sand-deep}"
    textColor: "{colors.ink-soft}"
  button-quiet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.coral-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "48px"
  tile:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "48px"
  pill-pick:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.coral-ink}"
    rounded: "{rounded.pill}"
  pill-plates:
    backgroundColor: "{colors.teal-tint}"
    textColor: "{colors.teal-deeper}"
    rounded: "{rounded.pill}"
  pill-low:
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.pill}"
---

# Design System: Dausis Plate

## Overview

**Creative North Star: "Mama's table"**

Warm cream is the table, white tiles are what's set on it, and every dish is a round plate. A teal band greets you at the top and then gets out of the way. The size of a plate tells you how much it matters today: big for today's dishes, medium for this week, small for every day.

The shop and the dashboard share one palette and one set of parts. The shop can be warm and tactile. The dashboard is calmer and denser, because it gets read under pressure. Both use the same cream, ink, teal and pill-shaped buttons.

**Key characteristics**
- Finished with no photos. The brand's fork and spoon stand in on every plate.
- Nothing on the menu is hidden sideways.
- Mama's voice in plain words, with script reserved for greetings.
- Motion you feel rather than watch.

**Decided against** (Tevin, 2026-11-05): a dark slate theme, sideways rows, and a separate row for Mama's picks.

## Colors

The palette comes from `src/app/globals.css`, which stays the source. Contrast figures are calculated from the hex values.

### Primary: teal, for actions and the brand
- **Deep teal** (#006b66): main buttons, the header band, the dashboard rail, selected states. White on it is 6.37:1.
- **Deeper teal** (#004e4a): pressed and hover states, the closed notice, table request strips, text on tints. White on it is 9.6:1.
- **Brand teal** (#009e96): graphics only (plate ring, chart bars, focus ring). White on it is 3.32:1, so it never carries text.
- **Teal tint** (#e6f6f5): quiet positive surfaces: plates-left pill, the active jump link, combo card, saved-order note. Deeper teal on it is 8.62:1.
- **On-teal soft** (#d4ecea): secondary text on the band and rail, 5.16:1 on deep teal.

### Secondary: coral, for Mama's own touch and for serious actions
- **Blush** (#fbe8e6) and **coral ink** (#8a3a3d): the Mama's pick pill, the New column, the owner-only tag and danger cards, at 6.46:1. White on coral ink is 7.63:1, for Decline and Close now.
- **Coral text** (#b4474b): small coral text on cream or white, at 4.99:1 or better.
- **Coral** (#e56b6f): graphics only (current order step, busy-hours bars).
- **Blush on deep teal** (#fbe8e6): script on the band, 5.4:1.
- **Pink** (#e99d99) and **blush deep** (#f3d3cf): plate centres and quiet borders.

**Changed:** `globals.css` limits coral and blush to rotating dishes. In this design they also mark the things that need Mama's or the kitchen's attention. Picks can be everyday dishes, so the old limit no longer fits.

### Tertiary: amber, for "watch this"
- **Amber tint** (#fef3c7) with **amber ink** (#78350f), 8.15:1: low plates, not paid yet, order notes, delivery minimum not met, dish not on the next menu.
- **Amber** (#b45309): graphics only (stars, the progress bar).

### Neutral: one warm set for shop and dashboard
- **Cream** (#fbf7f1): the page, sheets and panels.
- **Paper** (#ffffff): tiles, lists, tickets, inputs.
- **Sand** (#ece5da): lines between rows, track backgrounds, quiet tags.
- **Sand deep** (#d9d2c7): quiet button rings, disabled fill (ink soft on it is 5.01:1).
- **Field** (#8c8478): input borders, 3.69:1 on white.
- **Ink** (#1a202c): main text, 15.29:1 on cream. **Ink soft** (#4a5568): secondary text, 7.05:1 on cream.

**Removed:** `mist`, `line` and `line-deep`, the cool greys in today's dashboard, and the hard-coded `#eef2f6` and `#f8fafc`. **Added:** `paper`, `field` and `on-teal-soft`.

### Rules
- Colour never carries meaning alone. Every state also has words or an icon.
- Text uses the ink and "text" colours. `teal`, `coral` and `amber` are never text.
- Light theme only. Colours are not re-scoped for dark mode.

## Typography

**Display:** DM Serif Display. **Interface:** DM Sans. **Script:** Parisienne.

| Role | Font and size | Used for |
|---|---|---|
| display-xl | Serif 32 | Day name in the band, dashboard page titles, status headline (30) |
| display-lg | Serif 28 | Sheet titles and dish name in the sheet |
| display-md | Serif 24 | Today's dish names, menu section heads |
| display-sm | Serif 20–22 | This week's dish names, card titles, combo name |
| script | Parisienne 28–34 | Karibu and Asante only, and 17 for the "Mama's Flavour." line |
| body-lg | Sans 16 | Everyday dish names (600), ticket food lines (600), inputs |
| body | Sans 15 | Default text and buttons (600) |
| body-sm | Sans 14 | Descriptions, notes, hints |
| label | Sans 13 / 12.5 | Pills, meta, age of an order, all at 600 or more |

**Rules**
- Inputs are never below 16 px, because iOS zooms the page otherwise.
- Prices, counts and order codes use tabular figures.
- Script is never below 17 px and never for information someone needs.
- One script greeting per screen, in the band. No script labels above section headings.
- Ticket food lines are 16/600. They are what the kitchen reads first.

## Layout

**Customer (375 px first, centred column up to 430 px on larger screens)**
- Page gutter 16 px for tiles and lists, 20 px for section heads and the band.
- Menu order: band, jump bar, today's dishes, combo, this week, mains, one ad (dine-in and pickup only), sides, drinks, cart bar.
- 22 px above a section, 10 px under its head, 12 px between today's tiles.
- Safe areas: pad the band, cart bar and sheet footers with `env(safe-area-inset-*)`, and set `viewport-fit=cover`. Use `dvh` for sheet hosts. `theme-color` is `#006b66`, to match the band.
- Phone baseline (`mobile-native`): `interactive-widget=resizes-content` in the viewport tag, no tap highlight, `touch-action: manipulation` on controls, `user-select: none` on controls only, zoom never disabled.

**Measured menu length** at 375 px, dine-in, on the 10-dish sample menu: **2,261 px, against 2,917 px for Plates, 22% shorter.** With photos on it stays 2,261 px, against 3,023 px, 25% shorter, because plates keep their size. Delivery has no ad, at 2,071 px.

**Dashboard**
- **1280:** 96 px rail, 28 px page padding, a four-column board, 7-day planner.
- **768:** bottom tab bar, 20 px padding, planner as one row per day. The board has two columns: New is always on screen, and the second column switches between Cooking, Ready, On the way and Done.
- Nothing in the dashboard shrinks below a 44 px target. The tablet layout is fixed, not a scaled desktop.

## Elevation & Depth

Lifted, softly. Plates and tiles rest on the table; sheets come up from below it.

- `--shadow-card: 0 1px 2px rgba(26,32,44,.06), 0 4px 14px rgba(26,32,44,.05)`: tiles, lists, tickets.
- `--shadow-plate: 0 6px 16px rgba(0,78,74,.16)`: the plate.
- **Photo plate on cream:** `0 12px 14px -9px rgba(40,22,8,.5), 0 2px 4px rgba(40,22,8,.16)`, a contact shadow so it sits on the surface.
- **Sheet:** `0 -10px 30px rgba(0,0,0,.18)` over a scrim of `rgba(0,40,38,.42)`. Dashboard panel scrim `.35`.
- **Cart bar:** `0 8px 20px rgba(0,78,74,.28)`.
- No nested cards. A ticket sits straight on cream, not inside a column card.

## Shapes

- `--r-sm` 10 px: inputs, small inner blocks, ad logo.
- `--r-md` 16 px: notes, tickets, request strips, nav items.
- `--r-lg` 24 px: tiles, lists, cards.
- 28 px: top corners of sheets and the bottom corners of the band.
- `--r-pill`: buttons, chips, pills, the jump bar's links.
- **The plate is the one true circle:** a teal ring at 13.5% inset, a white rim, then the centre.
- No coloured stripes on a card's edge, on either side or the top.

## Components

Built with Tailwind v4 tokens from `globals.css` and the components in `src/components`. No new UI library is needed so far.

**Plate.** Sizes follow importance: today 150, dish sheet 160, this week 76, every day 60, cart 60, dashboard list 44, planner 30. Without a photo the centre shows the brand's fork and spoon (never initials) on one of four tints: pink, blush deep, teal tint, amber tint. Sold out is greyscale at 55% opacity, always with the words "Sold out".

**Today tile.** Paper, `--r-lg`. The plate sits half off the tile's edge and alternates sides. Shows the pills, name, full description, rating, serving hours, price and add button.

**Dish row.** One white list per section, sand lines between rows, minimum 84 px tall. Plate, name, price and rating, then pills (Mama's pick first), then add. Mama's picks come first in their section and sold-out dishes last.

**Mama's pick.** A blush pill on the dish, no separate row. It's the only mark.

**Jump bar.** Sticky below the band, cream with a 1 px sand line, 44 px links. The active link is deeper teal on teal tint and changes instantly. Tapping a link jumps with no smooth scroll.

**Add button.** 48 px teal-deep circle, plus icon at stroke 2.4, turning to a check for 900 ms on brand teal. It works the same while closed, adding to the saved order.

**Cart bar.** Sticky, 56 px pill, count, label, total. Open: "View order". Closed: "Your saved order". It always opens the cart.

**Sheet.** Cream, grabber, close button of 44 px, body scrolls with `overscroll-behavior: contain`, footer with a primary action. See Motion for the gesture.

**Menu, closed kitchen** (Tevin, 2026-11-05).
- It shows the next open day's menu, titled "Friday's menu", in display-xl, under a notice: "Closed now. Opens tomorrow (Friday) at 11:00. Add dishes now, order when we open."
- The first jump link names the day. Nothing shows as sold out, because plate counts start fresh; pills say "30 plates for Friday".
- Add buttons, the dish sheet and combos all add to the saved order. The sheet's button says "Save · KSh 600", and serving hours name the day.
- If that day isn't planned, it shows everyday dishes and combos under a teal-tint note: "Friday's specials aren't up yet. Everyday dishes are below." The Today and This week jump links go.

**Saved cart, closed kitchen.**
- A teal-tint note under the title: "We're closed. Opens tomorrow (Friday) at 11:00. Your order is saved here. Add to it or change it now, and place it when we open. Plates aren't held until then."
- Steppers, remove, undo and the code field all work.
- The main button is disabled and says "Order from 11:00 tomorrow · KSh 1,520", so the total stays in view.

**Recheck against the next menu.**
- It runs by itself while closed, and again when placing, because the menu or plate counts can change after a dish is added.
- An amber note says how many dishes aren't on that day's menu and gives the new total. If the kitchen is also closed, the closed note shrinks to its first line plus "Plates aren't held until then."
- The line stays visible, greyed, with a "Not on Friday's menu" pill and a Remove button, and leaves the total. Remove has Undo.
- Everything else stays, so the customer can still check out without removing it. If nothing is left, the button is disabled and the cart shows the empty state.

**Ticket (order board).** Paper on cream, oldest first in each column. Code, age, name, type tag, food lines at 16/600, then total and payment, then the main action.
- **What the customer chose** sits under each food line: the side in ink soft, the customer's note in amber ink. `order_items` already stores `option_label` and `note`. An amber block holds notes about the whole order, such as a gate code.
- **Age** stands out in an amber pill at 15 minutes (Tevin, 2026-11-05), to be reviewed after Mama's first busy week.
- **The main action** takes the full ticket width (244 × 48 px at 1280; in Plates, Accept was 80 × 48 px beside a 100 × 48 px Mark paid).
- **Mark paid** sits by the money, above the main action and away from it (100 × 44 px). Decline sits below on its own line and opens the reason list inside the ticket.
- **Order type** is one neutral sand tag with an icon. Colour is kept for status, so a tag never looks like a column.
- **Same words as the customer:** dine-in ends in Served, pickup in Collected, delivery in Delivered.
- **Undo** (Tevin, 2026-11-05): 5 seconds to undo Mark paid or a move to the next column. The customer is told nothing until it has passed. Decline has no undo, and Cancelled stays final.

**Column heads.** New blush, Cooking amber tint, Ready teal tint, On the way sand, Done paper with a sand ring. No accent borders. New has the most colour on purpose.

**Table request strip.** Deeper teal, white text, one 44 px Done button.

**Fields.** 48 px, 1.5 px field border, focus border deep teal with a 3 px teal ring. Hints 13 px; errors 14/600 coral ink, naming the problem and the fix.

**Chip, segmented control, switch, stepper, side panel.** As in the prototype, all with 44 px or larger targets. The side panel is 420 px from the right, at 1280 and at 768.

**Skeleton.** Sand block with a white sheen moved by `transform`. Never a spinner for content.

### Photo direction

- **Launch:** no photos. The plate mark carries the menu. Nothing about the layout waits for photos.
- **Taking them:** daylight, from directly above, plate filling the frame. The upload screen shows a circle to fill.
- **Result:** the food on a white plate, cut out, on **cream (#fbf7f1)** with a soft contact shadow. Every dish gets the same cream, and there's no per-dish choice.
- **Processing:** resize, compress to WebP, square crop. The original is always kept.
- **Touch-up:** light and background clean-up only. The food stays what the customer gets. Steam, sauce and garnish must survive the cut-out, or the original is used. No generated food photos.
- **Display:** with photos on, the menu's tiles and lists turn cream with a 1 px sand ring, so the plate sits straight on cream with no box around it. Plates keep their sizes, so the layout doesn't change when photos arrive. Sheets are cream already.

### Ad placement format

**"From our neighbours"**, a small card anyone in the neighbourhood can supply without a designer.

| Part | Rule |
|---|---|
| Label | "From our neighbours" (12 px, 600, capitals) and an "Ad" tag, always both |
| Logo | Optional, 48 px square, `--r-sm`. No logo: the advertiser's first letter on sand |
| Name | 16/600, up to 32 characters |
| Line | One line of copy, up to 70 characters, in sans. No images of food, no script, no prices in display type |
| Place | Where they are, 13 px |
| Link | One link, 44 px target, in link style. Never a filled button |
| Surface | Transparent on cream with a 1 px sand-deep ring. No shadow, so it reads as lower than a dish |

**Where:** one on the menu, after Mains. One on the order status page, at the very end. At most 2 at a time.
**Never:** in the cart or checkout, for delivery customers, as a pop-up or banner, or with motion.
**Counting:** views and taps per advertiser, for invoicing. A flat weekly or monthly fee, invoiced outside the app.

## Motion

Tokens live once, here and in the theme. No one-off values in components.

```css
--dur-press: 120ms;   /* press feedback */
--dur-small: 180ms;   /* small things appearing, number ticker, ticket in new column */
--dur-step: 240ms;    /* order status line */
--dur-exit: 220ms;    /* sheets and panels leaving */
--dur-sheet: 280ms;   /* sheets and panels arriving */
--ease-out: cubic-bezier(.23, 1, .32, 1);       /* entering, responding */
--ease-drawer: cubic-bezier(.32, .72, 0, 1);    /* sheets and panels arriving */
--ease-in-out: cubic-bezier(.77, 0, .175, 1);   /* things already on screen, moving */
```

**Rules:** animate `transform` and `opacity` only. Colour, shadow and border changes are instant. No bounce, no `ease-in`, no `transition: all`. Hover only inside `@media (hover: hover) and (pointer: fine)`. With `prefers-reduced-motion`, movement becomes an opacity change or nothing, and the skeleton sheen stops.

### Every animation

| Element | Name | Job | Trigger | Token and values |
|---|---|---|---|---|
| Buttons, chips, jump links, steppers | Press / tap feedback | Feedback | Pointer down | `scale(.97)`, press, ease-out |
| Dish and cart sheet | Slide in, with scrim fade in | Spatial: where it came from | Open | `translateY(100%)`→0, sheet, drawer; scrim sheet, ease-out |
| Sheet closing | Exit along the same path | Spatial | Close, scrim tap, after Add | →`translateY(100%)`, exit, ease-out |
| Sheet by grabber | Drag, Swipe to dismiss, Rubber-banding | Direct manipulation | Drag | See below |
| Planner panel | Slide in and exit, from the right | Spatial | +Day, +Week, Cancel | sheet, drawer; exit, ease-out |
| Cart count | Number ticker | Feedback: the add landed | Add | `translateY(70%)`+fade, small, ease-out |
| Add-button label | Fade in with 6 px translate | State | Added | small, ease-out |
| Order status line | Scale along Y, from the top | State | Status advances | `scaleY`, step, ease-in-out |
| Current step dot | Scale in, after a 160 ms delay | State | Status advances | from `scale(.9)`, small, ease-out |
| Order placed → status | Page transition: fade with 8 px translate | Prevent a jarring change | Place order | small, ease-out |
| Ticket, planner entry | Enter in the new place, 8 px | Draws the eye to what changed | Accept, Add to day | small, ease-out |
| Table request strip | Enter from 8 px above, exit same way | Draws the eye | New request arrives (not on every visit to the board); Done | small, ease-out |
| Board undo strip | Fade in with 6 px translate | Prevent a jarring change | Ticket moved | small, ease-out |
| Decline form, undo note, recheck note, found order | Fade in with 6–8 px translate | Prevent a jarring change | Their action | small, ease-out |
| Delivery minimum bar | Scale along X, from the left | State | Cart changes | `scaleX`, small, ease-in-out |
| Switch knob | Translate | State | Toggle | `translateX(18px)`, small, ease-out |
| AI suggestions | Stagger | Prevent a jarring change | Suggestions arrive | 3 items, 30 ms apart, small, ease-out |
| Loading placeholder | Skeleton / Shimmer | Status | Waiting | `translateX`, 1.2 s, linear (the one loop allowed) |

### The sheet gesture

From `apple-design`:
- Grabber only, with `touch-action: none` and pointer capture.
- 1:1 with the finger, from where it was grabbed. Upward gets progressive resistance (rubber-banding).
- The scrim fades with the drag, so feedback is continuous.
- On release, it dismisses past 120 px, or past 20 px with a velocity above 0.11 px/ms over the last 100 ms. Otherwise it snaps back with sheet, drawer.
- The exit starts from where the finger left it.
- Scrolling inside a sheet never moves the sheet. Dragging from the content is left out for now, because it needs a real phone to judge.
- Escape closes the sheet or panel on top.

### Deliberately not animated

- **Jump bar scroll and active link:** frequent, and the customer wants the section, not the trip.
- **Dish rows on scroll (scroll reveal):** a menu is being read, and data shouldn't move for style.
- **A ticket flying between columns (shared element):** frequent in a rush, and the target column isn't on screen on a tablet.
- **Dashboard route changes:** tens of times a day, so instant.
- **Totals, sales figures and charts:** figures are being read. No number ticker or line drawing outside the cart count.
- **Ads:** never.

## Do's and Don'ts

**Do**
- Show the plate's size in proportion to the dish's importance.
- Say what's so: "7 plates left", "Sold out today. Back tomorrow.", "Not paid yet".
- Keep the main action the widest thing on a ticket.
- Give every state words as well as colour.

**Don't**
- Hide dishes in a sideways row.
- List a dish twice on the menu.
- Put initials on a plate.
- Use `teal`, `coral` or `amber` for text.
- Put commercial content between a customer and paying.
- Add cool greys back to the dashboard.
