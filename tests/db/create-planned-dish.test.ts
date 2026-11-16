// A new dish made from the planner ("+ New dish", "Save and add to menu") is one transaction:
// create_planned_dish (supabase/migrations/20261118000000_create_planned_dish.sql) inserts the dish,
// saves its options and adds its menu entry, so a refusal at any step saves nothing (RQAPN-01: a
// reload or Back after a refusal gave the form a new id, and the next save made a second dish).
// Called as the dashboard calls it: the signed-in owner, RLS applying.
import { describe, expect, test } from "bun:test";
import type { TransactionSQL } from "bun";
import { attempt, inTx, seedFixtures, type Fixtures } from "./helpers";

type Tx = TransactionSQL;
const arr = (days: string[]) => `{${days.join(",")}}`;

type Plan = { id?: string; name?: string; options?: unknown[]; kind?: "day" | "week"; days: string[]; from?: string; until?: string; plates?: number | null };

function create(tx: Tx, sub: string | null, p: Plan) {
  return attempt(tx, sub ? "authenticated" : "anon", sub, (q) => q`
    select public.create_planned_dish(
      ${p.id ?? crypto.randomUUID()}::uuid, ${p.name ?? "Planned stew"}, '', 450, 'mains'::public.dish_category,
      null, null, null, ${JSON.stringify(p.options ?? [])}::text::jsonb,
      ${p.kind ?? "day"}::public.entry_kind, ${arr(p.days)}::text::date[],
      ${p.from ?? "11:00"}::time, ${p.until ?? "20:00"}::time, ${p.plates === undefined ? null : p.plates}::integer) as id`);
}

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { errno?: string; detail?: string; message: string };
    return { code: e.errno ?? "error", detail: e.detail || undefined, message: e.message };
  }
}

async function today(tx: Tx) {
  const [r] = await tx`select public.nairobi_today()::text as d`;
  return r.d as string;
}

const planned = (tx: Tx, name = "Planned stew") => tx`select id, is_regular from public.dishes where name = ${name}`;
const entriesFor = (tx: Tx, name = "Planned stew") =>
  tx`select e.* from public.menu_entries e join public.dishes d on d.id = e.dish_id where d.name = ${name}`;

describe("create_planned_dish: a new dish from the planner is all or nothing", () => {
  test("saves the dish (not everyday), its options and one entry", async () => {
    await inTx(async (tx) => {
      const f: Fixtures = await seedFixtures(tx);
      const day = await today(tx);
      const id = crypto.randomUUID();
      const options = [
        { kind: "choice", label: "Rice", extra: null, isDefault: true },
        { kind: "choice", label: "Chapati", extra: null, isDefault: false },
      ];
      const [r] = await create(tx, f.ownerId, { id, days: [day], plates: null, options });
      expect(r!.id).toBeTruthy();
      const dishes = await planned(tx);
      expect(dishes).toHaveLength(1);
      expect(dishes[0]!.id).toBe(id);
      expect(dishes[0]!.is_regular).toBe(false);
      const [o] = await tx`select count(*)::int as n from public.dish_options where dish_id = ${id}`;
      expect(o.n).toBe(2);
      const entries = await entriesFor(tx);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe(r!.id);
      expect(entries[0]!.plates_per_day).toBeNull();
    });
  });

  test("a menu refusal after the dish part (a closed day) saves nothing", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      await tx`update public.opening_hours set is_open = false where weekday = extract(dow from ${day}::date)::int`;
      const r = await refusal(create(tx, f.ownerId, { days: [day] }));
      expect(r).toMatchObject({ code: "P0001", detail: "closed_day", message: "The kitchen is closed that day." });
      expect(await planned(tx)).toHaveLength(0);
    });
  });

  test("an options refusal saves nothing", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const r = await refusal(create(tx, f.ownerId, { days: [day], options: [{ kind: "extra", label: "", extra: 50, isDefault: false }] }));
      expect(r).toMatchObject({ code: "P0001", detail: "label" });
      expect(await planned(tx)).toHaveLength(0);
    });
  });

  test("bad hours are refused and save nothing", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const r = await refusal(create(tx, f.ownerId, { days: [day], from: "20:00", until: "12:00" }));
      expect(r?.code).toBe("P0001");
      expect(await planned(tx)).toHaveLength(0);
    });
  });

  test("after a refusal, saving again with a new id (Reload or Back) makes one dish and one entry", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const weekday = await tx`select extract(dow from ${day}::date)::int as w`;
      await tx`update public.opening_hours set is_open = false where weekday = ${weekday[0]!.w}`;
      expect(await refusal(create(tx, f.ownerId, { days: [day] }))).not.toBeNull();
      await tx`update public.opening_hours set is_open = true where weekday = ${weekday[0]!.w}`;
      await create(tx, f.ownerId, { days: [day] });
      expect(await planned(tx)).toHaveLength(1);
      expect(await entriesFor(tx)).toHaveLength(1);
    });
  });

  test("the same form sent twice after it saved returns the same entry, still one dish", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const id = crypto.randomUUID();
      const [first] = await create(tx, f.ownerId, { id, days: [day] });
      const [again] = await create(tx, f.ownerId, { id, days: [day] });
      expect(again!.id).toBe(first!.id);
      expect(await planned(tx)).toHaveLength(1);
      expect(await entriesFor(tx)).toHaveLength(1);
    });
  });

  // RPN-01 (review.r1): an existing id alone isn't proof this form's save happened.
  test("another dish's id is refused, that dish untouched and nothing added", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const [lib] = await tx`insert into public.dishes (name, price_kes) values ('Library stew', 300) returning id`;
      const r = await refusal(create(tx, f.ownerId, { id: lib.id, days: [day] }));
      expect(r).toMatchObject({ code: "P0001", detail: "stale_form" });
      expect(await planned(tx)).toHaveLength(0);
      const [d] = await tx`select name from public.dishes where id = ${lib.id}`;
      expect(d.name).toBe("Library stew");
      const [n] = await tx`select count(*)::int as n from public.menu_entries where dish_id = ${lib.id}`;
      expect(n.n).toBe(0);
    });
  });

  test("the same form sent again after its entry was removed says so, not saved", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const id = crypto.randomUUID();
      await create(tx, f.ownerId, { id, days: [day] });
      await tx`delete from public.menu_entries where dish_id = ${id}`;
      const r = await refusal(create(tx, f.ownerId, { id, days: [day] }));
      expect(r).toMatchObject({ code: "P0001", detail: "saved_not_planned" });
      expect(r!.message).toContain("Planned stew");
      expect(await entriesFor(tx)).toHaveLength(0);
    });
  });

  test("the same id for a different day isn't counted as that save", async () => {
    await inTx(async (tx) => {
      const f = await seedFixtures(tx);
      const day = await today(tx);
      const [next] = await tx`select (${day}::date + 1)::text as d`;
      const id = crypto.randomUUID();
      await create(tx, f.ownerId, { id, days: [day] });
      const r = await refusal(create(tx, f.ownerId, { id, days: [next.d] }));
      expect(r?.code).toBe("P0001");
      expect(await entriesFor(tx)).toHaveLength(1);
    });
  });

  test("not for a customer", async () => {
    await inTx(async (tx) => {
      await seedFixtures(tx);
      const day = await today(tx);
      const r = await refusal(create(tx, null, { days: [day] }));
      expect(r?.code).toBe("42501");
      expect(await planned(tx)).toHaveLength(0);
    });
  });
});
