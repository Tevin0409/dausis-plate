// Slice 2.4: the board's rules (src/lib/board.ts): sorting, ages and their amber, and the chime's seen set.
import { describe, expect, test } from "bun:test";
import { ageOf, customerCancelText, doneRows, mainAction, newIds, reasonsFor, sortColumn, typeTag } from "@/lib/board";

// Thursday 6 Nov 2026, 13:00 in Nairobi (UTC+3).
const NOW = new Date("2026-11-06T10:00:00Z");
const at = (hhmm: string, day = "2026-11-06") => new Date(`${day}T${hhmm}:00+03:00`).toISOString();
const o = (over: Partial<Parameters<typeof ageOf>[0]> = {}) => ({ status: "preparing" as const, mode: "dine_in" as const, created_at: at("12:50"), pickup_at: null, ...over });

describe("age", () => {
  test("Just now, minutes, hours", () => {
    expect(ageOf(o({ created_at: at("12:59") }), new Date(NOW.getTime() + 20_000))).toEqual({ text: "1 min", amber: false });
    expect(ageOf(o({ created_at: NOW.toISOString() }), NOW)).toEqual({ text: "Just now", amber: false });
    expect(ageOf(o({ created_at: at("12:46") }), NOW)).toEqual({ text: "14 min", amber: false });
    expect(ageOf(o({ created_at: at("12:45") }), NOW)).toEqual({ text: "15 min", amber: true });
    expect(ageOf(o({ created_at: at("11:55") }), NOW)).toEqual({ text: "1 h 05", amber: true });
    expect(ageOf(o({ created_at: at("02:30") }), NOW)).toEqual({ text: "10 h 30", amber: true });
  });

  test("never amber in Done", () => {
    expect(ageOf(o({ status: "completed", created_at: at("11:00") }), NOW).amber).toBe(false);
  });

  test("from before today: Since yesterday, or the weekday", () => {
    expect(ageOf(o({ created_at: at("21:40", "2026-11-05") }), NOW)).toEqual({ text: "Since yesterday 21:40", amber: true });
    expect(ageOf(o({ created_at: at("21:40", "2026-11-03") }), NOW)).toEqual({ text: "Since Tue 21:40", amber: true });
  });

  test("an order placed at 23:50 is 'yesterday' just after midnight", () => {
    expect(ageOf(o({ created_at: at("23:50", "2026-11-05") }), new Date(at("00:20"))).text).toBe("Since yesterday 23:50");
  });

  test("a booked pickup counts down to its time in Cooking and Ready, not in New", () => {
    const p = (status: "new" | "preparing" | "ready", pickup: string) => o({ status, mode: "pickup", created_at: at("11:45"), pickup_at: at(pickup) });
    expect(ageOf(p("new", "13:30"), NOW)).toEqual({ text: "1 h 15", amber: true });
    expect(ageOf(p("preparing", "13:40"), NOW)).toEqual({ text: "Due in 40 min", amber: false });
    expect(ageOf(p("preparing", "13:16"), NOW)).toEqual({ text: "Due in 16 min", amber: false });
    expect(ageOf(p("preparing", "13:15"), NOW)).toEqual({ text: "Due in 15 min", amber: true });
    expect(ageOf(p("preparing", "12:55"), NOW)).toEqual({ text: "Due 5 min ago", amber: true });
    expect(ageOf(p("preparing", "13:00"), NOW)).toEqual({ text: "Due now", amber: true });
    // Ready: plain until 15 min after its time.
    expect(ageOf(p("ready", "13:05"), NOW)).toEqual({ text: "Due in 5 min", amber: false });
    expect(ageOf(p("ready", "12:46"), NOW)).toEqual({ text: "Due 14 min ago", amber: false });
    expect(ageOf(p("ready", "12:45"), NOW)).toEqual({ text: "Due 15 min ago", amber: true });
  });

  test("pickup amber starts exactly at 15 min, to the second, not at the rounded minute (RQA24-06)", () => {
    const sec = 1000;
    const p = (status: "preparing" | "ready", offsetMs: number) =>
      o({ status, mode: "pickup", created_at: at("11:45"), pickup_at: new Date(NOW.getTime() + offsetMs).toISOString() });
    // QA's case: 916 s to go reads "Due in 15 min" but is not amber yet.
    expect(ageOf(p("preparing", 916 * sec), NOW)).toEqual({ text: "Due in 15 min", amber: false });
    expect(ageOf(p("preparing", 901 * sec), NOW).amber).toBe(false);
    expect(ageOf(p("preparing", 900 * sec), NOW).amber).toBe(true);
    // Ready: 14:59 overdue reads "Due 15 min ago" but is not amber; 15:00 is.
    expect(ageOf(p("ready", -(14 * 60 + 59) * sec), NOW)).toEqual({ text: "Due 15 min ago", amber: false });
    expect(ageOf(p("ready", -900 * sec), NOW).amber).toBe(true);
  });
});

describe("sorting", () => {
  test("oldest first; booked pickups in Cooking and Ready by their time less 15 min", () => {
    const a = { id: "a", ...o({ created_at: at("13:10") }) };
    const b = { id: "b", ...o({ created_at: at("13:20") }) };
    const pickup = { id: "p", ...o({ mode: "pickup", created_at: at("11:45"), pickup_at: at("13:30") }) };
    expect(sortColumn([b, pickup, a]).map((x) => x.id)).toEqual(["a", "p", "b"]);
    const asap = { id: "q", ...o({ mode: "pickup", created_at: at("11:45") }) };
    expect(sortColumn([b, asap, a]).map((x) => x.id)).toEqual(["q", "a", "b"]);
    // In New, by placed time.
    const inNew = (x: typeof a) => ({ ...x, status: "new" as const });
    expect(sortColumn([b, pickup, a].map(inNew)).map((x) => x.id)).toEqual(["p", "a", "b"]);
  });
});

describe("words", () => {
  test("Ready's button by order type", () => {
    expect(mainAction("ready", "dine_in")?.label).toBe("Served");
    expect(mainAction("ready", "pickup")?.label).toBe("Collected");
    expect(mainAction("ready", "delivery")).toEqual({ label: "On the way", pending: "Saving…", to: "on_the_way" });
    expect(mainAction("on_the_way", "delivery")?.to).toBe("completed");
    expect(mainAction("completed", "delivery")).toBeNull();
  });

  test("type tags", () => {
    expect(typeTag({ mode: "dine_in", pickup_at: null, table: "Table 4", zone: null })).toBe("Dine-in · Table 4");
    expect(typeTag({ mode: "pickup", pickup_at: at("13:30"), table: null, zone: null })).toBe("Pickup · 13:30");
    expect(typeTag({ mode: "pickup", pickup_at: null, table: null, zone: null })).toBe("Pickup · As soon as ready");
    expect(typeTag({ mode: "delivery", pickup_at: null, table: null, zone: "Kilimani" })).toBe("Delivery · Kilimani");
  });

  test("reasons offered match the database's rules", () => {
    const ids = (s: Parameters<typeof reasonsFor>[0], m: Parameters<typeof reasonsFor>[1]) => reasonsFor(s, m).map((r) => r.id);
    expect(ids("new", "dine_in")).toEqual(["sold_out", "too_busy", "customer_asked", "other"]);
    expect(ids("new", "delivery")).toEqual(["sold_out", "too_busy", "cant_deliver", "customer_asked", "other"]);
    expect(ids("preparing", "pickup")).toEqual(["sold_out", "too_busy", "customer_asked", "other"]);
    expect(ids("ready", "pickup")).toEqual(["sold_out", "too_busy", "customer_asked", "no_show", "other"]);
    expect(ids("ready", "dine_in")).not.toContain("no_show");
    expect(ids("on_the_way", "delivery")).toContain("no_show");
  });

  test("the customer's lines", () => {
    expect(customerCancelText({ reason: "other", note: "Gas ran out", declined: true })).toBe("Mama’s kitchen says: “Gas ran out”");
    expect(customerCancelText({ reason: "customer_asked", note: null, declined: false })).toBe("Cancelled as you asked.");
    expect(customerCancelText({ reason: "no_show", note: null, declined: false })).toBe("We waited, but nobody came for it.");
    expect(customerCancelText({ reason: null, note: null, declined: true })).toBeNull();
  });
});

describe("the chime's seen set", () => {
  test("first render seeds silently; new ids chime once per batch; an undo back to New doesn't chime", () => {
    const seen = new Set<string>();
    newIds(seen, ["a", "b", "c"]); // the board seeds on first render and doesn't chime
    expect(newIds(seen, ["a", "b", "c"])).toEqual([]); // a refresh that changed nothing
    expect(newIds(seen, ["a", "b", "c", "d", "e"])).toEqual(["d", "e"]); // two in one refresh: one chime
    expect(newIds(seen, ["b", "c", "d", "e"])).toEqual([]); // a accepted
    expect(newIds(seen, ["a", "b", "c", "d", "e"])).toEqual([]); // a undone back to New
  });
});

describe("Done", () => {
  test("unpaid first, then the rest, newest first", () => {
    const r = (id: string, paid: boolean, hhmm: string) => ({ id, payment_status: paid ? "paid" : "unpaid", status_changed_at: at(hhmm) });
    expect(doneRows([r("a", true, "12:00"), r("b", false, "11:00"), r("c", true, "12:30"), r("d", false, "12:10")]).map((x) => x.id)).toEqual(["d", "b", "c", "a"]);
  });
});
