-- Slice 2.4: delivery orders get their own step between Ready and Done. An enum value can't be
-- used in the transaction that adds it, so it has this file to itself; 20261109000100 uses it.
alter type public.order_status add value 'on_the_way' after 'ready';
