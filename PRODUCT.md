# Product

<!-- impeccable:product-schema 1 -->

*Written 2026-11-05 from the owner's recorded decisions in `docs/plans/launch/plan.md` and `docs/plans/launch/question-design-pick.md`. There was no live interview. Tevin approved this file on 2026-11-05 at 10:04Z without changing the lines marked **(inferred)**, which didn't come directly from a decision.*

## Platform

web

## Users

- **Customers.** Most order on a phone, usually after scanning the QR code on their table. Others order pickup or delivery in Nairobi from the same menu. **(inferred)** They often have one hand free and a patchy connection.
- **Mama Dausi, the owner.** She plans the menu, sets prices and hours, approves ads and reads the reports. Everything published under her name stays under her control.
- **Kitchen and floor staff.** They run the order board on a tablet or desktop during service, mark orders paid and sold out, and clear table requests. **(inferred)** They read the board at a distance, with busy hands.

## Product Purpose

Online menu, ordering and owner dashboard for Dausis Plate, *Mama's Flavour*. A customer sees what Mama is cooking today, orders it for dine-in, pickup or delivery, and follows the order on a link. Mama runs the day from one dashboard.

Success at launch means customers can order correctly from a phone, the kitchen can trust the board, and Mama can run her menu, hours and staff without help.

## Positioning

One kitchen's own daily menu, in its own voice. Dishes change by day and by week, plates run out, and the menu says so honestly. It's not a marketplace listing.

## Operating Context

- **Dine-in:** scan a table QR, order, then Call waiter, Request bill and pay at the counter or on handover.
- **Pickup and delivery:** pay on handover, cash or M-Pesa to the till. Nothing is charged online at launch.
- **Order link:** customers have no accounts. They save the link, or find the order with their phone number and order code.
- **Dish kinds:** today, this week, and everyday. Rotating dishes have plate limits and serving hours.
- **Photos:** none at launch. Mama adds them over time, so the menu has to look finished without them.

## Capabilities and Constraints

- **Orders:** declining needs one of 4 reasons, which the customer sees. Delivery has an On the way step. Cancelled is final. Unfinished orders stay on the board past midnight.
- **Order board (Tevin, 2026-11-05):** moves and Mark paid can be undone for 5 seconds, and the customer is told nothing until that has passed. Decline has no undo. An order's age turns amber at 15 minutes, to be reviewed after Mama's first busy week.
- **Roles:** staff and owner are split, and a change record shows who changed what. Prices, sales, staff, hours, ads and settings are owner only.
- **Hours:** weekly hours, closed dates, and close early (owner only). One set of hours covers dine-in, pickup and delivery. Mama chooses when last orders stop: 30 minutes before closing, 15, or at closing, starting at 30 (Tevin, 2026-11-05).
- **Still open:** whether the kitchen closes in the middle of the day or stays open past midnight. Tevin is checking with Mama. How hours are stored waits for that answer.
- **Till number (Tevin, 2026-11-05):** Mama enters the M-Pesa till number in Settings, owner only, and it shows on the order status page.
- **Request bill (Tevin, 2026-11-05):** it shows staff the table's unpaid orders today with a total. The orders stay separate.
- **Closed kitchen (Tevin, 2026-11-05):** the menu shows the next open day's dishes, and customers can add them to their saved cart. Placing the order is off until opening, and plates aren't held until then. The cart is checked against that day's menu, and again when placing. If Mama hasn't planned that day, the menu shows everyday dishes and week dishes already running that day, and says that day's specials aren't up yet. A saved cart forgets its table at closing and keeps its items, so food never goes to the wrong table.
- **Delivery:** zones with a fee and a minimum order.
- **Sales:** paid and not paid are always shown separately.
- **Regular dishes:** one switched off for the day comes back on the next morning.
- **Ratings:** only people who ordered can rate. Stars are public, comments are private to Mama. Everyone gets the Google review link after every completed order, with no reward, and our ratings are never posted to Google.
- **Promos:** featured dishes (Mama's picks), combos at a set price, and discount codes under the rules Tevin set on 2026-11-05.
- **Neighbour ads:** dine-in and pickup only, never in the cart or checkout, no pop-ups, at most 2 at a time. Mama uploads and approves each one, and fees are invoiced outside the app.
- **Kitchen helpers:** an AI description writer whose suggestions Mama edits and saves, and AI photo touch-up that changes light and background only. No generated food photos.
- **Not at launch:** real M-Pesa, WhatsApp messages, card payments, customer accounts, loyalty, tipping, a Swahili toggle, rider tracking, catering.
- **Technical:** Next.js 15, React 19, Tailwind v4, Supabase. `todays_menu` and `place_order` are the only routes for the menu and orders.

**Undecided**
- Whether a cancelled order can stay marked paid (to settle in slice 2.12).
- The photo touch-up provider (asked before slice 2.7's touch-up is built).
- The delivery minimum amounts (Mama enters them).

## Brand Commitments

- **The current look is the brand,** improved where needed (decision 7). The source is `public/brand/*.svg` and `src/app/globals.css`.
- **Name and line:** Dausis Plate, *Mama's Flavour.*
- **The plate mark:** teal ring, white rim, pink plate, fork and spoon.
- **Voice:** warm, plain and specific. Karibu and Asante are at home here. Mama is a person who reads comments, not a brand device.
- **Design:** Plates on the cream brand, with the shorter menu layout (Tevin, 2026-11-05 09:33Z). Dark slate was considered and not chosen.

## Evidence on Hand

- **Assets:** the brand SVGs and sample data in `supabase/seed.sql`.
- **Not available yet:** real dish photos, the real menu, advertisers, ratings and sales. Prototype figures are invented, so don't quote them as fact.
- **Not verified:** nobody has tried the design on a real phone or a kitchen tablet.

## Product Principles

1. **Tell the truth about the kitchen.** Plates left, sold out, closed, not paid yet: say what's so, in plain words.
2. **Mama stays in charge.** Nothing is published in her name without her, including AI text and ads.
3. **The food comes first.** Commercial content stays small and labelled, and stays out of the path to paying.
4. **Finished without photos.** Every screen has to look deliberate on launch day.
5. **Daily use decides.** A screen the kitchen uses a hundred times a day gets speed and clarity before expression.

## Accessibility & Inclusion

WCAG 2.1 AA contrast, 44 px minimum targets, 16 px inputs, and `prefers-reduced-motion` respected. **(inferred)** These come from the team's quality rules and the design review, not a stated legal requirement.
