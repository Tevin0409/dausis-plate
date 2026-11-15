// Slice 2.11: combo lines in the cart (the check payload, applyCheck, plate caps) and the code words.
import { describe, expect, test } from "bun:test";
import { applyCheck, checkPayload, entryUse, inOrder, lineCap, type CheckResult } from "@/lib/cart-check";
import { cartLineKey, comboLineKey, partLine, readStoredLine, type ComboPart } from "@/lib/cart-lines";
import { codeError, codeHeldNote, codeReason, type CodeCheck } from "@/lib/discount-words";

const part = (dishId: string, entry: string | null, per = 1, o: Partial<ComboPart> = {}): ComboPart => ({
  dishId, menuEntryId: entry, optionId: null, optionLabel: null, extras: [], name: dishId, per, ...o,
});
const combo = (parts: ComboPart[], quantity = 1) => ({
  kind: "combo" as const, comboId: "c1", dishId: "c1", menuEntryId: null, optionId: null, extras: [], note: "",
  name: "Lunch combo", quantity, unitPriceKes: 700, parts, key: comboLineKey("c1", parts),
});
const dish = (dishId: string, entry: string | null, quantity: number) => {
  const l = { dishId, menuEntryId: entry, optionId: null, extras: [], note: "", name: dishId, quantity, unitPriceKes: 300 };
  return { ...l, key: cartLineKey(l) };
};
const res = (key: string, state: CheckResult["state"], o: Partial<CheckResult> = {}): CheckResult => ({
  key, state, quantity: 0, menu_entry_id: null, unit_price_kes: null, plates_left: null, ...o,
});

describe("combo lines", () => {
  test("the key ignores entries, so a dish moving entry keeps the line", () => {
    expect(comboLineKey("c1", [part("pilau", "e1")])).toBe(comboLineKey("c1", [part("pilau", "e2")]));
    expect(comboLineKey("c1", [part("pilau", "e1", 1, { optionId: "o1" })])).not.toBe(comboLineKey("c1", [part("pilau", "e1")]));
  });
  test("the payload sends the combo with its parts and per-combo quantities", () => {
    const l = combo([part("chapati", null, 2), part("pilau", "e1", 1, { extras: [{ id: "x1", label: "Avocado", priceKes: 50 }] })], 3);
    expect(checkPayload([l])).toEqual([
      {
        key: l.key, combo_id: "c1", quantity: 3,
        parts: [
          { dish_id: "chapati", menu_entry_id: null, option_id: null, extra_ids: [], quantity: 2 },
          { dish_id: "pilau", menu_entry_id: "e1", option_id: null, extra_ids: ["x1"], quantity: 1 },
        ],
      },
    ]);
  });
  test("plates: a combo holds per × quantity of each dish", () => {
    const l = combo([part("chapati", null, 2), part("pilau", "e1", 2)], 3);
    expect(entryUse(l, "e1")).toBe(6);
    expect(inOrder([l, dish("pilau", "e1", 1)], {}, "e1")).toBe(7);
  });
  test("cap: the tightest dish, in whole combos, less the order's other lines", () => {
    const l = combo([part("chapati", "e0", 1), part("pilau", "e1", 2)]);
    const other = dish("pilau", "e1", 1);
    // e1 has 6 left, 1 held by the dish line: (6 − 1) / 2 = 2 whole combos.
    expect(lineCap([l, other], {}, { e0: 10, e1: 6 }, l.key)).toBe(2);
    expect(lineCap([l, other], {}, { e0: 1, e1: 6 }, l.key)).toBe(1);
    expect(lineCap([l, other], {}, { e1: 1 }, l.key)).toBe(0);
  });
  test("applyCheck keeps the key, takes the new price and moves a dish's entry", () => {
    const l = combo([part("pilau", "e1")]);
    const r = applyCheck([l], {}, [
      res(l.key, "ok", { kind: "combo", quantity: 1, unit_price_kes: 750, parts: [{ dish_id: "pilau", state: "ok", menu_entry_id: "e2", plates_left: 4 }] }),
    ]);
    expect(r.lines[0]?.key).toBe(l.key);
    expect(r.lines[0]?.unitPriceKes).toBe(750);
    expect(r.lines[0]?.parts?.[0]?.menuEntryId).toBe("e2");
    expect(r.entryLeft).toEqual({ e2: 4 });
    expect(r.changed).toBe(true);
  });
  test("a combo that's off drops out of the total and keeps its amount", () => {
    const l = combo([part("pilau", "e1")], 2);
    const r = applyCheck([l], {}, [res(l.key, "combo_off", { kind: "combo" })]);
    expect(r.checks[l.key]?.state).toBe("combo_off");
    expect(r.lines[0]?.quantity).toBe(2);
    expect(r.changed).toBe(true);
  });
  test("a dish line reads as 2× name · choice, extras", () => {
    expect(partLine(part("Chapati", null, 2))).toBe("2× Chapati");
    expect(partLine(part("Pilau", null, 1, { optionLabel: "Rice", extras: [{ id: "x", label: "Avocado", priceKes: 50 }] }))).toBe("Pilau · With rice · + Avocado");
  });
  test("a stored combo line needs its combo and whole parts", () => {
    const l = combo([part("pilau", "e1")]);
    expect(readStoredLine(l)).not.toBeNull();
    expect(readStoredLine({ ...l, comboId: undefined })).toBeNull();
    expect(readStoredLine({ ...l, parts: [] })).toBeNull();
    expect(readStoredLine({ ...l, parts: [{ dishId: "pilau" }] })).toBeNull();
  });
});

describe("code words", () => {
  const c = (reason: CodeCheck["reason"], o: Partial<CodeCheck> = {}): CodeCheck => ({
    ok: false, code: "KARIBU10", discountKes: 0, reason, label: null, startsOn: null, minOrderKes: null, modes: null, ...o,
  });
  test("each refusal says why, in the spec's words", () => {
    expect(codeError(c("unknown"), 0)).toBe("We don’t know that code. Check the spelling.");
    expect(codeError(c("off"), 0)).toBe("KARIBU10 isn’t on right now.");
    expect(codeError(c("not_started", { startsOn: "2026-12-01" }), 0)).toBe("KARIBU10 starts on 1 Dec.");
    expect(codeError(c("ended"), 0)).toBe("KARIBU10 has ended.");
    expect(codeError(c("used_up"), 0)).toBe("KARIBU10 has been used up.");
    expect(codeError(c("min_order", { minOrderKes: 800 }), 680)).toBe("KARIBU10 is for orders of KSh\u00a0800 or more. Add KSh\u00a0120 more to use it.");
    expect(codeError(c("combos_only"), 500)).toBe("Codes don’t apply to combos.");
    expect(codeError(c("combos_only"), 0)).toBe("Add a dish to use KARIBU10.");
    expect(codeError(c("mode", { modes: ["pickup", "dine_in"] }), 0)).toBe("KARIBU10 is for pickup and dine-in only.");
    expect(codeError(c("phone_used"), 0)).toBe("This phone number has already used KARIBU10.");
  });
  test("the held chip: the shortfall for a minimum, else the reason without its full stop", () => {
    expect(codeHeldNote(c("min_order", { minOrderKes: 800 }), 680)).toBe("Add KSh\u00a0120 more to use KARIBU10");
    expect(codeHeldNote(c("ended"), 0)).toBe("KARIBU10 has ended");
  });
  test("an unrecognised reason reads as none", () => {
    expect(codeReason("used_up")).toBe("used_up");
    expect(codeReason("nope")).toBeNull();
  });
});
