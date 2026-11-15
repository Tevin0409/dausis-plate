-- Wave 2 integration (RW2B-02): the bill's "Mark all paid" records how it was paid.
-- 2.9's mark_orders_paid(uuid[]) called 2.4's one-argument mark_order_paid, which 2.12
-- (20261116000000_reports) dropped for mark_order_paid(uuid, paid_with). The bulk version now takes
-- the method and passes it to each order, so Reports' cash / M-Pesa totals count a bill paid in one
-- go. One method for the whole bill: a bill paid partly in cash is recorded order by order with the
-- per-order buttons, which stay. It is still one transaction: one refusal (say, an order cancelled
-- meanwhile) marks none of them. unmark_orders_paid is unchanged; it calls 2.12's
-- unmark_order_paid, which clears paid_with, and its Undo is still all of them or none.
drop function public.mark_orders_paid(uuid[]);

create function public.mark_orders_paid(p_ids uuid[], p_with public.paid_with)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_version integer;
  v_out jsonb := '[]'::jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 50 then
    raise exception 'Choose the orders to mark paid' using errcode = 'P0001';
  end if;
  -- mark_order_paid checks the method too; checking first refuses before any row is locked.
  if p_with is null or p_with not in ('cash', 'mpesa') then
    raise exception 'Choose cash or M-Pesa.' using errcode = 'P0001';
  end if;
  foreach v_id in array (select array_agg(distinct i order by i) from unnest(p_ids) i) loop
    v_version := public.mark_order_paid(v_id, p_with);
    if v_version is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'version', v_version));
    end if;
  end loop;
  return v_out;
end $$;

revoke all on function public.mark_orders_paid(uuid[], public.paid_with) from public, anon;
grant execute on function public.mark_orders_paid(uuid[], public.paid_with) to authenticated;
