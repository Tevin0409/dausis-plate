# Dausis Plate

Online menu, ordering (dine-in by table QR, pickup, delivery) and the owner dashboard for Dausis Plate, *Mama’s Flavour*.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · Bun · Supabase (Postgres, Auth, Realtime) · Cloudflare R2 for dish photos · Vercel.

## How the menu works

- **Dish library** (`dishes`): every dish she has cooked, with photo and price. A dish marked *regular* is always on the menu and can be toggled sold out for the day.
- **Rotating menu** (`menu_entries`): a library dish placed on one day (`kind = day`) or for a date range (`kind = week`), with an optional plate limit per day and serving hours. Plates sold are tracked per day in `menu_entry_days`.
- **`todays_menu` view**: what customers see right now, on Nairobi time.
- **`place_order` RPC**: the only way orders are created. It reprices everything from the database, checks hours and plate limits, and decrements plates in one transaction. Cancelling an order gives the plates back.

## Screens

| Customer | Dashboard (`/dashboard`) |
| --- | --- |
| `/` today’s menu + regulars | `/dashboard/menu` week planner, copy a day, dish library |
| `/dish/[id]` options and notes | `/dashboard/dishes/[id]` create/edit dish, photo upload |
| `/cart`, `/checkout` | `/dashboard/orders` live board (Realtime + chime) |
| `/order/[token]` live status | `/dashboard/manage` sales today, regulars on/off |
| `/t/[qr_token]` table QR entry | `/login` email magic link |

## Setup

1. **Install:** `bun install`
2. **Supabase:** create a project, then link and push the schema:
   ```sh
   bunx supabase link --project-ref <ref>
   bunx supabase db push          # applies supabase/migrations
   ```
   For local work, `bunx supabase start` then `bun run db:reset` (loads `supabase/seed.sql` sample data).
   In Auth → URL Configuration, add `<site>/auth/callback` as a redirect URL.
3. **Make the owner staff.** She signs in once at `/login`, then in the SQL editor:
   ```sql
   insert into public.staff (user_id, role, display_name)
   select id, 'owner', 'Mama Dausi' from auth.users where email = 'her@email.com';
   ```
   After that she can add other staff the same way (role `staff`).
4. **Cloudflare R2** (bucket `dausis-plate-photos`):
   - Settings → Public access: connect a custom domain (e.g. `photos.dausisplate.co.ke`) or turn on the r2.dev URL for testing. Put that URL in `NEXT_PUBLIC_PHOTO_BASE_URL`.
   - Settings → CORS policy, so the browser can upload directly:
     ```json
     [{ "AllowedOrigins": ["https://<site>", "http://localhost:3000"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
     ```
   - R2 → Manage API tokens: Object Read & Write, scoped to this bucket. Copy the account ID, access key ID and secret into `R2_*`.

   **How photos flow:** the dashboard resizes each photo in the browser to WebP (1600px and 480px, EXIF stripped), asks `/api/uploads` for two presigned PUT URLs, and uploads straight to R2. On save, the server checks both files exist, then stores `photo_url` and `photo_thumb_url` on the dish. Replacing a photo deletes the old files.
5. **Env:** copy `.env.example` to `.env.local` and fill it in. Add the same values in Vercel.
6. **Table QR codes:** each row in `dining_tables` has a `qr_token`. Print a QR for `https://<site>/t/<qr_token>` on each table.

## Payments

M-Pesa and card are **stubbed** in `src/lib/payments`: orders are created with payment *pending* and staff can tap **Mark paid** on the board. The Daraja STK push steps are written out in `startMpesaPayment`, and the callback handler at `/api/payments/mpesa/callback` already verifies a shared secret and marks orders paid or failed.

## Notes

- `src/lib/database.types.ts` is hand-written to match the migration. Regenerate with `bun run db:types` once the local stack runs.
- Customers never read the `orders` table: status comes from `get_order_status(token)`, so order details aren’t exposed to other customers.
- Sample dishes, prices and delivery zones in `seed.sql` are placeholders. Replace with her real menu.
