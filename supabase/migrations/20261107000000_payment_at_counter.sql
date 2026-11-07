-- Slice 2.1: dine-in customers may pay at the counter. Its own file, because Postgres
-- can't use a new enum value in the transaction that adds it (the next migration does).
-- mpesa and card stay: real M-Pesa comes after launch.
alter type public.payment_method add value if not exists 'at_counter';
