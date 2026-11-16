// saveDish with "Save and add to menu" (a new dish opened from the planner's "+ New dish").
// Tevin, 2026-11-15: a save that showed an error still added the dish, and each retry added it
// again. One save is one outcome: the dish, its options and its menu entry are one database call
// (create_planned_dish), so a refusal saves nothing and no retry, after Reload or Back with a new
// form id (RQAPN-01) or otherwise, can make a second dish.
//
// The action runs against a small in-memory stand-in for Supabase that keeps the database's rules
// the action depends on: dishes.id is unique (23505), create_planned_dish is all or nothing, and
// it refuses hours that end before they start (planner_values).
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Dish = { id: string; name: string; is_regular: boolean };
type Call = { fn: string; args: Record<string, unknown> };

const db = { dishes: [] as Dish[], entries: [] as Record<string, unknown>[], rpcs: [] as Call[], refuseNextPlan: null as null | { message: string; details: string }, nullEntry: false };

function fakeClient() {
  return {
    from(table: string) {
      if (table === "opening_hours") {
        return { select: async () => ({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_open: true })), error: null }) };
      }
      if (table !== "dishes") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Dish) => {
          if (db.dishes.some((d) => d.id === row.id)) return { error: { code: "23505", message: "duplicate key value violates unique constraint \"dishes_pkey\"" } };
          db.dishes.push({ id: row.id, name: row.name, is_regular: row.is_regular ?? false });
          return { error: null };
        },
        update: (words: Partial<Dish>) => ({
          eq: async (_col: string, id: string) => {
            const d = db.dishes.find((x) => x.id === id);
            if (d) Object.assign(d, { name: words.name ?? d.name });
            return { error: null };
          },
        }),
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      db.rpcs.push({ fn, args });
      if (fn === "save_dish_options") return { error: null };
      if (fn !== "create_planned_dish") throw new Error(`unexpected rpc ${fn}`);
      // One transaction: every check first, then the dish and its entry together.
      // An id already used: the same entry back only if it is this form's earlier save (RPN-01).
      const had = db.dishes.find((d) => d.id === args.p_id);
      if (had) {
        const entry = db.entries.find((e) => e.p_dish === had.id);
        if (had.name === args.p_name && entry) return { data: entry.id, error: null };
        if (had.name === args.p_name) return { data: null, error: { code: "P0001", message: `${had.name} is already in the dish library, but it isn’t on that day’s menu any more. Add it from the planner.`, details: "saved_not_planned" } };
        return { data: null, error: { code: "P0001", message: "This form is out of date. Reload the page and try again.", details: "stale_form" } };
      }
      if (String(args.p_until) <= String(args.p_from)) return { data: null, error: { code: "P0001", message: "Serving must end after it starts.", details: "hours" } };
      if (db.refuseNextPlan) {
        const r = db.refuseNextPlan;
        db.refuseNextPlan = null;
        return { data: null, error: { code: "P0001", ...r } };
      }
      db.dishes.push({ id: String(args.p_id), name: String(args.p_name), is_regular: false });
      if (db.nullEntry) return { data: null, error: null };
      const id = crypto.randomUUID();
      db.entries.push({ id, p_dish: args.p_id, ...args });
      return { data: id, error: null };
    },
  };
}

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

mock.module("@/lib/supabase/server", () => ({ getStaff: async () => ({ id: "owner" }), createClient: async () => fakeClient() }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
mock.module("@/lib/r2", () => ({ PHOTO_KEY: /^dishes\/[\w-]+\/[\w-]+\.webp$/, deletePhotoSet: async () => {}, photoExists: async () => true, publicPhotoUrl: (k: string) => k }));

const { saveDish } = await import("@/app/dashboard/actions");

const NEW_ID = "5675839a-8914-46b0-94ef-fab036fd77b6";
const SUNDAY = "2026-11-15";

function form(over: Record<string, string | null> = {}) {
  const fields: Record<string, string | null> = {
    id: "",
    new_id: NEW_ID,
    name: "Repro Stew",
    price_kes: "450",
    category: "mains",
    options: "[]",
    description: "",
    photo_key: "",
    photo_thumb_key: "",
    is_regular: null,
    add_day: SUNDAY,
    add_kind: "week",
    plates_per_day: "",
    show_from: "12:00",
    show_until: "20:00",
    ...over,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}

/** saveDish's outcome: its result, or where it redirected. */
async function save(f: FormData) {
  try {
    return { result: await saveDish(null, f) };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.to };
    throw e;
  }
}

beforeEach(() => {
  db.dishes = [];
  db.entries = [];
  db.rpcs = [];
  db.refuseNextPlan = null;
  db.nullEntry = false;
});

describe("saveDish, new dish added to the menu from the planner", () => {
  // Tevin's steps: everyday switch on, Rest of the week, new times, no plate limit. The form no
  // longer offers the switch there (Tevin's A), so this is what a request carrying it gets.
  test("everyday plus a planned day: refused, nothing saved", async () => {
    const out = await save(form({ is_regular: "on" }));
    expect(out.result?.error).toBeTruthy();
    expect(out.result?.field).toBe("is_regular");
    expect(db.dishes).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });

  test("saving the same form again after that refusal still saves nothing", async () => {
    await save(form({ is_regular: "on" }));
    await save(form({ is_regular: "on" }));
    await save(form({ is_regular: "on" }));
    expect(db.dishes).toEqual([]);
  });

  test("an empty plate limit is fine: one dish, one entry with no limit", async () => {
    const out = await save(form());
    expect(out.redirect).toBe(`/dashboard/menu?day=${SUNDAY}`);
    expect(db.dishes).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]!.p_plates).toBeNull();
    expect(db.entries[0]!.p_from).toBe("12:00");
  });

  test("serving that ends before it starts is refused under the times, nothing saved", async () => {
    const out = await save(form({ show_from: "20:00", show_until: "12:00" }));
    expect(out.result?.field).toBe("show_until");
    expect(out.result?.error).toBe("Serving must end after it starts.");
    expect(db.dishes).toEqual([]);
  });

  test("a menu refusal saves nothing and doesn't say the dish was saved", async () => {
    db.refuseNextPlan = { message: "The kitchen is closed that day.", details: "closed_day" };
    const first = await save(form());
    expect(first.result?.error).toBe("The kitchen is closed that day.");
    expect(first.result?.error).not.toContain("Saved");
    expect(db.dishes).toEqual([]);
    expect(db.entries).toEqual([]);
  });

  // RQAPN-01: Reload or Back after the refusal renders the form with a new id.
  test("after a refusal, Reload or Back then Save makes one dish and one entry", async () => {
    db.refuseNextPlan = { message: "The kitchen is closed that day.", details: "closed_day" };
    await save(form());
    const retry = await save(form({ new_id: "0b8f1f7e-3f43-4d3b-9b1e-6f7d2a3c4e5f" }));
    expect(retry.redirect).toBe(`/dashboard/menu?day=${SUNDAY}`);
    expect(db.dishes).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
  });

  test("the same form sent again after it saved goes to the planner, still one dish", async () => {
    await save(form());
    const again = await save(form());
    expect(again.redirect).toBe(`/dashboard/menu?day=${SUNDAY}`);
    expect(db.dishes).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
  });

  // RPN-01 (review.r1): an existing id alone isn't proof the save happened.
  test("a form carrying another dish's id is refused, not reported saved", async () => {
    db.dishes.push({ id: NEW_ID, name: "Library stew", is_regular: false });
    const out = await save(form());
    expect(out.redirect).toBeUndefined();
    expect(out.result?.error).toBe("This form is out of date. Reload the page and try again.");
    expect(db.dishes).toEqual([{ id: NEW_ID, name: "Library stew", is_regular: false }]);
    expect(db.entries).toEqual([]);
  });

  test("the same form sent again after its entry was removed says so, not saved", async () => {
    await save(form());
    db.entries = [];
    const out = await save(form());
    expect(out.redirect).toBeUndefined();
    expect(out.result?.error).toContain("isn’t on that day’s menu any more");
    expect(db.entries).toEqual([]);
  });

  test("never reports saved when the database returns no entry", async () => {
    db.nullEntry = true;
    const out = await save(form());
    expect(out.redirect).toBeUndefined();
    expect(out.result?.error).toBeTruthy();
  });

  test("the dish, its options and the entry go in one call", async () => {
    const options = JSON.stringify([
      { kind: "choice", label: "Rice", extra: null, isDefault: true },
      { kind: "choice", label: "Chapati", extra: null, isDefault: false },
    ]);
    await save(form({ options }));
    expect(db.rpcs.map((c) => c.fn)).toEqual(["create_planned_dish"]);
    expect(db.rpcs[0]!.args.p_options).toHaveLength(2);
    expect(db.rpcs[0]!.args.p_days).toEqual([SUNDAY]);
  });
});
